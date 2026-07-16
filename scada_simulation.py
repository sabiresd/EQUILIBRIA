"""Simulateur SCADA — « Que se passe-t-il actuellement ? »

Le SCADA est la couche BASSE : il ne decide rien, il OBSERVE. Acquisition temps
reel, etats des equipements, alarmes. C'est ce qui manquait au projet : les
agents decidaient sans jamais voir l'etat des machines.

    scada_snapshot(...) -> etat instantane du parc : une entree par equipement,
        plus les alarmes actives.

La physique n'est PAS reimplementee : la courbe de puissance et l'extrapolation
a la nacelle viennent de agent_simulation (formules (6)-(8)). Ici on descend au
niveau EQUIPEMENT — le moteur raisonne en parc (1.235 MW), le SCADA en turbines
(2 x 0.65 MW) — et on ajoute ce qu'un vrai SCADA remonte : regime, temperature,
disponibilite, defauts.

Donnees GENEREES pour la demonstration. Aucun equipement reel n'est interroge.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

import agent_simulation as eng

# --------------------------------------------------------------------------
# Inventaire du parc.
#
# REGLE : les equipements se PARTAGENT la capacite du moteur, ils ne s'y
# ajoutent pas. agent_simulation fixe le parc a 1.235 MW et le stockage a
# 8 MWh / 2 MW ; le SCADA descend a la machine SANS jamais contredire ces
# totaux. Ajouter une turbine ici ne cree pas d'energie : elle redecoupe la
# meme. Pour AGRANDIR reellement le parc, il faut changer N_WT / P_RATED_MW
# dans agent_simulation — ce qui rejoue tous les deficits et toute la demo.
# --------------------------------------------------------------------------
N_TURBINES = 6
N_BATTERIES = 4

#: Nameplate total du parc, tel que le moteur le definit (avant rendement).
_NAMEPLATE_PARC_MW = eng.N_WT * eng.P_RATED_MW
#: Stockage total, tel que le dispatch du moteur le definit.
_CAPACITE_TOTALE_MWH = 8.0
_P_MAX_TOTAL_MW = 2.0

#: Facteurs de sillage : les machines en aval voient un vent attenue. Sans cet
#: ecart, N machines identiques donneraient N courbes superposees et les cartes
#: n'apprendraient rien.
_SILLAGES = [1.00, 0.97, 0.94, 0.91, 0.89, 0.87, 0.85, 0.83]

TURBINES = [
    {
        "id": f"WT-{i + 1:02d}",
        "nom": f"Eolienne {i + 1}",
        "p_rated_mw": round(_NAMEPLATE_PARC_MW / N_TURBINES, 4),
        "sillage": _SILLAGES[i % len(_SILLAGES)],
    }
    for i in range(N_TURBINES)
]

BATTERIES = [
    {
        "id": f"BESS-{i + 1:02d}",
        "nom": f"Batterie {i + 1}",
        "capacite_mwh": round(_CAPACITE_TOTALE_MWH / N_BATTERIES, 3),
        "p_max_mw": round(_P_MAX_TOTAL_MW / N_BATTERIES, 3),
        "soc_min": 0.10,
    }
    for i in range(N_BATTERIES)
]

#: Conserve pour les appelants qui raisonnent sur le stockage agrege.
BATTERIE = {
    "id": "BESS-01",
    "nom": "Batterie lithium",
    "capacite_mwh": _CAPACITE_TOTALE_MWH,
    "p_max_mw": _P_MAX_TOTAL_MW,
    "soc_min": 0.10,
}
SOLAIRE = {"id": "PV-01", "nom": "Champ photovoltaique", "p_crete_mw": eng.SOLAR_CAPACITY_MW}

#: Regime nominal du rotor (tr/min) atteint a la vitesse nominale.
ROTOR_RPM_NOMINAL = 15.0
#: Echauffement de la nacelle a pleine charge, au-dessus de l'ambiante.
NACELLE_ECHAUFFEMENT_C = 22.0
#: Seuils d'alarme.
SEUIL_NACELLE_C = 65.0
SEUIL_SOC_BAS = 0.15
SEUIL_SOH_BAS = 0.85

ETATS = ("production", "arret_vent_faible", "arret_securite", "maintenance", "defaut")

#: Code couleur des cartes. Le SCADA le calcule LUI-MEME : la couleur est une
#: lecture de l'etat, pas une decision d'affichage. Le frontend n'a plus qu'a
#: peindre — deux ecrans differents ne peuvent donc pas diverger.
#:   vert   : en bon etat, produit ou stocke normalement
#:   orange : en decharge (le stockage se vide pour soutenir le reseau)
#:   jaune  : anomalie non bloquante (maintenance, SoC bas, temperature)
#:   rouge  : a l'arret (defaut ou arret de securite)
#:   gris   : desactive / indisponible / hors service
COULEURS = ("vert", "orange", "jaune", "rouge", "gris")


def couleur_turbine(etat: str, temp_nacelle: float) -> str:
    if etat == "defaut":
        return "rouge"
    if etat == "arret_securite":
        return "rouge"
    if etat == "maintenance":
        return "jaune"
    if etat == "arret_vent_faible":
        return "gris"  # desactive par absence de ressource, pas en panne
    if temp_nacelle > SEUIL_NACELLE_C:
        return "jaune"
    return "vert"


def couleur_batterie(etat: str, soc: float, soh: float, disponible: bool) -> str:
    if not disponible:
        return "gris"
    if soc < SEUIL_SOC_BAS or soh < SEUIL_SOH_BAS:
        return "jaune"
    if etat == "decharge":
        return "orange"
    return "vert"


def _etat_turbine(v_hub: float, indispo: bool, defaut: bool) -> str:
    """L'etat decoule du vent et de la disponibilite, dans cet ordre de priorite."""
    if defaut:
        return "defaut"
    if indispo:
        return "maintenance"
    if v_hub > eng.WIND_CUT_OUT_MS:
        return "arret_securite"  # mise en drapeau : le vent est trop fort
    if v_hub < eng.WIND_CUT_IN_MS:
        return "arret_vent_faible"
    return "production"


