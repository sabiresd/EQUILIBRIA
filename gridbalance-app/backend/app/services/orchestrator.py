"""Orchestration sequentielle des workflows et cycle de vie d'un run.

Chaine : WF-1 (series) -> WF-2 (bilan) -> [WF-3 (plans)] -> HITL -> WF-4 (journal).

Le correlation_id est genere ICI, au debut du run, et propage a tous les workflows.
Chaque etape alimente `steps[]`, ce qui donne au front son stepper de progression.
"""
from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from app.core.db import get_db
from app.services import audit
from app.services import gridbalance_engine as engine
from app.services.stubs import deficit_summary_from
from app.services.workflows import (
    WorkflowError,
    call_wf1,
    call_wf2,
    call_wf3,
    call_wf4,
)
from contracts.contracts import (
    Baseline,
    Battery,
    DecisionCard,
    Facture,
    HourlyPoint,
    ProtectedLoad,
    Site,
    Tariffs,
    WF1Request,
    WF2Request,
    WF2Totals,
    WF3Request,
    WF4Request,
    sha256_card,
    verify_card,
)

# Charges du site. L'hopital est verrouille : aucun plan ne peut le delester.
DEFAULT_PROTECTED_LOADS = [
    ProtectedLoad(id="hopital", label="Hopital regional", criticality="critical", locked=True),
    ProtectedLoad(id="eau", label="Station de traitement d'eau", criticality="high", locked=True),
    ProtectedLoad(id="industriel_a", label="Site industriel A", criticality="medium", locked=False),
    ProtectedLoad(id="tertiaire_b", label="Site tertiaire B", criticality="low", locked=False),
    ProtectedLoad(id="industriel_c", label="Site industriel C", criticality="medium", locked=False),
]


def _step(workflow: str, status: str, duration_ms: int | None = None, error: str | None = None):
    return {"workflow": workflow, "status": status, "duration_ms": duration_ms, "error": error}


async def start_run(
    *,
    actor: str,
    site: Site,
    scenario: str,
    battery: Battery,
    tariffs: Tariffs,
    rag_mode: str,
) -> UUID:
    cid = uuid4()  # <-- injection du correlation_id, avant tout appel workflow
    await get_db().runs.insert_one(
        {
            "_id": str(cid),
            "correlation_id": str(cid),
            "status": "pending",
            "scenario": scenario,
            "site": site.model_dump(),
            "battery": battery.model_dump(),
            "tariffs": tariffs.model_dump(),
            "rag_mode": rag_mode,
            "created_at": datetime.now(UTC),
            "created_by": actor,
            "steps": [
                _step("WF1", "pending"),
                _step("WF2", "pending"),
                _step("WF3", "pending"),
                _step("WF4", "pending"),
            ],
            "rag_fallback": False,
            "degraded": False,
        }
    )
    await audit.log("run.start", actor=actor, correlation_id=cid, detail={"scenario": scenario})
    return cid


async def _set_step(cid: UUID, workflow: str, **fields) -> None:
    idx = {"WF1": 0, "WF2": 1, "WF3": 2, "WF4": 3}[workflow]
    await get_db().runs.update_one(
        {"_id": str(cid)},
        {"$set": {f"steps.{idx}.{k}": v for k, v in fields.items()}},
    )


