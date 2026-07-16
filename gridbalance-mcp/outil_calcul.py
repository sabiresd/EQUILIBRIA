"""Outil MCP de l'AGENT 2 - Calcul.

    calculer_dispatch(payload_json) -> calcul : dispatch batterie deterministe sur
    360 h, deficits, couts. Decide de la suite : DEFICIT (-> Agent Plan) ou
    EQUILIBRE (-> Agent Journal).

Deterministe : c'est une recurrence a etat (le SoC de l'heure h depend de h-1).
Un LLM ne propage pas un etat sur 360 pas ; ce calcul, si.
"""

import json

from journal import tracer
from mongo_mcp import mcp

from agent_calcul import compute


@mcp.tool()
@tracer("calcul", agent="Agent 2 - Calcul")
def calculer_dispatch(payload_json: str) -> str:
    """Calcule le bilan horaire, le dispatch batterie, les deficits et les couts.

    Prend le payload de l'Agent Simulateur (contrat WF2Request) et renvoie
    hourly + totals + deficit_summary, plus une `decision` (DEFICIT / EQUILIBRE)
    qui aiguille la suite de la chaine A2A.

    Args:
        payload_json: le JSON renvoye par recuperer_donnees_reseau().
    """
    try:
        payload = json.loads(payload_json) if isinstance(payload_json, str) else payload_json
        # Tolerance : certaines plateformes emballent le corps du webhook.
        if "series" not in payload:
            for cle in ("payload", "data", "body", "input_value", "result"):
                inner = payload.get(cle)
                if isinstance(inner, str):
                    try:
                        inner = json.loads(inner)
                    except ValueError:
                        continue
                if isinstance(inner, dict) and "series" in inner:
                    payload = inner
                    break

        result = compute(payload)
        totals = result["totals"]
        deficit = totals["hours_in_deficit"] > 0
        result["decision"] = "DEFICIT" if deficit else "EQUILIBRE"
        result["prochaine_etape"] = "agent_plan" if deficit else "agent_journal"
        return json.dumps(result, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        return json.dumps({"erreur": f"calculer_dispatch : {e}"}, ensure_ascii=False)