def parts_turbines(ws10m: float) -> list[float]:
    """Repartit la puissance du parc entre les machines, selon leur sillage.

    Le sillage REDISTRIBUE, il ne detruit pas : la somme des parts vaut
    exactement la puissance que le moteur calcule pour le parc. Sans cette
    normalisation, appliquer le sillage machine par machine amputerait le total
    de ~20 % (la puissance varie en V^3), et la page Eoliennes afficherait un
    parc different de la tuile live — deux chiffres pour la meme grandeur.
    """
    p_parc = eng.wind_power_mw(ws10m)
    if p_parc <= 0:
        return [0.0] * len(TURBINES)

    poids = [eng.wind_power_mw(ws10m * t["sillage"]) for t in TURBINES]
    total = sum(poids)
    if total <= 0:  # toutes sous le cut-in apres sillage : on repartit egalement
        return [round(p_parc / len(TURBINES), 4)] * len(TURBINES)
    return [round(p_parc * p / total, 4) for p in poids]


def turbine_telemetry(turbine: dict, ws10m: float, t2m: float, rng: random.Random,
                      part_mw: float | None = None, rh2m: float = 0.0,
                      wd10m: float = 0.0) -> dict:
    """Telemetrie d'UNE turbine pour un point meteo donne.

    Args:
        part_mw: sa part de la puissance du parc (cf. parts_turbines). Si absent,
            on retombe sur une division egale — utile pour un appel isole.
        rh2m: humidite relative (%), mesure NASA.
        wd10m: direction du vent (degres), mesure NASA.
    """
    # Le vent vu par la machine : extrapole a la nacelle, puis attenue par le
    # sillage de la turbine amont.
    v_hub = eng.wind_speed_at_hub(ws10m) * turbine["sillage"]
    v_hub = max(0.0, v_hub * (1.0 + rng.gauss(0, 0.02)))  # turbulence

    # Indisponibilites rares mais visibles sur 15 jours (demonstration).
    defaut = rng.random() < 0.004
    maintenance = (not defaut) and rng.random() < 0.010
    etat = _etat_turbine(v_hub, maintenance, defaut)

    if etat == "production":
        p_mw = round(
            part_mw if part_mw is not None else eng.wind_power_mw(ws10m) / N_TURBINES, 3
        )
        charge = p_mw / turbine["p_rated_mw"] if turbine["p_rated_mw"] else 0.0
        rpm = round(min(v_hub / eng.WIND_RATED_MS, 1.0) * ROTOR_RPM_NOMINAL, 1)
    else:
        p_mw, charge, rpm = 0.0, 0.0, 0.0

    temp_nacelle = round(t2m + NACELLE_ECHAUFFEMENT_C * charge + rng.gauss(0, 1.0), 1)
    return {
        "equipement_id": turbine["id"],
        "nom": turbine["nom"],
        "type": "eolienne",
        "etat": etat,
        "couleur": couleur_turbine(etat, temp_nacelle),
        "puissance_mw": p_mw,
        "puissance_nominale_mw": turbine["p_rated_mw"],
        "charge_pct": round(charge * 100, 1),
        "vent_nacelle_ms": round(v_hub, 2),
        "vent_10m_ms": round(ws10m, 2),
        "vent_direction_deg": round(wd10m, 1),
        "humidite_pct": round(rh2m, 1),
        "temperature_c": round(t2m, 1),
        "rotor_rpm": rpm,
        "temperature_nacelle_c": temp_nacelle,
        "disponible": etat not in ("defaut", "maintenance"),
    }


