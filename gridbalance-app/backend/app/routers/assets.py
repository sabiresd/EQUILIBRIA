"""SCADA et EMS : etat des equipements, alarmes, consignes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import TokenUser, require
from app.services import assets, audit

router = APIRouter(prefix="/api", tags=["scada-ems"])


# ------------------------------------------------------------------- SCADA
@router.get("/scada/live")
async def scada_live(user: TokenUser = Depends(require("scada:read"))) -> dict:
    """Etat courant du parc (SCADA + EMS), calcule sur l'heure de l'horloge."""
    try:
        return await assets.live()
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc


@router.get("/scada/equipements")
async def scada_equipements(user: TokenUser = Depends(require("scada:read"))) -> list[dict]:
    """Derniere mesure de chaque equipement (inventaire)."""
    return await assets.equipements()


@router.get("/scada/historique")
async def scada_historique(
    equipement_id: str | None = None,
    hours: int = 48,
    user: TokenUser = Depends(require("scada:read")),
) -> list[dict]:
    return await assets.historique(equipement_id, min(hours, 360))


@router.get("/scada/alarmes")
async def scada_alarmes(
    actives: bool = False,
    user: TokenUser = Depends(require("scada:read")),
) -> list[dict]:
    return await assets.alarmes(actives)


@router.post("/scada/alarmes/{alarme_id}/ack")
async def scada_ack(
    alarme_id: str, user: TokenUser = Depends(require("alert:ack"))
) -> dict:
    if not await assets.acquitter(alarme_id, user.email):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alarme introuvable")
    await audit.log("scada.alarme.ack", actor=user.email, detail={"alarme_id": alarme_id})
    return {"acquittee": True, "id": alarme_id}


# --------------------------------------------------------------------- EMS
@router.get("/ems/consignes")
async def ems_consignes(
    hours: int = 48, user: TokenUser = Depends(require("ems:read"))
) -> list[dict]:
    return await assets.consignes_ems(min(hours, 360))


# ------------------------------------------------------------- generation
@router.post("/scada/seed", status_code=status.HTTP_201_CREATED)
async def scada_seed(
    hours: int = 72,
    reset: bool = True,
    user: TokenUser = Depends(require("config:manage")),
) -> dict:
    """Genere l'historique SCADA/EMS dans MongoDB (donnees de demonstration)."""
    try:
        res = await assets.seed(hours=min(hours, 360), reset=reset)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    await audit.log("scada.seed", actor=user.email, detail=res)
    return res
