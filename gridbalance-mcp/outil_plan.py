"""Outils MCP de l'AGENT 3 - Plan.

    rechercher_strategie_rag(deficit_json) -> RAG read-file : cherche dans les
        documents une strategie applicable au deficit. Renvoie citations + plan,
        ou rag_fallback=True si la preuve est insuffisante.
    calculer_cout_optimal(resultat_json)   -> repli : compare le cout des sources
        (batterie / reseau / decalage / depassement) et retient la moins couteuse.

RAG = simple lecture de fichiers (dossier `documents/`), pas de base vectorielle,
conformement au choix du projet. Deposez vos documents la : ils sont indexes au vol.
"""

import glob
import json
import os
import re

from journal import tracer
from mongo_mcp import mcp

DOCS_DIR = os.path.join(os.path.dirname(__file__), "documents")
# Mots-cles du domaine : servent a scorer la pertinence des sections.
KEYWORDS = [
    "deficit", "pointe", "creuse", "delestage", "decalage", "charge", "batterie",
    "reseau", "souscrite", "depassement", "photovoltaique", "cout", "protege",
    "hopital", "eau", "critique", "tarif",
]

#: Tarifs ONEE MT, en MAD/MWh — repris de documents/arbitrage_cout.md
#: (creuse 0,65 / normale 0,90 / pointe 1,40 MAD/kWh).
TARIFS_MAD_MWH = {"creuse": 650.0, "normale": 900.0, "pointe": 1400.0}

#: Penalite de depassement de la puissance souscrite (MAD/MWh). Valeur de
#: DEMONSTRATION : arbitrage_cout.md la decrit ("a eviter") sans la chiffrer.
#: C'est la reference du "ne rien faire" : le deficit depasse le plafond par
#: construction, donc sans plan il est facture en depassement.
PENALITE_DEPASSEMENT_MAD_MWH = 2500.0


def _repartition_deficit(payload: dict) -> dict:
    """Repartit le deficit REEL par periode tarifaire, heure par heure.

    C'est la seule source de verite du plan : on lit `hourly` (produit par
    l'Agent Calcul, deterministe), jamais une valeur redigee par un LLM. Chaque
    point horaire porte `deficit_mw` et `tariff_period` ; sur un pas d'une heure,
    les MW valent des MWh.
    """
    mwh = {"creuse": 0.0, "normale": 0.0, "pointe": 0.0}
    heures = {"creuse": 0, "normale": 0, "pointe": 0}

    for point in payload.get("hourly") or []:
        deficit = float(point.get("deficit_mw") or 0.0)
        if deficit <= 0:
            continue
        periode = point.get("tariff_period", "normale")
        if periode not in mwh:
            periode = "normale"
        mwh[periode] += deficit
        heures[periode] += 1

    total = sum(mwh.values())
    if total == 0:
        # Repli : pas de detail horaire (on n'a recu que le resume). On ne peut
        # pas ventiler par periode ; on garde le total pour rester honnete.
        resume = payload.get("deficit_summary") or payload.get("totals") or {}
        total = float(resume.get("total_deficit_mwh") or 0.0)
        heures["normale"] = int(resume.get("hours_in_deficit") or 0)
        mwh["normale"] = total

    return {
        "mwh": {k: round(v, 3) for k, v in mwh.items()},
        "heures": heures,
        "total_mwh": round(total, 3),
        "heures_total": sum(heures.values()),
        "detail_horaire": bool(payload.get("hourly")),
    }


