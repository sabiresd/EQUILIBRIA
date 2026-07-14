"""Contrats d'echange GridBalance AI Morocco — modeles Pydantic (backend).

Source de verite : contracts/schemas.json. Le pendant TypeScript est contracts.ts.
Toute evolution du contrat se fait dans schemas.json, puis ici ET dans contracts.ts.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

DISCLAIMER = (
    "Prototype de simulation et d'aide a la decision. Non connecte aux systemes de "
    "l'ONEE. Aucun equipement reel n'est pilote. Tarifs affiches a titre de "
    "demonstration, non officiels ANRE."
)

Scenario = Literal["normal", "windless"]
RagMode = Literal["strict", "hybrid", "off"]
PlanId = Literal["A", "B", "C"]
TariffPeriod = Literal["creuse", "normale", "pointe"]
ActionKind = Literal["delestage", "decalage", "batterie", "achat_reseau"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Site(Strict):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    name: str | None = None


# --------------------------------------------------------------------- WF-1
class WF1Request(Strict):
    correlation_id: UUID
    site: Site
    horizon_hours: Literal[360] = 360
    scenario: Scenario


class SeriesPoint(Strict):
    h: int = Field(ge=0, le=359)
    wind_ms: float = Field(ge=0)
    ghi: float = Field(ge=0)
    prod_wind_mw: float = Field(ge=0)
    prod_solar_mw: float = Field(ge=0)
    demand_mw: float = Field(ge=0)


class WF1Response(Strict):
    series: list[SeriesPoint] = Field(min_length=1)


# --------------------------------------------------------------------- WF-2
class Battery(Strict):
    capacity_mwh: float = Field(gt=0)
    p_max_mw: float = Field(gt=0)
    soc_min: float = Field(ge=0, le=1)
    efficiency: float = Field(gt=0, le=1)
    degradation_cost_mwh: float = Field(default=45.0, ge=0)


class Tariffs(Strict):
    """MAD/MWh. Valeurs de DEMONSTRATION, non officielles ANRE."""

    creuse: float = Field(ge=0)
    normale: float = Field(ge=0)
    pointe: float = Field(ge=0)


class WF2Request(Strict):
    correlation_id: UUID
    series: list[SeriesPoint]
    battery: Battery
    tariffs: Tariffs


class HourlyPoint(Strict):
    h: int
    deficit_mw: float = Field(ge=0)
    soc: float = Field(ge=0, le=1)
    dispatch_mw: float  # > 0 decharge, < 0 charge
    cost: float = Field(ge=0)
    grid_mw: float = Field(default=0, ge=0)
    tariff_period: TariffPeriod = "normale"


class WF2Totals(Strict):
    total_cost: float
    total_deficit_mwh: float
    hours_in_deficit: int
    share_battery: float = 0.0
    share_grid: float = 0.0
    share_production: float = 0.0
    protected_load_violations: int = 0


class WF2Response(Strict):
    hourly: list[HourlyPoint]
    totals: WF2Totals


# --------------------------------------------------------------------- WF-3
class ProtectedLoad(Strict):
    id: str
    label: str
    criticality: Literal["critical", "high", "medium", "low"] = "high"
    locked: bool = True


class WindlessWindow(Strict):
    start_h: int
    end_h: int


class DeficitSummary(Strict):
    total_deficit_mwh: float
    hours_in_deficit: int
    peak_deficit_mw: float
    windless_window: WindlessWindow | None = None


class WF3Request(Strict):
    correlation_id: UUID
    deficit_summary: DeficitSummary
    protected_loads: list[ProtectedLoad]
    rag_mode: RagMode


class Citation(Strict):
    doc: str
    page: int = Field(ge=1)
    extrait: str
    score: float | None = Field(default=None, ge=0, le=1)


class PlanAction(Strict):
    site: str
    action: ActionKind
    delta_mw: float
    hours: list[int]
    justification: str | None = None


class Plan(Strict):
    id: PlanId
    label: str | None = None
    actions: list[PlanAction]
    citations: list[Citation]
    fairness_score: float = Field(ge=0, le=1)
    estimated_cost: float = 0.0
    covered_deficit_mwh: float = 0.0
    protected_loads_respected: bool = True


class WF3Response(Strict):
    plans: list[Plan] = Field(min_length=1, max_length=3)
    rag_fallback: bool = False
    human_validation_required: bool = False


# --------------------------------------------------------------------- WF-4
class DecisionCard(Strict):
    correlation_id: UUID
    plan_id: PlanId
    actions: list[PlanAction]
    citations: list[Citation] = []
    deficit_summary: DeficitSummary | None = None
    fairness_score: float = 0.0
    rag_fallback: bool = False
    proposed_by: str
    validated_by: str
    validated_at: datetime
    comment: str = Field(min_length=1)
    disclaimer: str = DISCLAIMER


class Notified(Strict):
    slack: bool = False
    email: bool = False


class WF4Request(Strict):
    correlation_id: UUID
    decision_card: DecisionCard


class WF4Response(Strict):
    logged: bool
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    mongo_id: str | None = None
    notified: Notified = Notified()


# ------------------------------------------------------------------ hashing
def canonical_json(card: DecisionCard | dict) -> str:
    """JSON canonique : cles triees, separateurs compacts, dates ISO.

    Deux representations identiques d'une meme carte donnent la MEME chaine, donc le
    meme hash. C'est ce qui rend le bouton "Verifier l'integrite" fiable.
    """
    raw = card.model_dump(mode="json") if isinstance(card, DecisionCard) else card
    return json.dumps(raw, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_card(card: DecisionCard | dict) -> str:
    return hashlib.sha256(canonical_json(card).encode("utf-8")).hexdigest()


def verify_card(card: DecisionCard | dict, expected_sha256: str) -> dict:
    """Recalcule le hash et le compare a celui stocke.

    Logique PURE (aucune dependance base de donnees) : c'est ce qui permet de la
    tester isolement et de la rejouer n'importe ou pour auditer une decision.
    """
    computed = sha256_card(card)
    return {
        "valid": computed == expected_sha256,
        "expected_sha256": expected_sha256,
        "computed_sha256": computed,
    }
