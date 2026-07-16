"""Simulateur EMS — « Comment piloter les ressources energetiques ? »

L'EMS est la couche INTERMEDIAIRE. Le SCADA observe, l'EMS pilote, les agents
decident. Concretement :

    ems_consignes(...) -> equilibrage production/demande, contraintes
        operationnelles, consignes par equipement et dispatch.

Difference avec l'Agent Calcul : l'agent raisonne sur 360 h pour PROPOSER un
plan a un humain ; l'EMS travaille sur l'INSTANT et applique des regles fixes,
sans validation. C'est la separation du tableau : « comment piloter » (EMS) vs
« quelle est la meilleure decision » (gestionnaire intelligent).

L'ordre de dispatch suit le cout marginal croissant, comme documents/arbitrage_cout.md :
renouvelable (gratuit) -> batterie (usure) -> reseau souscrit (tarif) -> depassement.

Donnees GENEREES pour la demonstration. Aucun equipement reel n'est pilote.
"""

from __future__ import annotations

import agent_simulation as eng

#: Bornes d'exploitation de la batterie.
SOC_MIN = 0.10
SOC_MAX = 0.95
BATTERIE_P_MAX_MW = 2.0
BATTERIE_CAPACITE_MWH = 8.0
RENDEMENT = 0.92

#: Marge de reserve : on ne pilote pas au ras des contraintes.
MARGE_RESERVE_MW = 0.05

#: Cout d'usure de la batterie, MAD/MWh decharge (constante du moteur).
DEGRADATION_MAD_MWH = 120.0
#: Etat de charge vise avant la pointe du soir. La batterie ne vaut que si elle
#: est PLEINE quand l'energie est chere : 8 MWh ne couvrent pas 15 jours, mais
#: ils ecretent les 4 heures de pointe.
SOC_CIBLE_POINTE = 0.80


def _consigne(eq_id: str, type_eq: str, valeur_mw: float, motif: str,
              limite_mw: float | None = None) -> dict:
    c = {
        "equipement_id": eq_id,
        "type": type_eq,
        "consigne_mw": round(valeur_mw, 3),
        "motif": motif,
    }
    if limite_mw is not None:
        c["limite_mw"] = round(limite_mw, 3)
    return c