async def execute_run(cid: UUID) -> None:
    """WF-1 puis WF-2. Lance en tache de fond ; le front suit via polling."""
    db = get_db()
    run = await db.runs.find_one({"_id": str(cid)})
    if not run:
        return
    await db.runs.update_one({"_id": str(cid)}, {"$set": {"status": "running"}})

    try:
        # ---- WF-1 : previsions meteo -> series de production et de demande
        await _set_step(cid, "WF1", status="running")
        r1 = await call_wf1(
            WF1Request(
                correlation_id=cid,
                site=Site(**run["site"]),
                horizon_hours=360,
                scenario=run["scenario"],
            )
        )
        await _set_step(cid, "WF1", status="done", duration_ms=r1.duration_ms)
        series = r1.data["series"]

        # Le moteur a mis en cache le payload complet : la facture est la verite du
        # site (tarifs, plafond reseau, baseline), la batterie reste un actif du run.
        payload = engine.peek_payload(str(cid)) or {}
        tariffs = Tariffs(**payload["tariffs"]) if payload.get("tariffs") else Tariffs(**run["tariffs"])
        facture = Facture(**payload["facture"]) if payload.get("facture") else None
        baseline = Baseline(**payload["baseline"]) if payload.get("baseline") else None

        # ---- WF-2 : bilan horaire, dispatch batterie, deficits, couts
        await _set_step(cid, "WF2", status="running")
        r2 = await call_wf2(
            WF2Request(
                correlation_id=cid,
                series=series,
                battery=Battery(**run["battery"]),
                tariffs=tariffs,
                start_hour_local=payload.get("start_hour_local", 0),
                grid_cap_mw=payload.get("grid_cap_mw"),
                facture=facture,
                baseline=baseline,
            )
        )
        await _set_step(cid, "WF2", status="done", duration_ms=r2.duration_ms)

        hourly = [HourlyPoint(**h) for h in r2.data["hourly"]]
        totals = WF2Totals(**r2.data["totals"])
        summary = deficit_summary_from(hourly, totals)

        # Apport propre du pilotage (parc deduit), pour un chiffre honnete au dashboard.
        contribution = None
        if payload.get("baseline"):
            contrib_payload = {**payload, "battery": run["battery"]}
            contribution = engine.battery_contribution(contrib_payload)

        await db.runs.update_one(
            {"_id": str(cid)},
            {
                "$set": {
                    "status": "done",
                    "series": series,
                    "hourly": r2.data["hourly"],
                    "totals": r2.data["totals"],
                    "deficit_summary": summary.model_dump(mode="json"),
                    "tariffs": tariffs.model_dump(mode="json"),
                    "grid_cap_mw": payload.get("grid_cap_mw"),
                    "start_hour_local": payload.get("start_hour_local", 0),
                    "facture": payload.get("facture"),
                    "baseline": payload.get("baseline"),
                    "battery_contribution": contribution,
                    "degraded": r1.degraded or r2.degraded,
                    "degraded_note": r1.note or r2.note,
                }
            },
        )
        engine.pop_payload(str(cid))
        await audit.log("run.complete", correlation_id=cid, detail={"totals": r2.data["totals"]})

        run = await db.runs.find_one({"_id": str(cid)})
        await audit.evaluate_run(run)  # type: ignore[arg-type]

    except WorkflowError as exc:
        await _set_step(cid, exc.workflow, status="error", error=str(exc))
        await db.runs.update_one(
            {"_id": str(cid)}, {"$set": {"status": "error", "error": str(exc)}}
        )
        await audit.log("run.error", correlation_id=cid, detail=exc.as_dict())
        await audit.raise_alert(
            "workflow_failure",
            "critical",
            f"Workflow {exc.workflow} injoignable : {exc}",
            cid,
        )


async def generate_plans(cid: UUID, actor: str) -> dict:
    """WF-3 : les 3 plans candidats sourcés par RAG."""
    db = get_db()
    run = await db.runs.find_one({"_id": str(cid)})
    if not run or not run.get("deficit_summary"):
        raise ValueError("Le run doit etre termine avant de generer des plans.")

    await _set_step(cid, "WF3", status="running")
    try:
        r3 = await call_wf3(
            WF3Request(
                correlation_id=cid,
                deficit_summary=run["deficit_summary"],
                protected_loads=DEFAULT_PROTECTED_LOADS,
                rag_mode=run.get("rag_mode", "hybrid"),
            )
        )
    except WorkflowError as exc:
        await _set_step(cid, "WF3", status="error", error=str(exc))
        await audit.raise_alert("workflow_failure", "critical", str(exc), cid)
        raise

    await _set_step(cid, "WF3", status="done", duration_ms=r3.duration_ms)
    await db.runs.update_one(
        {"_id": str(cid)},
        {
            "$set": {
                "plans": r3.data["plans"],
                "rag_fallback": r3.data.get("rag_fallback", False),
                "human_validation_required": r3.data.get("human_validation_required", True),
            }
        },
    )
    await audit.log("plan.generate", actor=actor, correlation_id=cid)

    run = await db.runs.find_one({"_id": str(cid)})
    if run.get("rag_fallback"):  # type: ignore[union-attr]
        await audit.raise_alert(
            "rag_fallback",
            "warning",
            "Preuve insuffisante : aucun plan ne peut etre selectionne automatiquement.",
            cid,
        )
    return run  # type: ignore[return-value]


