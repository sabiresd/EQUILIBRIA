"""Alertes, rapports e-mail, journal d'audit, administration."""
from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, EmailStr, Field

from app.core.db import get_config, get_db
from app.core.security import TokenUser, hash_password, require
from app.services import audit, mailer
from app.services.workflows import ping

router = APIRouter(prefix="/api", tags=["ops"])


# ------------------------------------------------------------------ alertes
@router.get("/alerts")
async def list_alerts(user: TokenUser = Depends(require("alert:read"))) -> list[dict]:
    cursor = get_db().alerts.find().sort("created_at", -1).limit(200)
    return [{**a, "id": a.pop("_id")} async for a in cursor]


@router.post("/alerts/{alert_id}/ack")
async def ack_alert(alert_id: str, user: TokenUser = Depends(require("alert:ack"))) -> dict:
    result = await get_db().alerts.update_one(
        {"_id": alert_id, "acknowledged_by": None},
        {"$set": {"acknowledged_by": user.email, "acknowledged_at": datetime.now(UTC)}},
    )
    if not result.matched_count:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alerte introuvable ou deja acquittee")
    await audit.log("alert.ack", actor=user.email, detail={"alert_id": alert_id})
    return {"ok": True, "acknowledged_by": user.email}


# ----------------------------------------------------------------- rapports
class SendReportBody(BaseModel):
    correlation_id: str
    recipients: list[EmailStr] = Field(min_length=1)


class ScheduleBody(BaseModel):
    frequency: str = Field(pattern="^(daily|weekly)$")
    recipients: list[EmailStr] = Field(min_length=1)


@router.get("/reports")
async def list_reports(user: TokenUser = Depends(require("report:read"))) -> list[dict]:
    cursor = get_db().email_reports.find().sort("created_at", -1).limit(100)
    return [{**r, "id": r.pop("_id")} async for r in cursor]


