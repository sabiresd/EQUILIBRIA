"""Outils MCP de l'AGENT 1 - Simulateur.

    recuperer_donnees_reseau()  -> lecture : fenetre 360 h TEMPS REEL + facture,
                                   au format attendu par l'Agent Calcul.
    recuperer_facture()         -> lecture : la facture ONEE du site.

Les donnees viennent de la collection `weather` (6575 h NASA 2023), lues a partir
du pointeur d'horloge `sim_clock` PARTAGE avec le dashboard : l'agent voit donc le
meme "maintenant" que l'ecran. C'est ce qui rend le workflow temps reel.
"""

import json
import math
from datetime import datetime, timezone

from journal import tracer
from mongo_mcp import get_collection, mcp

# Moteur metier (racine du depot), ajoute au sys.path par mongo_mcp.
import agent_simulation as A
from facture_onee import (
    baseline_cost,
    calibration_factors,
    facture_to_contract,
    load_facture,
)

HORIZON = A.DEFAULT_HORIZON_HOURS  # 360


def _current_index() -> int:
    """Index horaire courant, lu depuis l'horloge partagee `sim_clock`."""
    clk = get_collection("sim_clock").find_one({"_id": "sim_clock"})
    n = get_collection("weather").count_documents({})
    if n == 0:
        raise RuntimeError("Collection 'weather' vide : lancez ingest_weather.py.")
    if not clk:
        return 0  # le backend n'a pas encore initialise l'horloge
    if clk.get("paused"):
        return int(clk.get("paused_index", clk["start_h_index"])) % n
    started = datetime.fromisoformat(clk["started_at"])
    elapsed = (datetime.now(timezone.utc) - started).total_seconds() * float(clk["speed"])
    return int(clk["start_h_index"] + int(elapsed)) % n


def _build_payload(correlation_id: str | None = None) -> dict:
    facture = load_facture()
    calib = calibration_factors(A.profile_kwh_by_period(facture.heures_facturees), facture)

    n = get_collection("weather").count_documents({})
    start = _current_index()
    # Fenetre de 360 h a partir de "maintenant" (enroulement en fin de dataset).
    idxs = [(start + k) % n for k in range(HORIZON)]
    docs = {d["h_index"]: d for d in get_collection("weather").find({"h_index": {"$in": idxs}})}
    rows = [docs[i] for i in idxs if i in docs]

    start_hour_local = (int(rows[0]["hour_utc"]) + A.UTC_OFFSET_HOURS) % 24

    series = []
    demand_kwh = {"creuse": 0.0, "normale": 0.0, "pointe": 0.0}
    for h, d in enumerate(rows):
        hl = (h + start_hour_local) % 24
        period, _ = A.tariff_for_hour(hl)
        demand = round(A.demand_mw(hl) * calib.get(period, 1.0), 3)
        wind = A.wind_power_mw(float(d["ws10m"]))
        solar = A.solar_power_mw(float(d["irr"]), float(d["t2m"]))
        series.append({
            "h": h, "wind_ms": round(float(d["ws10m"]), 2), "ghi": round(float(d["irr"]), 1),
            "prod_wind_mw": wind, "prod_solar_mw": solar, "demand_mw": demand,
        })
        demand_kwh[period] += demand * 1000.0

    return {
        "correlation_id": correlation_id,
        "series": series,
        "battery": dict(A.BATTERY),
        "tariffs": facture.tariffs_mad_mwh(),
        "start_hour_local": start_hour_local,
        "grid_cap_mw": round(facture.puissance_souscrite_kva * A.COS_PHI / 1000, 3),
        "facture": facture_to_contract(facture),
        "baseline": baseline_cost(demand_kwh, facture, len(series)),
        "meta": {
            "source": "MongoDB gridbalance.weather (NASA 2023, temps reel)",
            "h_index_start": start,
            "sent_at_local": (
                datetime.now(timezone.utc)
                .astimezone(timezone.utc)
                .isoformat()
            ),
        },
    }


@mcp.tool()
@tracer("lecture", agent="Agent 1 - Simulateur")
def recuperer_donnees_reseau(correlation_id: str = "") -> str:
    """Recupere l'etat du reseau en TEMPS REEL : previsions meteo (360 h) +
    consommation recalee sur la facture + tarifs + plafond reseau + baseline.

    Le resultat est directement injectable dans l'Agent Calcul (contrat WF2Request).

    Args:
        correlation_id: identifiant propage a travers les 4 agents (optionnel).
    """
    try:
        payload = _build_payload(correlation_id or None)
        return json.dumps(payload, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        return json.dumps({"erreur": f"recuperer_donnees_reseau : {e}"}, ensure_ascii=False)


@mcp.tool()
@tracer("lecture", agent="Agent 1 - Simulateur")
def recuperer_facture() -> str:
    """Recupere la facture ONEE du site (tarifs, puissance souscrite, consommation).

    Sert de verite du site : tarifs reels, plafond reseau, base de comparaison.
    """
    try:
        f = load_facture()
        return json.dumps(
            {**facture_to_contract(f), "prix_moyen_mad_kwh": round(f.prix_moyen_mad_kwh, 3)},
            ensure_ascii=False,
        )
    except Exception as e:  # noqa: BLE001
        return json.dumps({"erreur": f"recuperer_facture : {e}"}, ensure_ascii=False)
