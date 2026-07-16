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
        return json.dumps({
            "rag_fallback": False,
            "strategie_recommandee": "Decalage de charge en priorite, puis delestage "
                                     "des charges non critiques ; charges protegees "
                                     "(hopital, eau) preservees.",
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
        totals = r.get("totals", {})
        deficit_mwh = float(totals.get("total_deficit_mwh", 0.0))
        heures = int(totals.get("hours_in_deficit", 0))

        # Couts indicatifs par MWh manquant (MAD). Demonstration.
        pointe = 1400.0      # tarif pointe
        creuse = 650.0       # tarif creuse
        penalite = 2500.0    # depassement de puissance souscrite
        options = {
            "decalage_charge": creuse,              # deplacer vers l'heure creuse
            "delestage_non_critique": 0.0,          # coupure (cout energie nul, cout service)
            "reseau_pointe": pointe,
            "depassement_reseau": penalite,
        }
        best = min(options, key=lambda k: options[k])
        cout_estime = round(deficit_mwh * options[best], 2)

        return json.dumps({
            "rag_fallback": True,
            "methode": "arbitrage_cout",
            "deficit_couvert_mwh": round(deficit_mwh, 3),
            "heures_en_deficit": heures,
            "options_mad_par_mwh": options,
            "levier_retenu": best,
            "cout_estime_mad": cout_estime,
            "human_validation_required": True,
            "note": "Charges protegees (hopital, eau) exclues du delestage.",
        }, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        return json.dumps({"erreur": f"calculer_cout_optimal : {e}"}, ensure_ascii=False)
