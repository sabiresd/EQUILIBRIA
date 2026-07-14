"""Client des 4 agents. C'est le SEUL endroit qui parle au monde exterieur.

Le navigateur n'appelle jamais la plateforme agentique : il passe par ce BFF, qui
injecte le correlation_id, applique le timeout et les retries, et normalise les
erreurs.

Deux modes :
  - stub : les 4 agents sont simules en interne (app/services/stubs.py)
  - live : appel HTTP reel des webhooks de la plateforme agentique

Deux styles de reponse geres en mode live :
  - synchrone  : la plateforme renvoie le resultat dans la reponse HTTP.
  - asynchrone : elle repond 202 {"status": "in progress"} — c'est le cas d'ABA
    Fusion / Langflow. Le resultat n'est alors PAS recuperable par HTTP. On bascule
    sur les donnees simulees et on marque le run en mode degrade, plutot que de
    faire echouer la demo silencieusement.

    Pour un usage reel avec une plateforme asynchrone, il faut que l'agent rappelle
    un webhook de callback expose par ce backend. C'est une evolution d'architecture,
    pas un reglage de configuration.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any
from uuid import UUID

import httpx
from pydantic import BaseModel, ValidationError

from app.core.config import settings
from app.services import stubs
from contracts.contracts import (
    WF1Request,
    WF1Response,
    WF2Request,
    WF2Response,
    WF3Request,
    WF3Response,
    WF4Request,
    WF4Response,
)


class WorkflowError(Exception):
    """Erreur d'appel workflow, portant le correlation_id pour le support."""

    def __init__(self, workflow: str, message: str, correlation_id: UUID):
        self.workflow = workflow
        self.correlation_id = correlation_id
        super().__init__(message)

    def as_dict(self) -> dict[str, Any]:
        return {
            "error": "workflow_unreachable",
            "workflow": self.workflow,
            "message": str(self),
            "correlation_id": str(self.correlation_id),
        }


class CallResult(BaseModel):
    data: dict
    duration_ms: int
    degraded: bool = False  # true = le stub a pris le relais
    note: str | None = None


async def _post(url: str, payload: dict, workflow: str, cid: UUID) -> CallResult:
    """POST avec timeout + retries a backoff exponentiel."""
    last: Exception | None = None
    for attempt in range(settings.wf_retries + 1):
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=settings.wf_timeout_seconds) as client:
                resp = await client.post(
                    url,
                    json=payload,
                    headers={"X-Correlation-Id": str(cid)},
                )
            elapsed = int((time.perf_counter() - started) * 1000)
            resp.raise_for_status()

            # 202 + pas de corps exploitable => plateforme asynchrone.
            if resp.status_code == 202:
                return CallResult(
                    data={},
                    duration_ms=elapsed,
                    degraded=True,
                    note=(
                        "La plateforme a accepte la tache en asynchrone (202) et ne "
                        "renvoie pas de resultat exploitable par HTTP."
                    ),
                )
            return CallResult(data=resp.json(), duration_ms=elapsed)
        except Exception as exc:  # noqa: BLE001 — on retente puis on remonte proprement
            last = exc
            if attempt < settings.wf_retries:
                await asyncio.sleep(2**attempt)
    raise WorkflowError(workflow, f"{type(last).__name__}: {last}", cid)


async def _call(workflow: str, url: str, req: BaseModel, model, stub_fn) -> CallResult:
    cid = req.correlation_id  # type: ignore[attr-defined]

    if settings.wf_mode == "stub" or not url:
        started = time.perf_counter()
        data = stub_fn(req).model_dump(mode="json")
        return CallResult(
            data=data, duration_ms=int((time.perf_counter() - started) * 1000)
        )

    result = await _post(url, req.model_dump(mode="json"), workflow, cid)

    if result.degraded or not result.data:
        # Plateforme asynchrone ou reponse vide : on sert le stub, en le disant.
        data = stub_fn(req).model_dump(mode="json")
        return CallResult(
            data=data,
            duration_ms=result.duration_ms,
            degraded=True,
            note=result.note or "Reponse vide du workflow ; donnees simulees utilisees.",
        )

    try:
        model.model_validate(result.data)
    except ValidationError as exc:
        raise WorkflowError(
            workflow, f"Reponse non conforme au contrat : {exc.error_count()} erreur(s)", cid
        )
    return result


async def call_wf1(req: WF1Request) -> CallResult:
    return await _call("WF1", settings.wf1_url, req, WF1Response, stubs.wf1)


async def call_wf2(req: WF2Request) -> CallResult:
    return await _call("WF2", settings.wf2_url, req, WF2Response, stubs.wf2)


async def call_wf3(req: WF3Request) -> CallResult:
    return await _call("WF3", settings.wf3_url, req, WF3Response, stubs.wf3)


async def call_wf4(req: WF4Request) -> CallResult:
    return await _call("WF4", settings.wf4_url, req, WF4Response, stubs.wf4)


async def ping(workflow: str, url: str) -> dict:
    """Ping de sante affiche en pastille dans le dashboard."""
    if settings.wf_mode == "stub" or not url:
        return {"status": "up", "latency_ms": 0, "mode": "stub"}
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(url, json={"ping": True})
        latency = int((time.perf_counter() - started) * 1000)
        status = "up" if resp.status_code < 500 else "degraded"
        return {"status": status, "latency_ms": latency, "mode": "live"}
    except Exception:  # noqa: BLE001
        return {"status": "down", "latency_ms": None, "mode": "live"}