def batterie_telemetry(batterie: dict, soc: float, puissance_mw: float, t2m: float,
                       rng: random.Random, cycles: float = 0.0,
                       hors_service: bool = False) -> dict:
    """Telemetrie d'UNE batterie du rack.

    `puissance_mw` : positif = decharge (elle soutient le reseau), negatif =
    charge. C'est la convention du moteur (dispatch_mw).
    """
    soh = max(0.80, 1.0 - cycles * 0.00004)  # vieillissement lent, lie aux cycles
    if hors_service:
        etat, puissance_mw = "hors_service", 0.0
    else:
        etat = ("decharge" if puissance_mw > 0.001
                else ("charge" if puissance_mw < -0.001 else "repos"))
    disponible = (not hors_service) and soc > batterie["soc_min"]

    return {
        "equipement_id": batterie["id"],
        "nom": batterie["nom"],
        "type": "batterie",
        "etat": etat,
        "couleur": couleur_batterie(etat, soc, soh, disponible),
        "soc": round(soc, 4),
        "soc_pct": round(soc * 100, 1),
        "puissance_mw": round(puissance_mw, 3),
        "p_max_mw": batterie["p_max_mw"],
        "energie_stockee_mwh": round(soc * batterie["capacite_mwh"], 3),
        "capacite_mwh": batterie["capacite_mwh"],
        "soh_pct": round(soh * 100, 1),
        "cycles": round(cycles, 1),
        "temperature_c": round(t2m + 6.0 + abs(puissance_mw) * 2.0 + rng.gauss(0, 0.6), 1),
        "disponible": disponible,
    }


def repartir_batteries(consigne_mw: float, socs: list[float],
                       hors_service: list[bool] | None = None) -> list[float]:
    """Repartit une consigne AGREGEE sur le rack, au prorata de la marge de chaque
    module.

    L'EMS raisonne sur un stockage unique (2 MW / 8 MWh) : c'est le SCADA qui
    sait comment le rack est cable. Une repartition egale viderait les modules
    deja bas et saturerait les pleins — on suit donc la marge disponible.
    """
    hs = hors_service or [False] * len(socs)
    marges = []
    for i, (bat, soc) in enumerate(zip(BATTERIES, socs, strict=False)):
        if hs[i]:
            marges.append(0.0)
        elif consigne_mw > 0:  # decharge : marge = ce qui est au-dessus du plancher
            marges.append(max(0.0, (soc - bat["soc_min"]) * bat["capacite_mwh"]))
        else:  # charge : marge = ce qui reste a remplir
            marges.append(max(0.0, (0.95 - soc) * bat["capacite_mwh"]))

    total = sum(marges)
    if total <= 0:
        return [0.0] * len(socs)

    parts = []
    for i, marge in enumerate(marges):
        part = consigne_mw * (marge / total)
        # Jamais au-dela de la puissance du module.
        plafond = BATTERIES[i]["p_max_mw"]
        parts.append(round(max(-plafond, min(plafond, part)), 4))
    return parts


def solaire_telemetry(irr: float, t2m: float, rng: random.Random) -> dict:
    p_mw = eng.solar_power_mw(irr, t2m)
    etat = "production" if p_mw > 0.01 else "nuit"
    return {
        "equipement_id": SOLAIRE["id"],
        "nom": SOLAIRE["nom"],
        "type": "solaire",
        "etat": etat,
        "couleur": "vert" if etat == "production" else "gris",
        "puissance_mw": p_mw,
        "puissance_nominale_mw": SOLAIRE["p_crete_mw"],
        "charge_pct": round(p_mw / SOLAIRE["p_crete_mw"] * 100, 1) if SOLAIRE["p_crete_mw"] else 0.0,
        "irradiance_wm2": round(irr, 1),
        "temperature_module_c": round(t2m + 25.0 * (irr / eng.SOLAR_STC_IRRADIANCE), 1),
        "disponible": True,
    }