def _plan_deterministe(payload: dict) -> dict:
    """Construit strategie + cout a partir du deficit reel.

    Applique l'ordre de leviers de documents/strategie_delestage.md :
      1. Decalage de charge  : le deficit tombe en POINTE -> reporte en creuse.
         Le MWh est toujours consomme, mais paye au tarif creuse.
      2. Delestage non critique : le reste. Cout energie nul (le MWh n'est pas
         achete), charges protegees (hopital, eau) toujours exclues.
      3. Depassement de puissance : dernier recours, non retenu ici.
    """
    r = _repartition_deficit(payload)
    mwh_pointe = r["mwh"]["pointe"]
    mwh_hors_pointe = r["mwh"]["creuse"] + r["mwh"]["normale"]
    h_pointe = r["heures"]["pointe"]
    h_hors_pointe = r["heures"]["creuse"] + r["heures"]["normale"]

    # Levier 1 : le report en creuse fait payer le tarif creuse au lieu de pointe.
    cout_decalage = round(mwh_pointe * TARIFS_MAD_MWH["creuse"], 2)
    # Levier 2 : le delestage n'achete pas d'energie (cf. arbitrage_cout.md).
    # Son cout n'est pas monetaire mais un service coupe -> energie non distribuee.
    cout_delestage = 0.0
    cout_total = round(cout_decalage + cout_delestage, 2)

    # Reference "ne rien faire" : le deficit depasse le plafond souscrit par
    # construction, il serait donc facture en depassement. C'est ce que le plan
    # evite — sans cette reference, un plan 100 % delestage afficherait 0 MAD et
    # n'aiderait pas le superviseur a decider.
    cout_sans_plan = round(r["total_mwh"] * PENALITE_DEPASSEMENT_MAD_MWH, 2)
    economie = round(cout_sans_plan - cout_total, 2)

    leviers, phrases = [], []
    if mwh_pointe > 0:
        leviers.append("decalage_charge")
        phrases.append(
            f"Decalage de charge sur {h_pointe} h de pointe "
            f"({mwh_pointe:.2f} MWh reportes en creuse)"
        )
    if mwh_hors_pointe > 0:
        leviers.append("delestage_non_critique")
        phrases.append(
            f"delestage des charges non critiques sur {h_hors_pointe} h "
            f"({mwh_hors_pointe:.2f} MWh)"
        )
    if not phrases:
        phrases.append("Aucun deficit a couvrir")

    strategie = " ; puis ".join(phrases) + " ; hopital et station d'eau preserves."

    return {
        "strategie_recommandee": strategie,
        "cout_estime_mad": cout_total,
        "levier_retenu": leviers[0] if leviers else "aucun",
        "leviers": leviers,
        "repartition": r,
        "energie_non_distribuee_mwh": round(mwh_hors_pointe, 3),
        "detail_cout": {
            "decalage_mad": cout_decalage,
            "delestage_mad": cout_delestage,
            "cout_sans_plan_mad": cout_sans_plan,
            "economie_mad": economie,
            "tarifs_mad_mwh": TARIFS_MAD_MWH,
            "penalite_depassement_mad_mwh": PENALITE_DEPASSEMENT_MAD_MWH,
        },
    }


def _sections() -> list[dict]:
    """Decoupe chaque document en sections (## ...) indexables."""
    out = []
    for path in sorted(glob.glob(os.path.join(DOCS_DIR, "*.md"))):
        doc = os.path.basename(path)
        with open(path, encoding="utf-8") as fh:
            texte = fh.read()
        blocs = re.split(r"\n(?=#+\s)", texte)
        for b in blocs:
            b = b.strip()
            if not b:
                continue
            titre = b.splitlines()[0].lstrip("# ").strip()
            out.append({"doc": doc, "titre": titre, "texte": b})
    return out


def _score(texte: str, contexte: set[str]) -> int:
    mots = set(re.findall(r"[a-zA-Zaéèêâîôûç]+", texte.lower()))
    return len(mots & contexte)


