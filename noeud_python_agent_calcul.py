"""
=============================================================================
AGENT 2 — ARBITRAGE HORAIRE (360 h)
Code a coller dans un noeud Python de votre flow "Agent Calcul".
Il REMPLACE le noeud `Agent` (le LLM), et rien d'autre.
=============================================================================

Le reste du flow ne bouge pas :

    Webhook  ->  [CE NOEUD]  ->  Routeur "Deficit residuel ?"
                                        |-- true  --> Agent Plan    (WF-3)
                                        `-- false --> Agent Journal (WF-4)

Le routeur cherche la chaine litterale `DEFICIT_RESIDUEL` dans la sortie. Ce
code l'emet quand il reste du deficit, et `EQUILIBRE_OK` sinon. Le contrat avec
le routeur est donc respecte a l'identique -- c'est le calcul qui change, pas
le cablage.

POURQUOI un noeud Python et pas un LLM :
le dispatch d'une batterie est une recurrence a etat. Le SoC de l'heure h depend
de celui de h-1, sur 360 pas. Un LLM ne propage pas un etat sur 360 pas : il
produit des agregats plausibles. Le precedent avait ecrit `"repetition": 15` --
il calculait UNE journee et la multipliait par 15, ce qui faisait disparaitre les
episodes sans vent, c'est-a-dire le probleme meme que ce produit resout. Ses
totaux ne correspondaient pas non plus a son propre tableau (10 041 MAD annonces
contre 792 recalcules ; 5,3 % de reseau alors que toutes ses lignes disaient 0).

Bibliotheque standard uniquement. Aucune dependance a installer.
"""

import json

# --- Reglages ---------------------------------------------------------------
SOC_INITIAL = 0.80          # etat de charge au debut de l'horizon
DEFAULT_GRID_CAP_MW = 1e9   # pas de plafond si la facture n'en fournit pas
PERIODS = ("creuse", "normale", "pointe")


def tariff_period(h, start_hour_local):
    """Periode tarifaire du point h.

    L'heure locale n'est PAS h % 24 : elle depend de l'heure a laquelle la serie
    commence. Une serie envoyee a 22 h porte start_hour_local=22, donc son point
    h=20 tombe a 18 h -- en pointe, pas a 20 h du matin.
    """
    hod = (h + start_hour_local) % 24
    if hod < 6 or hod >= 22:
        return "creuse"
    if 18 <= hod < 22:
        return "pointe"
    return "normale"


