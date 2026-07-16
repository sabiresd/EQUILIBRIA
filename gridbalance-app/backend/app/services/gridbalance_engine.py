"""Pont vers le moteur deterministe (racine du depot).

Les modules agent_simulation / agent_calcul / facture_onee vivent a la racine de
ProjFinSpecialite : ils sont la SOURCE UNIQUE de la logique metier (formules
eoliennes (6)-(8), dispatch batterie, facture, baseline). Le backend les reutilise
au lieu d'en maintenir une copie divergente dans stubs.py.

Ils lisent leurs donnees (Data2023.xlsx, facture_onee_demo.json) via
Path(__file__).with_name(...), donc les chemins se resolvent tout seuls quel que
soit l'appelant. On ajoute juste la racine du depot au sys.path.
"""
from __future__ import annotations

import sys
from pathlib import Path

# backend/app/services/gridbalance_engine.py -> remonter jusqu'a ProjFinSpecialite/
_REPO_ROOT = Path(__file__).resolve().parents[4]

if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import agent_calcul  # noqa: E402
import agent_simulation  # noqa: E402
import facture_onee  # noqa: E402

simulate = agent_simulation.simulate
compute = agent_calcul.compute
battery_contribution = agent_calcul.battery_contribution
load_facture = facture_onee.load_facture
REPO_ROOT = _REPO_ROOT

# Fonctions unitaires reutilisees par la tuile live (une heure a la fois).
wind_power_mw = agent_simulation.wind_power_mw
solar_power_mw = agent_simulation.solar_power_mw
demand_mw = agent_simulation.demand_mw
tariff_for_hour = agent_simulation.tariff_for_hour
profile_kwh_by_period = agent_simulation.profile_kwh_by_period
calibration_factors = facture_onee.calibration_factors
UTC_OFFSET_HOURS = agent_simulation.UTC_OFFSET_HOURS

# Cache par run : WF-1 y depose le payload complet (series + facture + baseline +
# grid_cap + start_hour_local), l'orchestrateur l'y relit pour construire le
# WF2Request et enrichir le run affiche au dashboard. Meme processus, meme requete
# — pas besoin de persistance. Purge apres lecture pour ne pas fuir la memoire.
PAYLOADS: dict[str, dict] = {}


def stash_payload(correlation_id: str, payload: dict) -> None:
    PAYLOADS[correlation_id] = payload


def pop_payload(correlation_id: str) -> dict | None:
    return PAYLOADS.pop(correlation_id, None)


def peek_payload(correlation_id: str) -> dict | None:
    return PAYLOADS.get(correlation_id)


__all__ = [
    "simulate", "compute", "battery_contribution", "load_facture", "REPO_ROOT",
    "stash_payload", "pop_payload", "peek_payload",
]
