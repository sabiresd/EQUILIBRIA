"""
Agent Calcul (WF-2) — dispatch batterie, deficits et couts sur l'horizon complet.

REMPLACE le noeud LLM. Ce n'est pas un choix de style : le dispatch d'une batterie
est une recurrence a etat (le SoC de l'heure h depend de celui de h-1, sur 360
heures). Un LLM ne propage pas un etat sur 360 pas ; il produit des agregats
plausibles. Le LLM precedent avait d'ailleurs ecrit `"repetition": 15` — il avait
calcule UNE journee et l'avait multipliee par 15, faisant disparaitre les episodes
sans vent de plusieurs jours, c'est-a-dire le probleme meme que le produit resout.

Entree : WF2Request (voir contracts/schemas.json)
Sortie : WF2Response + une comparaison a la baseline de la facture

    python agent_calcul.py                      # tire un payload et le calcule
    python agent_calcul.py --in payload.json    # calcule un payload existant
    python agent_calcul.py --compare            # detaille l'apport de la batterie
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# Etat de charge initial, en fraction de la capacite. La batterie n'est ni vide
# ni pleine au debut de l'horizon : sinon le premier jour est une anomalie.
SOC_INITIAL = 0.80

# Plafond de soutirage par defaut, si le payload n'en fournit pas. Un site sans
# facture n'a pas de puissance souscrite connue : on ne bride pas.
DEFAULT_GRID_CAP_MW = float("inf")

PERIODS = ("creuse", "normale", "pointe")


class CalculError(RuntimeError):
    """Payload invalide : il manque un champ, ou une valeur est incoherente."""


def tariff_period(h: int, start_hour_local: int) -> str:
    """Periode tarifaire du point h.

    L'heure locale n'est PAS h % 24 : elle depend de l'heure a laquelle la serie
    commence. Une serie envoyee a 22 h a start_hour_local=22, donc son point h=20
    tombe a 18 h — en pointe. C'est precisement ce que le LLM avait rate.
    """
    hod = (h + start_hour_local) % 24
    if hod < 6 or hod >= 22:
        return "creuse"
    if 18 <= hod < 22:
        return "pointe"
    return "normale"


def _require(payload: dict, key: str) -> Any:
    if key not in payload:
        raise CalculError(f"champ obligatoire absent du payload : {key!r}")
    return payload[key]


def compute(payload: dict[str, Any]) -> dict[str, Any]:
    """Calcule le bilan horaire. Deterministe : meme entree, meme sortie."""
    series = _require(payload, "series")
    battery = _require(payload, "battery")
    tariffs = _require(payload, "tariffs")

    if not series:
        raise CalculError("la serie est vide : rien a calculer.")
    for p in PERIODS:
        if p not in tariffs:
            raise CalculError(f"tarif manquant pour la periode {p!r}")

    start_hour_local = int(payload.get("start_hour_local", 0))
    grid_cap = float(payload.get("grid_cap_mw") or DEFAULT_GRID_CAP_MW)

    capacity = float(battery["capacity_mwh"])
    p_max = float(battery["p_max_mw"])
    soc_min = float(battery["soc_min"])
    efficiency = float(battery["efficiency"])
    degradation = float(battery["degradation_cost_mwh"])

    soc_mwh = capacity * SOC_INITIAL
    floor_mwh = capacity * soc_min

    hourly: list[dict[str, Any]] = []
    cost_total = 0.0
    e_prod = e_bat = e_grid = e_deficit = 0.0
    hours_in_deficit = 0
    energy_by_period = {p: 0.0 for p in PERIODS}

    for point in series:
        h = int(point["h"])
        demand = float(point["demand_mw"])
        prod = float(point["prod_wind_mw"]) + float(point["prod_solar_mw"])

        period = tariff_period(h, start_hour_local)
        tariff = float(tariffs[period])  # MAD/MWh

        # 1. La production renouvelable sert la demande en priorite : elle est
        #    gratuite au point d'usage (l'investissement est deja consenti).
        served_prod = min(prod, demand)
        surplus = prod - served_prod
        need = demand - served_prod

        # 2. Le surplus recharge la batterie. Le rendement s'applique a la charge :
        #    1 MWh injecte ne stocke que `efficiency` MWh.
        charge = min(surplus, p_max, max(0.0, capacity - soc_mwh))
        soc_mwh = min(capacity, soc_mwh + charge * efficiency)

        # 3. La batterie ne se decharge que si son usure coute moins cher que le
        #    reseau a cette heure — et jamais sous son plancher.
        available = max(0.0, soc_mwh - floor_mwh)
        discharge = 0.0
        if need > 0 and degradation < tariff:
            discharge = min(need, p_max, available)
            soc_mwh -= discharge

        # 4. Le reseau couvre le reste — dans la limite de la puissance souscrite.
        grid = max(0.0, need - discharge)
        deficit = 0.0
        if grid > grid_cap:
            deficit = round(grid - grid_cap, 4)
            grid = grid_cap
            hours_in_deficit += 1

        hour_cost = discharge * degradation + grid * tariff
        cost_total += hour_cost

        e_prod += served_prod
        e_bat += discharge
        e_grid += grid
        e_deficit += deficit
        energy_by_period[period] += demand * 1000.0  # MW sur 1 h -> kWh

        hourly.append(
            {
                "h": h,
                "deficit_mw": round(deficit, 3),
                "soc": round(soc_mwh / capacity, 4) if capacity else 0.0,
                "dispatch_mw": round(discharge - charge, 3),  # > 0 decharge, < 0 charge
                "cost": round(hour_cost, 2),
                "grid_mw": round(grid, 3),
                "tariff_period": period,
            }
        )

    served_total = e_prod + e_bat + e_grid
    totals = {
        "total_cost": round(cost_total, 2),
        "total_deficit_mwh": round(e_deficit, 3),
        "hours_in_deficit": hours_in_deficit,
        "share_battery": round(e_bat / served_total, 4) if served_total else 0.0,
        "share_grid": round(e_grid / served_total, 4) if served_total else 0.0,
        "share_production": round(e_prod / served_total, 4) if served_total else 0.0,
        "protected_load_violations": 0,
    }

    # --- Controle d'integrite ------------------------------------------------
    # Le LLM annoncait un cout total sans rapport avec la somme de ses propres
    # lignes (10 041 MAD annonces contre 792 recalcules) et une part reseau de
    # 5,3 % alors que toutes ses lignes disaient 0. On verifie donc que les
    # agregats DECOULENT du tableau, au lieu de le pretendre.
    recomputed = round(sum(p["cost"] for p in hourly), 2)
    if abs(recomputed - totals["total_cost"]) > 1.0:
        raise CalculError(
            f"incoherence interne : total_cost={totals['total_cost']} mais la somme "
            f"des couts horaires vaut {recomputed}"
        )
    shares = totals["share_battery"] + totals["share_grid"] + totals["share_production"]
    if served_total and abs(shares - 1.0) > 0.01:
        raise CalculError(f"les parts ne somment pas a 1 : {shares}")

    # Fenetre du deficit : c'est ce que l'Agent Plan (WF-3) doit couvrir.
    deficit_hours = [h["h"] for h in hourly if h["deficit_mw"] > 0]
    deficit_summary = {
        "total_deficit_mwh": totals["total_deficit_mwh"],
        "hours_in_deficit": hours_in_deficit,
        "peak_deficit_mw": round(max((h["deficit_mw"] for h in hourly), default=0.0), 3),
        "windless_window": [min(deficit_hours), max(deficit_hours)] if deficit_hours else None,
    }

    result: dict[str, Any] = {
        "correlation_id": payload.get("correlation_id"),
        "hourly": hourly,
        "totals": totals,
        "deficit_summary": deficit_summary,
    }

    # --- Comparaison a la facture : l'economie reellement attribuable ---------
    baseline = payload.get("baseline")
    if baseline:
        base_cost = float(baseline["cost_ht_mad"])
        saving = base_cost - totals["total_cost"]
        result["comparison"] = {
            "baseline_cost_mad": round(base_cost, 2),
            "optimized_cost_mad": totals["total_cost"],
            "saving_mad": round(saving, 2),
            "saving_pct": round(saving / base_cost * 100, 2) if base_cost else 0.0,
            "source": baseline.get("source"),
            "note": (
                "L'essentiel de cette economie vient du PARC RENOUVELABLE, pas du "
                "pilotage. Utiliser --compare pour isoler l'apport propre de la batterie."
            ),
        }

    return result


def battery_contribution(payload: dict[str, Any]) -> dict[str, Any]:
    """Isole ce que le pilotage de la batterie apporte, parc renouvelable deduit.

    Sans ca, on attribue au produit une economie qui vient de l'investissement
    dans les panneaux et les eoliennes. C'est la premiere question qu'un jury pose.
    """
    import copy

    sans = copy.deepcopy(payload)
    sans["battery"] = dict(sans["battery"], capacity_mwh=1e-6, p_max_mw=1e-6)

    avec = compute(payload)
    sans_bat = compute(sans)

    base = float(payload.get("baseline", {}).get("cost_ht_mad", 0.0))
    c_avec = avec["totals"]["total_cost"]
    c_sans = sans_bat["totals"]["total_cost"]

    return {
        "facture_actuelle_mad": round(base, 2),
        "avec_parc_sans_batterie_mad": round(c_sans, 2),
        "avec_parc_et_batterie_mad": round(c_avec, 2),
        "apport_du_parc_mad": round(base - c_sans, 2),
        "apport_de_la_batterie_mad": round(c_sans - c_avec, 2),
        "apport_de_la_batterie_pct": round((c_sans - c_avec) / c_sans * 100, 2) if c_sans else 0.0,
        "deficit_sans_batterie_h": sans_bat["totals"]["hours_in_deficit"],
        "deficit_avec_batterie_h": avec["totals"]["hours_in_deficit"],
        "deficit_residuel_mwh": avec["totals"]["total_deficit_mwh"],
    }


def main() -> int:
    p = argparse.ArgumentParser(description="Agent Calcul (WF-2) — deterministe")
    p.add_argument("--in", dest="infile", default=None,
                   help="payload WF2Request (JSON). Par defaut : tire un payload frais.")
    p.add_argument("-n", "--hours", type=int, default=360)
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--compare", action="store_true",
                   help="isoler l'apport propre de la batterie")
    p.add_argument("-o", "--out", default=None)
    args = p.parse_args()

    if args.infile:
        payload = json.loads(Path(args.infile).read_text(encoding="utf-8"))
    else:
        from agent_simulation import simulate

        payload = simulate(
            mode="window",
            hours=args.hours,
            seed=args.seed,
            anchor="random" if args.seed is not None else "now",
        )

    try:
        result = compute(payload)
    except CalculError as exc:
        print(json.dumps({"error": "calcul", "detail": str(exc)}, ensure_ascii=False, indent=2))
        return 1

    if args.compare:
        result["battery_contribution"] = battery_contribution(payload)

    out = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(out, encoding="utf-8")
        print(f"Ecrit dans {args.out}")
    else:
        print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