def _alarmes(equipements: list[dict], ts: str) -> list[dict]:
    """Derive les alarmes des mesures. Une alarme n'est jamais inventee : elle
    est la consequence d'un seuil franchi, donc toujours explicable."""
    out = []

    def ajoute(eq_id: str, code: str, severite: str, message: str) -> None:
        out.append({
            "equipement_id": eq_id, "code": code, "severite": severite,
            "message": message, "ts_utc": ts, "acquittee": False,
        })

    for e in equipements:
        if e.get("etat") == "defaut":
            ajoute(e["equipement_id"], "EQ_DEFAUT", "critique",
                   e["nom"] + " en defaut : production interrompue.")
        elif e.get("etat") == "maintenance":
            ajoute(e["equipement_id"], "EQ_MAINTENANCE", "info",
                   e["nom"] + " en maintenance planifiee.")
        elif e.get("etat") == "arret_securite":
            ajoute(e["equipement_id"], "VENT_CUT_OUT", "avertissement",
                   e["nom"] + " mise en drapeau : vent > "
                   + str(eng.WIND_CUT_OUT_MS) + " m/s.")

        if e.get("temperature_nacelle_c", 0) > SEUIL_NACELLE_C:
            ajoute(e["equipement_id"], "TEMP_NACELLE", "avertissement",
                   "Temperature nacelle elevee : "
                   + str(e["temperature_nacelle_c"]) + " C.")

        if e.get("type") == "batterie":
            if e.get("soc", 1) < SEUIL_SOC_BAS:
                ajoute(e["equipement_id"], "SOC_BAS", "avertissement",
                       "Etat de charge bas : " + str(e["soc_pct"]) + " %.")
            if e.get("soh_pct", 100) < SEUIL_SOH_BAS * 100:
                ajoute(e["equipement_id"], "SOH_BAS", "avertissement",
                       "Sante de la batterie degradee : " + str(e["soh_pct"]) + " %.")
    return out


def scada_snapshot(
    ws10m: float,
    irr: float,
    t2m: float,
    soc: float = 0.5,
    puissance_batterie_mw: float = 0.0,
    cycles: float = 0.0,
    ts_utc: str | None = None,
    seed: int | None = None,
    socs: list[float] | None = None,
    rh2m: float = 0.0,
    wd10m: float = 0.0,
) -> dict:
    """Etat instantane du parc, vu par le SCADA.

    Args:
        soc: etat de charge AGREGE du rack (si `socs` n'est pas fourni).
        puissance_batterie_mw: consigne AGREGEE, repartie sur le rack.
        socs: etat de charge module par module (prioritaire sur `soc`).

    Returns:
        dict : equipements (turbines + batteries + PV), alarmes, totaux.
    """
    rng = random.Random(seed)
    ts = ts_utc or datetime.now(timezone.utc).isoformat()

    charges = list(socs) if socs else [soc] * len(BATTERIES)
    # Une panne franche par rack, rare : c'est ce qui donne une carte GRISE et
    # rend le code couleur lisible sur la page.
    hors_service = [rng.random() < 0.006 for _ in BATTERIES]
    parts_bess = repartir_batteries(puissance_batterie_mw, charges, hors_service)
    parts_wt = parts_turbines(ws10m)

    equipements = [
        turbine_telemetry(t, ws10m, t2m, rng, parts_wt[i], rh2m, wd10m)
        for i, t in enumerate(TURBINES)
    ]
    for i, bat in enumerate(BATTERIES):
        equipements.append(
            batterie_telemetry(bat, charges[i], parts_bess[i], t2m, rng,
                               cycles / max(1, len(BATTERIES)), hors_service[i])
        )
    equipements.append(solaire_telemetry(irr, t2m, rng))

    prod_eolien = round(sum(e["puissance_mw"] for e in equipements if e["type"] == "eolienne"), 3)
    prod_solaire = round(sum(e["puissance_mw"] for e in equipements if e["type"] == "solaire"), 3)
    batterie_mw = round(sum(e["puissance_mw"] for e in equipements if e["type"] == "batterie"), 3)
    alarmes = _alarmes(equipements, ts)

    par_couleur = {c: sum(1 for e in equipements if e.get("couleur") == c) for c in COULEURS}

    return {
        "ts_utc": ts,
        "meteo": {
            "vent_10m_ms": round(ws10m, 2),
            "vent_direction_deg": round(wd10m, 1),
            "humidite_pct": round(rh2m, 1),
            "temperature_c": round(t2m, 1),
            "irradiance_wm2": round(irr, 1),
        },
        "equipements": equipements,
        "alarmes": alarmes,
        "totaux": {
            "production_eolienne_mw": prod_eolien,
            "production_solaire_mw": prod_solaire,
            "production_totale_mw": round(prod_eolien + prod_solaire, 3),
            "batterie_mw": batterie_mw,
            "equipements_disponibles": sum(1 for e in equipements if e["disponible"]),
            "equipements_total": len(equipements),
            "alarmes_actives": len(alarmes),
            "alarmes_critiques": sum(1 for a in alarmes if a["severite"] == "critique"),
            **{f"couleur_{c}": n for c, n in par_couleur.items()},
        },
        "disclaimer": "Donnees de demonstration. Aucun equipement reel n'est interroge.",
    }