def calculer(payload):
    """Dispatch batterie heure par heure. Deterministe : meme entree, meme sortie."""
    series = payload["series"]
    battery = payload["battery"]
    tariffs = payload["tariffs"]

    if not series:
        raise ValueError("serie vide : rien a calculer")

    start_hour_local = int(payload.get("start_hour_local", 0))
    grid_cap = float(payload.get("grid_cap_mw") or DEFAULT_GRID_CAP_MW)

    capacity = float(battery["capacity_mwh"])
    p_max = float(battery["p_max_mw"])
    soc_min = float(battery["soc_min"])
    efficiency = float(battery["efficiency"])
    degradation = float(battery["degradation_cost_mwh"])

    soc_mwh = capacity * SOC_INITIAL
    floor_mwh = capacity * soc_min

    hourly = []
    cost_total = 0.0
    e_prod = e_bat = e_grid = e_deficit = 0.0
    hours_in_deficit = 0
    peak_deficit = 0.0
    deficit_hours = []

    for point in series:
        h = int(point["h"])
        demand = float(point["demand_mw"])
        prod = float(point["prod_wind_mw"]) + float(point["prod_solar_mw"])

        period = tariff_period(h, start_hour_local)
        tariff = float(tariffs[period])  # MAD/MWh

        # 1. Le renouvelable sert la demande en priorite (gratuit au point d'usage).
        served_prod = min(prod, demand)
        surplus = prod - served_prod
        need = demand - served_prod

        # 2. Le surplus recharge la batterie ; le rendement s'applique a la charge.
        charge = min(surplus, p_max, max(0.0, capacity - soc_mwh))
        soc_mwh = min(capacity, soc_mwh + charge * efficiency)

        # 3. La batterie ne se decharge que si son usure coute moins que le reseau
        #    a cette heure -- et jamais sous son plancher.
        available = max(0.0, soc_mwh - floor_mwh)
        discharge = 0.0
        if need > 0 and degradation < tariff:
            discharge = min(need, p_max, available)
            soc_mwh -= discharge

        # 4. Le reseau couvre le reste, dans la limite de la puissance souscrite.
        #    Au-dela, le site serait en depassement : c'est le DEFICIT.
        grid = max(0.0, need - discharge)
        deficit = 0.0
        if grid > grid_cap:
            deficit = round(grid - grid_cap, 4)
            grid = grid_cap
            hours_in_deficit += 1
            deficit_hours.append(h)
            peak_deficit = max(peak_deficit, deficit)

        hour_cost = discharge * degradation + grid * tariff
        cost_total += hour_cost

        e_prod += served_prod
        e_bat += discharge
        e_grid += grid
        e_deficit += deficit

        hourly.append({
            "h": h,
            "deficit_mw": round(deficit, 3),
            "soc": round(soc_mwh / capacity, 4) if capacity else 0.0,
            "dispatch_mw": round(discharge - charge, 3),  # > 0 decharge, < 0 charge
            "cost": round(hour_cost, 2),
            "grid_mw": round(grid, 3),
            "tariff_period": period,
        })

    served = e_prod + e_bat + e_grid
    totals = {
        "total_cost": round(cost_total, 2),
        "total_deficit_mwh": round(e_deficit, 3),
        "hours_in_deficit": hours_in_deficit,
        "share_production": round(e_prod / served, 4) if served else 0.0,
        "share_battery": round(e_bat / served, 4) if served else 0.0,
        "share_grid": round(e_grid / served, 4) if served else 0.0,
        "protected_load_violations": 0,
    }

    # --- Controle d'integrite : les totaux DECOULENT du tableau ---------------
    # C'est exactement ce que le LLM ne faisait pas. On prefere echouer bruyamment
    # plutot que de transmettre a l'Agent Plan des chiffres qui ne veulent rien dire.
    somme = round(sum(p["cost"] for p in hourly), 2)
    if abs(somme - totals["total_cost"]) > 1.0:
        raise ValueError(
            "incoherence interne : total_cost=%s mais la somme des couts horaires "
            "vaut %s" % (totals["total_cost"], somme)
        )

    # Fenetre du deficit : c'est ce que l'Agent Plan doit couvrir.
    deficit_summary = {
        "total_deficit_mwh": totals["total_deficit_mwh"],
        "hours_in_deficit": hours_in_deficit,
        "peak_deficit_mw": round(peak_deficit, 3),
        "windless_window": (
            [min(deficit_hours), max(deficit_hours)] if deficit_hours else None
        ),
    }

    return {
        "correlation_id": payload.get("correlation_id"),
        "hourly": hourly,
        "totals": totals,
        "deficit_summary": deficit_summary,
    }


def executer(entree):
    """Point d'entree du noeud. `entree` = le payload du webhook (dict ou texte JSON)."""
    payload = json.loads(entree) if isinstance(entree, str) else entree
    # Selon la plateforme, le webhook peut emballer le corps dans une enveloppe.
    if "series" not in payload:
        for cle in ("payload", "data", "body", "input_value"):
            if isinstance(payload.get(cle), dict) and "series" in payload[cle]:
                payload = payload[cle]
                break

    resultat = calculer(payload)

    # Le routeur en aval cherche la chaine litterale DEFICIT_RESIDUEL.
    # C'est le contrat existant du flow : on le respecte a l'identique.
    reste_du_deficit = resultat["totals"]["hours_in_deficit"] > 0
    sentinelle = "DEFICIT_RESIDUEL" if reste_du_deficit else "EQUILIBRE_OK"

    return json.dumps(resultat, ensure_ascii=False) + "\n" + sentinelle


# =============================================================================
# BRANCHEMENT DANS LE NOEUD PYTHON
#
# Adaptez UNIQUEMENT ces deux lignes au composant de votre plateforme : le nom
# de la variable d'entree, et la facon de renvoyer la sortie.
#
#   Langflow "Python Interpreter" / "Custom Component" :
#       resultat = executer(input_value)     # ou self.input_value
#       return resultat
#
# Le reste du fichier n'a pas a etre modifie.
# =============================================================================

if __name__ == "__main__":
    # Test hors plateforme : python noeud_python_agent_calcul.py payload.json
    import sys

    chemin = sys.argv[1] if len(sys.argv) > 1 else "payload.json"
    with open(chemin, encoding="utf-8") as fh:
        print(executer(json.load(fh)))
