"""Runs, plans, HITL, dashboard, sante."""
from __future__ import annotations

import asyncio
import socket
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.db import get_db
from app.core.security import TokenUser, require
from app.services import orchestrator
from app.services.workflows import WorkflowError, ping
from contracts.contracts import Battery, Site, Tariffs

router = APIRouter(prefix="/api", tags=["runs"])


class StartRunBody(BaseModel):
    site: Site
    scenario: str = Field(pattern="^(normal|windless)$")
    battery: Battery
    tariffs: Tariffs
    rag_mode: str = Field(default="hybrid", pattern="^(strict|hybrid|off)$")


class ProposeBody(BaseModel):
    plan_id: str = Field(pattern="^[ABC]$")


class ValidateBody(BaseModel):
    plan_id: str = Field(pattern="^[ABC]$")
    approve: bool
    # Le commentaire est OBLIGATOIRE : une validation humaine sans motif tracable
    # n'aurait aucune valeur d'audit.
    comment: str = Field(min_length=3, max_length=2000)


def _clean(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    doc.pop("_id", None)
    return doc


@router.get("/health")
async def health() -> dict:
    urls = settings.workflow_urls
    results = await asyncio.gather(*(ping(wf, url) for wf, url in urls.items()))
    workflows = dict(zip(urls.keys(), results, strict=True))

    try:
        await get_db().users.find_one({}, {"_id": 1})
        mongo = "up"
    except Exception:  # noqa: BLE001
        mongo = "down"

    # En mode fichier, l'ecriture dans outbox/ ne peut pas echouer pour cause de
    # reseau : on la declare disponible sans tenter de joindre un serveur SMTP.
    smtp = "up"
    if settings.mail_mode == "smtp":
        try:
            with socket.create_connection((settings.smtp_host, settings.smtp_port), 3):
                pass
        except OSError:
            smtp = "down"

    return {"workflows": workflows, "mongo": mongo, "smtp": smtp}


@router.get("/dashboard/kpis")
async def kpis(user: TokenUser = Depends(require("dashboard:read"))) -> dict:
    db = get_db()
    last = await db.runs.find_one({"status": "done"}, sort=[("created_at", -1)])
    totals = (last or {}).get("totals") or {}
    hourly = (last or {}).get("hourly") or []

    return {
        "correlation_id": (last or {}).get("correlation_id"),
        "deficit_mw": max((h["deficit_mw"] for h in hourly), default=0.0),
        "soc": min((h["soc"] for h in hourly), default=1.0),
        "cumulative_cost": totals.get("total_cost", 0.0),
        "protected_violations": totals.get("protected_load_violations", 0),
        "main_series": (last or {}).get("series") or [],
        "deficit_summary": (last or {}).get("deficit_summary"),
        "last_runs": [
            _clean(r)
            async for r in db.runs.find({}, {"series": 0, "hourly": 0}).sort("created_at", -1).limit(5)
        ],
        "last_alerts": [
            {**a, "id": a.pop("_id")}
            async for a in db.alerts.find().sort("created_at", -1).limit(5)
        ],
    }


@router.get("/runs")
async def list_runs(limit: int = 20, user: TokenUser = Depends(require("run:read"))) -> list[dict]:
    cursor = (
        get_db()
        .runs.find({}, {"series": 0, "hourly": 0})
        .sort("created_at", -1)
        .limit(min(limit, 100))
    )
    return [_clean(r) async for r in cursor]  # type: ignore[misc]


@router.post("/runs", status_code=status.HTTP_202_ACCEPTED)
async def create_run(
    body: StartRunBody,
    background: BackgroundTasks,
    user: TokenUser = Depends(require("run:create")),
) -> dict:
    cid = await orchestrator.start_run(
        actor=user.email,
        site=body.site,
        scenario=body.scenario,
        battery=body.battery,
        tariffs=body.tariffs,
        rag_mode=body.rag_mode,
    )
    # WF-1 puis WF-2 tournent en tache de fond ; le front suit via GET /runs/{cid}.
    background.add_task(orchestrator.execute_run, cid)
    return {"correlation_id": str(cid)}


@router.get("/runs/{cid}")
async def get_run(cid: UUID, user: TokenUser = Depends(require("run:read"))) -> dict:
    run = await get_db().runs.find_one({"_id": str(cid)})
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run introuvable")
    return _clean(run)  # type: ignore[return-value]


@router.post("/runs/{cid}/plans")
async def make_plans(cid: UUID, user: TokenUser = Depends(require("plan:generate"))) -> dict:
    try:
        run = await orchestrator.generate_plans(cid, user.email)
    except WorkflowError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, exc.as_dict())
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    return _clean(run)  # type: ignore[return-value]


@router.post("/runs/{cid}/propose")
async def propose(
    cid: UUID, body: ProposeBody, user: TokenUser = Depends(require("plan:propose"))
) -> dict:
    run = await get_db().runs.find_one({"_id": str(cid)})
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run introuvable")
    await orchestrator.propose_plan(cid, body.plan_id, user.email)
    return {"ok": True, "proposed_plan_id": body.plan_id}


@router.get("/validations")
async def validation_queue(user: TokenUser = Depends(require("plan:validate"))) -> list[dict]:
    """File HITL : les runs proposes par un operator, en attente d'un supervisor."""
    cursor = (
        get_db()
        .runs.find({"validation_status": "pending"}, {"series": 0, "hourly": 0})
        .sort("proposed_at", -1)
    )
    return [_clean(r) async for r in cursor]  # type: ignore[misc]


@router.post("/runs/{cid}/validate")
async def validate(
    cid: UUID, body: ValidateBody, user: TokenUser = Depends(require("plan:validate"))
) -> dict:
    try:
        return await orchestrator.validate_plan(
            cid, body.plan_id, body.comment, body.approve, user.email
        )
    except WorkflowError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, exc.as_dict())
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