async def propose_plan(cid: UUID, plan_id: str, actor: str) -> None:
    """L'operator propose ; il ne valide pas. Le plan entre dans la file HITL."""
    await get_db().runs.update_one(
        {"_id": str(cid)},
        {
            "$set": {
                "proposed_plan_id": plan_id,
                "proposed_by": actor,
                "proposed_at": datetime.now(UTC),
                "validation_status": "pending",
            }
        },
    )
    await audit.log("plan.propose", actor=actor, correlation_id=cid, detail={"plan_id": plan_id})


async def validate_plan(
    cid: UUID, plan_id: str, comment: str, approve: bool, actor: str
) -> dict:
    """Le supervisor tranche. A l'approbation : carte de decision -> SHA-256 -> WF-4."""
    db = get_db()
    run = await db.runs.find_one({"_id": str(cid)})
    if not run:
        raise ValueError("Run introuvable.")

    if not approve:
        await db.runs.update_one(
            {"_id": str(cid)},
            {
                "$set": {
                    "validation_status": "rejected",
                    "rejected_by": actor,
                    "rejection_comment": comment,
                    "rejected_at": datetime.now(UTC),
                }
            },
        )
        await audit.log(
            "plan.reject", actor=actor, correlation_id=cid, detail={"comment": comment}
        )
        return {"approved": False}

    plan = next((p for p in run.get("plans", []) if p["id"] == plan_id), None)
    if not plan:
        raise ValueError(f"Plan {plan_id} introuvable dans ce run.")

    card = DecisionCard(
        correlation_id=cid,
        plan_id=plan_id,  # type: ignore[arg-type]
        actions=plan["actions"],
        citations=plan.get("citations", []),
        deficit_summary=run.get("deficit_summary"),
        fairness_score=plan.get("fairness_score", 0.0),
        rag_fallback=run.get("rag_fallback", False),
        proposed_by=run.get("proposed_by") or actor,
        validated_by=actor,
        validated_at=datetime.now(UTC),
        comment=comment,
    )

    # Le hash est calcule sur le JSON CANONIQUE de la carte : c'est lui qui rend la
    # decision verifiable a posteriori.
    digest = sha256_card(card)

    await _set_step(cid, "WF4", status="running")
    r4 = await call_wf4(WF4Request(correlation_id=cid, decision_card=card))
    await _set_step(cid, "WF4", status="done", duration_ms=r4.duration_ms)

    decision = {
        "_id": str(uuid4()),
        "correlation_id": str(cid),
        "card": card.model_dump(mode="json"),
        "sha256": digest,
        "mongo_id": r4.data.get("mongo_id"),
        "notified": r4.data.get("notified", {"slack": False, "email": False}),
        "created_at": datetime.now(UTC),
    }
    await db.decisions.insert_one(decision)
    await db.runs.update_one(
        {"_id": str(cid)},
        {
            "$set": {
                "validation_status": "approved",
                "validated_by": actor,
                "validated_at": datetime.now(UTC),
                "decision_id": decision["_id"],
            }
        },
    )
    await audit.log(
        "plan.validate",
        actor=actor,
        correlation_id=cid,
        detail={"plan_id": plan_id, "sha256": digest},
    )
    await audit.log("decision.log", actor=actor, correlation_id=cid, detail={"sha256": digest})
    return {"approved": True, "decision_id": decision["_id"], "sha256": digest}


def verify_decision(decision: dict) -> dict:
    """Recalcule le hash de la carte et le compare a celui stocke."""
    return verify_card(decision["card"], decision["sha256"])
