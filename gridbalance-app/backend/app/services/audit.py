"""Journal d'audit et moteur d'alertes."""
from __future__ import annotations

import csv
import io
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from app.core.db import get_config, get_db

AUDIT_ACTIONS = {
    "auth.login",
    "auth.login_failed",
    "auth.logout",
    "run.start",
    "run.complete",
    "run.error",
    "plan.generate",
    "plan.propose",
    "plan.validate",
    "plan.reject",
    "decision.log",
    "decision.verify",
    "alert.raise",
    "alert.ack",
    "report.send",
    "report.schedule",
    "config.update",
    "user.create",
    "user.update",
    "user.delete",
    "audit.export",
}


async def log(
    action: str,
    *,
    actor: str = "system",
    correlation_id: UUID | str | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    await get_db().audit_log.insert_one(
        {
            "_id": str(uuid4()),
            "action": action,
            "actor": actor,
            "correlation_id": str(correlation_id) if correlation_id else None,
            "detail": detail or {},
            "created_at": datetime.now(UTC),
        }
    )


async def export_csv() -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["date", "action", "acteur", "correlation_id", "detail"])
    cursor = get_db().audit_log.find().sort("created_at", -1)
    async for row in cursor:
        writer.writerow(
            [
                row["created_at"].isoformat(),
                row["action"],
                row["actor"],
                row.get("correlation_id") or "",
                str(row.get("detail") or {}),
            ]
        )
    return buf.getvalue()


# ------------------------------------------------------------------ alertes
async def raise_alert(
    rule: str,
    severity: str,
    message: str,
    correlation_id: UUID | str | None = None,
) -> dict:
    alert = {
        "_id": str(uuid4()),
        "rule": rule,
        "severity": severity,
        "message": message,
        "correlation_id": str(correlation_id) if correlation_id else None,
        "created_at": datetime.now(UTC),
        "acknowledged_by": None,
        "acknowledged_at": None,
    }
    await get_db().alerts.insert_one(alert)
    await log("alert.raise", correlation_id=correlation_id, detail={"rule": rule})
    return alert


async def evaluate_run(run: dict) -> list[dict]:
    """Applique les regles d'alerte au resultat d'un run."""
    cfg = await get_config()
    rules = cfg.get("alert_rules", {})
    cid = run["correlation_id"]
    raised: list[dict] = []

    totals = run.get("totals") or {}
    hourly = run.get("hourly") or []

    peak_deficit = max((h.get("deficit_mw", 0) for h in hourly), default=0)
    threshold = rules.get("deficit_threshold_mw", 5.0)
    if peak_deficit > threshold:
        raised.append(
            await raise_alert(
                "deficit_threshold",
                "critical",
                f"Deficit de pointe {peak_deficit:.1f} MW au-dela du seuil "
                f"de {threshold} MW.",
                cid,
            )
        )

    min_soc = min((h.get("soc", 1) for h in hourly), default=1)
    soc_threshold = rules.get("soc_threshold", 0.15)
    if min_soc < soc_threshold:
        raised.append(
            await raise_alert(
                "soc_threshold",
                "warning",
                f"Etat de charge descendu a {min_soc:.0%}, sous le seuil de "
                f"{soc_threshold:.0%}.",
                cid,
            )
        )

    violations = totals.get("protected_load_violations", 0)
    if violations and rules.get("protected_load_violation", True):
        raised.append(
            await raise_alert(
                "protected_load_violation",
                "critical",
                f"{violations} violation(s) de charge protegee detectee(s). "
                "La cible est de zero.",
                cid,
            )
        )

    if run.get("rag_fallback") and rules.get("rag_fallback", True):
        raised.append(
            await raise_alert(
                "rag_fallback",
                "warning",
                "Preuve insuffisante : le RAG est en repli, la validation humaine "
                "est obligatoire.",
                cid,
            )
        )

    for step in run.get("steps", []):
        if step.get("status") == "error" and rules.get("workflow_failure", True):
            raised.append(
                await raise_alert(
                    "workflow_failure",
                    "critical",
                    f"Echec du workflow {step['workflow']} : {step.get('error')}",
                    cid,
                )
            )

    return raised