@router.post("/reports/send")
async def send_report(
    body: SendReportBody, user: TokenUser = Depends(require("report:send"))
) -> dict:
    try:
        record = await mailer.send_report(
            body.correlation_id, [str(r) for r in body.recipients], user.email
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    return {**record, "id": record.pop("_id")}


@router.post("/reports/schedule")
async def schedule(
    body: ScheduleBody, user: TokenUser = Depends(require("report:schedule"))
) -> dict:
    job_id = mailer.schedule_report(body.frequency, [str(r) for r in body.recipients])
    await get_db().config.update_one(
        {"_id": "app_config"},
        {"$set": {f"schedules.{body.frequency}": [str(r) for r in body.recipients]}},
    )
    await audit.log(
        "report.schedule",
        actor=user.email,
        detail={"frequency": body.frequency, "recipients": len(body.recipients)},
    )
    return {"ok": True, "job_id": job_id}


# ------------------------------------------------------------------- audit
@router.get("/audit")
async def list_audit(
    action: str | None = None,
    correlation_id: str | None = None,
    limit: int = 200,
    user: TokenUser = Depends(require("audit:read")),
) -> list[dict]:
    query: dict = {}
    if action:
        query["action"] = action
    if correlation_id:
        query["correlation_id"] = correlation_id
    cursor = get_db().audit_log.find(query).sort("created_at", -1).limit(min(limit, 1000))
    return [{**e, "id": e.pop("_id")} async for e in cursor]


@router.get("/audit/export.csv", response_class=PlainTextResponse)
async def export_audit(user: TokenUser = Depends(require("audit:export"))) -> PlainTextResponse:
    csv_data = await audit.export_csv()
    await audit.log("audit.export", actor=user.email)
    return PlainTextResponse(
        csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="journal-audit.csv"'},
    )


@router.delete("/audit")
async def purge_audit(user: TokenUser = Depends(require("audit:purge"))) -> dict:
    result = await get_db().audit_log.delete_many({})
    await audit.log("audit.purge", actor=user.email, detail={"deleted": result.deleted_count})
    return {"deleted": result.deleted_count}


# -------------------------------------------------------------------- admin
class UserBody(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2)
    role: str = Field(pattern="^(operator|supervisor|admin)$")
    password: str | None = Field(default=None, min_length=8)
    active: bool = True


@router.get("/admin/users")
async def list_users(user: TokenUser = Depends(require("user:manage"))) -> list[dict]:
    cursor = get_db().users.find({}, {"password_hash": 0})
    return [{**u, "id": str(u.pop("_id"))} async for u in cursor]


@router.post("/admin/users", status_code=status.HTTP_201_CREATED)
async def create_user(body: UserBody, user: TokenUser = Depends(require("user:manage"))) -> dict:
    db = get_db()
    if await db.users.find_one({"email": body.email.lower()}):
        raise HTTPException(status.HTTP_409_CONFLICT, "Cet e-mail est deja utilise")
    if not body.password:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Mot de passe requis")

    doc = {
        "_id": str(uuid4()),
        "email": body.email.lower(),
        "name": body.name,
        "role": body.role,
        "password_hash": hash_password(body.password),
        "active": body.active,
        "created_at": datetime.now(UTC),
    }
    await db.users.insert_one(doc)
    await audit.log("user.create", actor=user.email, detail={"email": body.email, "role": body.role})
    return {"id": doc["_id"], "email": doc["email"], "name": doc["name"], "role": doc["role"]}


@router.put("/admin/users/{user_id}")
async def update_user(
    user_id: str, body: UserBody, user: TokenUser = Depends(require("user:manage"))
) -> dict:
    update: dict = {"name": body.name, "role": body.role, "active": body.active}
    if body.password:
        update["password_hash"] = hash_password(body.password)
    result = await get_db().users.update_one({"_id": user_id}, {"$set": update})
    if not result.matched_count:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Utilisateur introuvable")
    await audit.log("user.update", actor=user.email, detail={"user_id": user_id})
    return {"ok": True}


@router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, user: TokenUser = Depends(require("user:manage"))) -> dict:
    if user_id == user.sub:
        raise HTTPException(status.HTTP_409_CONFLICT, "Vous ne pouvez pas supprimer votre compte")
    result = await get_db().users.delete_one({"_id": user_id})
    if not result.deleted_count:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Utilisateur introuvable")
    await audit.log("user.delete", actor=user.email, detail={"user_id": user_id})
    return {"ok": True}


@router.get("/admin/config")
async def read_config(user: TokenUser = Depends(require("config:manage"))) -> dict:
    return await get_config()


@router.put("/admin/config")
async def update_config(body: dict, user: TokenUser = Depends(require("config:manage"))) -> dict:
    body.pop("_id", None)
    await get_db().config.update_one({"_id": "app_config"}, {"$set": body})
    await audit.log("config.update", actor=user.email, detail={"keys": list(body.keys())})
    return await get_config()


@router.post("/admin/test/{service}")
async def test_service(
    service: str,
    background: BackgroundTasks,
    user: TokenUser = Depends(require("config:manage")),
) -> dict:
    cfg = await get_config()

    if service in ("WF1", "WF2", "WF3", "WF4"):
        return await ping(service, cfg.get("workflow_urls", {}).get(service, ""))

    if service == "mongo":
        try:
            await get_db().command("ping")
            return {"status": "up"}
        except Exception as exc:  # noqa: BLE001
            return {"status": "down", "error": str(exc)}

    if service == "smtp":
        try:
            mailer._send(  # noqa: SLF001 — test de connexion explicite
                [user.email],
                "[GridBalance] Test de connexion SMTP",
                "<p>La configuration SMTP fonctionne.</p>",
            )
            return {"status": "up", "sent_to": user.email}
        except Exception as exc:  # noqa: BLE001
            return {"status": "down", "error": str(exc)}

    raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Service inconnu : {service}")
