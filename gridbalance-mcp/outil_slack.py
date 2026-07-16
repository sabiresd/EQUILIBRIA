"""Outil MCP - HITL Slack (poste le plan pour validation humaine).

    poster_plan_hitl(plan_json) -> ecriture externe : poste le plan dans le canal
        Slack avec deux boutons Valider (vert) / Refuser (rouge). La valeur des
        boutons porte le correlation_id, que le callback (Agent 4) relira.

Le token et le canal vivent dans gridbalance-mcp/.env (SLACK_BOT_TOKEN,
SLACK_CHANNEL_ID) : un seul endroit, pas dans les noeuds du flow. L'app Slack doit
avoir le scope chat:write et le bot doit etre invite dans le canal.
"""

import json
import os

import requests

from journal import tracer
from mongo_mcp import mcp

SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN", "")
SLACK_CHANNEL_ID = os.environ.get("SLACK_CHANNEL_ID", "C0BHLKL0GA0")


@mcp.tool()
@tracer("ecriture_externe", agent="Agent 3 - Plan")
def poster_plan_hitl(plan_json: str) -> str:
    """Poste un plan de reequilibrage dans Slack avec boutons Valider / Refuser.

    Args:
        plan_json: le plan (JSON) produit par l'Agent Plan. On y lit le
            correlation_id, la strategie, le cout et les citations RAG.
    """
    if not SLACK_BOT_TOKEN:
        return json.dumps(
            {"ok": False, "erreur": "SLACK_BOT_TOKEN absent du .env de gridbalance-mcp."},
            ensure_ascii=False,
        )
    try:
        plan = json.loads(plan_json) if isinstance(plan_json, str) else plan_json
    except Exception:
        plan = {"resume": str(plan_json)}

    cid = str(plan.get("correlation_id", "inconnu"))
    resume = plan.get("strategie_recommandee") or plan.get("levier_retenu") or "Plan de reequilibrage"
    cout = plan.get("cout_estime_mad", plan.get("estimated_cost", ""))
    citations = plan.get("citations", [])

    texte = "*PLAN DE REEQUILIBRAGE - VALIDATION REQUISE*\n"
    texte += "correlation_id : " + cid + "\n"
    texte += "Strategie : " + str(resume) + "\n"
    if cout != "":
        texte += "Cout estime : " + str(cout) + " MAD\n"
    if citations:
        texte += "Sources : " + ", ".join(c.get("doc", "") for c in citations[:3]) + "\n"

    message = {
        "channel": SLACK_CHANNEL_ID,
        "text": "Plan de reequilibrage - validation requise",
        "blocks": [
            {"type": "section", "text": {"type": "mrkdwn", "text": texte}},
            {"type": "actions", "elements": [
                {"type": "button", "text": {"type": "plain_text", "text": "Valider"},
                 "style": "primary", "action_id": "hitl_valider", "value": cid},
                {"type": "button", "text": {"type": "plain_text", "text": "Refuser"},
                 "style": "danger", "action_id": "hitl_refuser", "value": cid},
            ]},
        ],
    }
    try:
        resp = requests.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": "Bearer " + SLACK_BOT_TOKEN,
                     "Content-Type": "application/json; charset=utf-8"},
            json=message, timeout=30,
        )
        data = resp.json()
        return json.dumps(
            {"ok": bool(data.get("ok")), "correlation_id": cid,
             "erreur": data.get("error"), "ts": data.get("ts")},
            ensure_ascii=False,
        )
    except Exception as e:  # noqa: BLE001
        return json.dumps({"ok": False, "correlation_id": cid, "erreur": str(e)},
                          ensure_ascii=False)