@mcp.tool()
@tracer("lecture", agent="Agent 3 - Plan")
def rechercher_strategie_rag(deficit_json: str) -> str:
    """Cherche dans les documents une strategie applicable au deficit courant.

    Renvoie les extraits les plus pertinents (citations doc + section) et une
    strategie recommandee. Si aucun document ne couvre le cas (score trop faible),
    renvoie rag_fallback=True : l'agent passera alors a calculer_cout_optimal.

    Args:
        deficit_json: le deficit_summary ou totals renvoye par l'Agent Calcul.
    """
    try:
        d = json.loads(deficit_json) if isinstance(deficit_json, str) else deficit_json
        contexte = set(KEYWORDS)  # contexte metier + eventuels indices du deficit
        if isinstance(d, dict):
            if d.get("hours_in_deficit") or d.get("total_deficit_mwh"):
                contexte |= {"deficit", "pointe", "delestage", "decalage"}

        sections = _sections()
        if not sections:
            return json.dumps(
                {"rag_fallback": True, "motif": "Aucun document dans documents/.",
                 "citations": []}, ensure_ascii=False)

        notes = sorted(sections, key=lambda s: _score(s["texte"], contexte), reverse=True)
        top = [s for s in notes if _score(s["texte"], contexte) >= 3][:3]

        if not top:
            return json.dumps(
                {"rag_fallback": True,
                 "motif": "Preuve insuffisante : aucune section assez pertinente.",
                 "citations": []}, ensure_ascii=False)

        citations = [
            {"doc": s["doc"], "section": s["titre"], "extrait": s["texte"][:280]}
            for s in top
        ]
        # La strategie est DERIVEE du deficit reel (heures de pointe, MWh), pas
        # une phrase constante : deux situations differentes donnent deux plans
        # differents. Les documents fournissent la REGLE, les donnees les CHIFFRES.
        plan = _plan_deterministe(d if isinstance(d, dict) else {})
        return json.dumps({
            "rag_fallback": False,
            "strategie_recommandee": plan["strategie_recommandee"],
            "cout_estime_mad": plan["cout_estime_mad"],
            "levier_retenu": plan["levier_retenu"],
            "repartition": plan["repartition"],
            "energie_non_distribuee_mwh": plan["energie_non_distribuee_mwh"],
            "detail_cout": plan["detail_cout"],
            "human_validation_required": True,
            "citations": citations,
        }, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        return json.dumps({"erreur": f"rechercher_strategie_rag : {e}"}, ensure_ascii=False)


@mcp.tool()
@tracer("calcul", agent="Agent 3 - Plan")
def calculer_cout_optimal(resultat_json: str) -> str:
    """Repli quand le RAG ne tranche pas : compare le cout des sources pour couvrir
    le deficit residuel et retient la moins couteuse (decalage / batterie / reseau /
    depassement), charges protegees respectees.

    Args:
        resultat_json: le resultat de l'Agent Calcul (totals + deficit_summary + tariffs).
    """
    try:
        r = json.loads(resultat_json) if isinstance(resultat_json, str) else resultat_json
        if not isinstance(r, dict):
            r = {}

        # Meme moteur que la voie RAG : le chiffre vient du deficit horaire reel.
        # (L'ancienne version comparait des tarifs a vide et retenait toujours le
        # delestage a 0 MAD/MWh -> le cout tombait a zero quel que soit le run.)
        plan = _plan_deterministe(r)
        rep = plan["repartition"]

        return json.dumps({
            "rag_fallback": True,
            "methode": "arbitrage_cout",
            "deficit_couvert_mwh": rep["total_mwh"],
            "heures_en_deficit": rep["heures_total"],
            "repartition": rep,
            "levier_retenu": plan["levier_retenu"],
            "leviers": plan["leviers"],
            "strategie_recommandee": plan["strategie_recommandee"],
            "cout_estime_mad": plan["cout_estime_mad"],
            "energie_non_distribuee_mwh": plan["energie_non_distribuee_mwh"],
            "detail_cout": plan["detail_cout"],
            "human_validation_required": True,
            "note": "Charges protegees (hopital, eau) exclues du delestage.",
        }, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        return json.dumps({"erreur": f"calculer_cout_optimal : {e}"}, ensure_ascii=False)