def ems_consignes(
    snapshot: dict,
    demande_mw: float,
    grid_cap_mw: float,
    tarif_periode: str = "normale",
) -> dict:
    """Calcule l'equilibrage et les consignes a partir de l'etat SCADA.

    Args:
        snapshot: sortie de scada_simulation.scada_snapshot (etat des equipements).
        demande_mw: la consommation a couvrir a cet instant.
        grid_cap_mw: plafond de puissance souscrite (au-dela = depassement).
        tarif_periode: creuse / normale / pointe — pilote l'arbitrage batterie.

    Returns:
        dict : bilan, consignes par equipement, contraintes actives, dispatch.
    """
    equipements = snapshot.get("equipements", [])
    totaux = snapshot.get("totaux", {})

    # Le rack vu comme UN stockage : l'EMS pilote une enveloppe (2 MW / 8 MWh),
    # c'est le SCADA qui sait comment elle est cablee. Prendre le premier module
    # au lieu de l'agregat sous-estimerait le stockage d'un facteur N.
    modules = [e for e in equipements if e["type"] == "batterie" and e.get("disponible")]
    if modules:
        energie = sum(float(m["soc"]) * float(m["capacite_mwh"]) for m in modules)
        capacite = sum(float(m["capacite_mwh"]) for m in modules)
        soc = energie / capacite if capacite else 0.5
    else:
        soc = 0.5

    # --- 1. Le renouvelable passe toujours en premier : cout marginal nul -----
    prod_renouvelable = float(totaux.get("production_totale_mw", 0.0))
    residuel = demande_mw - prod_renouvelable  # > 0 : il manque ; < 0 : surplus

    consignes = []
    contraintes = []
    for e in equipements:
        if e["type"] in ("eolienne", "solaire"):
            consignes.append(_consigne(
                e["equipement_id"], e["type"], e["puissance_mw"],
                "production maximale disponible (cout marginal nul)",
                limite_mw=e.get("puissance_nominale_mw"),
            ))
            if not e["disponible"]:
                contraintes.append({
                    "equipement_id": e["equipement_id"],
                    "contrainte": "indisponible",
                    "detail": e["nom"] + " en " + e["etat"] + " : puissance exclue du bilan.",
                })

    # --- 2. La batterie : arbitrage, pas reflexe -----------------------------
    # 8 MWh ne tiennent pas 15 jours de deficit. Les vider a la premiere heure
    # creuse venue (reseau a 650 MAD/MWh) les rend indisponibles en pointe
    # (1400 MAD/MWh). On ne decharge donc que si c'est OBLIGATOIRE (au-dela du
    # plafond souscrit) ou RENTABLE (heure de pointe) — cf. arbitrage_cout.md.
    decharge_dispo = max(0.0, (soc - SOC_MIN) * BATTERIE_CAPACITE_MWH) * RENDEMENT
    charge_dispo = max(0.0, (SOC_MAX - soc) * BATTERIE_CAPACITE_MWH) / RENDEMENT
    hors_plafond = max(0.0, residuel - grid_cap_mw)

    batterie_mw = 0.0
    motif_batterie = "repos : bilan equilibre"

    if hors_plafond > 0:
        # Non negociable : sans la batterie, c'est le depassement et sa penalite.
        batterie_mw = round(min(hors_plafond, BATTERIE_P_MAX_MW, decharge_dispo), 3)
        motif_batterie = "decharge obligatoire : deficit au-dela du plafond souscrit"
    elif residuel > 0 and tarif_periode == "pointe":
        batterie_mw = round(min(residuel, BATTERIE_P_MAX_MW, decharge_dispo), 3)
        motif_batterie = "ecretage de pointe : le MWh stocke vaut 1400 MAD ici"
    elif residuel < 0:
        batterie_mw = round(-min(-residuel, BATTERIE_P_MAX_MW, charge_dispo), 3)
        motif_batterie = "charge sur surplus renouvelable (cout marginal nul)"
    elif tarif_periode == "creuse" and soc < SOC_CIBLE_POINTE:
        # Recharge opportuniste : on remplit tant que le reseau est bon marche,
        # sans jamais depasser le plafond souscrit.
        marge_reseau = max(0.0, grid_cap_mw - max(0.0, residuel))
        recharge = min(marge_reseau, BATTERIE_P_MAX_MW, charge_dispo)
        if recharge > MARGE_RESERVE_MW:
            batterie_mw = round(-recharge, 3)
            motif_batterie = "recharge en creuse (650 MAD/MWh) pour tenir la pointe"
    elif residuel > 0:
        motif_batterie = "repos : reseau moins cher hors pointe, batterie reservee"

    # Contraintes : ce qui a EMPECHE d'aller au bout.
    if batterie_mw > 0 and batterie_mw < hors_plafond - 0.001:
        if soc <= SOC_MIN + 0.01:
            contraintes.append({
                "equipement_id": "BESS-01", "contrainte": "soc_plancher",
                "detail": "SoC au plancher (" + str(round(SOC_MIN * 100)) + " %) : "
                          "decharge impossible, le deficit part en depassement.",
            })
        elif hors_plafond > BATTERIE_P_MAX_MW:
            contraintes.append({
                "equipement_id": "BESS-01", "contrainte": "puissance_max",
                "detail": "Deficit hors plafond (" + str(round(hors_plafond, 2)) + " MW) "
                          "au-dela de la puissance batterie ("
                          + str(BATTERIE_P_MAX_MW) + " MW).",
            })
    if residuel < 0 and soc >= SOC_MAX - 0.01:
        batterie_mw = 0.0
        motif_batterie = "repos : batterie pleine, surplus ecrete"
        contraintes.append({
            "equipement_id": "BESS-01", "contrainte": "soc_plafond",
            "detail": "SoC au plafond (" + str(round(SOC_MAX * 100)) + " %) : "
                      "le surplus ne peut plus etre stocke.",
        })

    consignes.append(_consigne("BESS-01", "batterie", batterie_mw, motif_batterie,
                               limite_mw=BATTERIE_P_MAX_MW))

    # --- 3. Le reseau boucle le bilan, dans le plafond souscrit --------------
    apres_batterie = residuel - batterie_mw
    reseau_mw = max(0.0, apres_batterie)
    depassement_mw = max(0.0, reseau_mw - grid_cap_mw)
    reseau_souscrit_mw = min(reseau_mw, grid_cap_mw)

    if depassement_mw > 0:
        contraintes.append({
            "equipement_id": "GRID", "contrainte": "depassement_souscrit",
            "detail": "Depassement de " + str(round(depassement_mw, 3)) + " MW au-dela du "
                      "plafond de " + str(grid_cap_mw) + " MW : penalise par l'ONEE.",
        })

    consignes.append(_consigne("GRID", "reseau", reseau_souscrit_mw,
                               "achat au tarif " + tarif_periode, limite_mw=grid_cap_mw))

    # Ce que l'EMS ne sait pas resoudre seul : c'est ce qui remonte aux agents.
    deficit_non_couvert = round(depassement_mw, 3)

    return {
        "ts_utc": snapshot.get("ts_utc"),
        "bilan": {
            "demande_mw": round(demande_mw, 3),
            "production_renouvelable_mw": round(prod_renouvelable, 3),
            "residuel_mw": round(residuel, 3),
            "batterie_mw": batterie_mw,
            "reseau_mw": round(reseau_souscrit_mw, 3),
            "depassement_mw": depassement_mw,
            "deficit_non_couvert_mw": deficit_non_couvert,
            "soc": round(soc, 4),
            "tarif_periode": tarif_periode,
        },
        "consignes": consignes,
        "contraintes": contraintes,
        # L'EMS applique des regles ; quand elles ne suffisent plus, il passe la
        # main. C'est exactement la frontiere EMS / gestionnaire intelligent.
        "escalade_agents": deficit_non_couvert > MARGE_RESERVE_MW,
        "motif_escalade": (
            "Deficit residuel non couvert par les leviers automatiques : "
            "arbitrage et validation humaine requis."
            if deficit_non_couvert > MARGE_RESERVE_MW else None
        ),
        "disclaimer": "Simulation de demonstration. Aucun equipement reel n'est pilote.",
    }


def etat_courant(ws10m: float, irr: float, t2m: float, hour_local: int,
                 soc: float = 0.5, grid_cap_mw: float = 0.96, seed: int | None = None) -> dict:
    """Chaine complete SCADA -> EMS pour un instant donne (utilitaire de demo)."""
    import scada_simulation as scada

    periode, _prix = eng.tariff_for_hour(hour_local)
    snap = scada.scada_snapshot(ws10m, irr, t2m, soc=soc, seed=seed)
    demande = eng.demand_mw(hour_local)
    ems = ems_consignes(snap, demande, grid_cap_mw, periode)
    # La consigne batterie de l'EMS devient la mesure vue par le SCADA au pas
    # suivant : on referme la boucle observation -> pilotage.
    snap = scada.scada_snapshot(
        ws10m, irr, t2m, soc=soc,
        puissance_batterie_mw=ems["bilan"]["batterie_mw"], seed=seed,
    )
    return {"scada": snap, "ems": ems}
