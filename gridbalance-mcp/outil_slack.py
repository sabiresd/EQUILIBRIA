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
import uuid
from datetime import datetime, timedelta, timezone

import requests

from journal import tracer
from mongo_mcp import mcp

SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN", "")
SLACK_CHANNEL_ID = os.environ.get("SLACK_CHANNEL_ID", "C0BHLKL0GA0")

#: Heure locale du site (Maroc, UTC+1) — meme convention que agent_simulation.py.
TZ_MAROC = timezone(timedelta(hours=1))


def _est_uuid(valeur: str) -> bool:
    try:
        uuid.UUID(str(valeur))
    except (ValueError, TypeError, AttributeError):
        return False
    return True


@mcp.tool()
@tracer("ecriture_externe", agent="Agent 3 - Plan")
def poster_plan_hitl(
    plan_json: str,
    correlation_id: str = "",
    strategie: str = "",
    cout_mad: str = "",
) -> str:
    """Poste un plan de reequilibrage dans Slack avec boutons Valider / Refuser.

    Chaque appel poste une ALERTE NEUVE, horodatee a l'heure locale : on suit
    ainsi chaque execution dans le canal.

    Les trois arguments explicites font AUTORITE sur le contenu de plan_json.
    Raison : le LLM qui redige le plan invente volontiers un correlation_id et un
    cout. On lui laisse la redaction, jamais les chiffres — ceux-ci viennent des
    outils deterministes (rechercher_strategie_rag / calculer_cout_optimal), qui
    les derivent du deficit horaire reel.

    Args:
        plan_json: le plan (JSON) produit par l'Agent Plan.
        correlation_id: le VRAI identifiant du run, transporte via l'A2A depuis
            l'Agent 1. Un identifiant invente casserait le fil : le callback
            Slack ne retrouverait plus le run.
        strategie: la strategie calculee (rechercher_strategie_rag).
        cout_mad: le cout calcule en MAD (calculer_cout_optimal).
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

    # Le correlation_id passe en argument fait AUTORITE : il vient de la chaine
    # A2A. Celui du plan n'est qu'un repli (potentiellement hallucine par le LLM).
    cid = str(correlation_id or plan.get("correlation_id") or "inconnu").strip()
    cid_suspect = not _est_uuid(cid)

    # Valeurs calculees d'abord ; le plan du LLM n'est qu'un repli.
    resume = (
        strategie
        or plan.get("strategie_recommandee")
        or plan.get("levier_retenu")
        or "Plan de reequilibrage"
    )
    cout = cout_mad if str(cout_mad).strip() else plan.get("cout_estime_mad", "")
    horodatage = datetime.now(TZ_MAROC).strftime("%d/%m/%Y a %H:%M")

    texte = "*PLAN DE REEQUILIBRAGE - VALIDATION REQUISE*\n"
    texte += "Heure : " + horodatage + " (heure locale)\n"
    texte += "correlation_id : " + cid + "\n"

    # Le deficit reel : ce que le superviseur doit voir pour decider.
    rep = plan.get("repartition") or {}
    if rep.get("total_mwh") is not None:
        texte += (
            "Deficit : " + str(rep["total_mwh"]) + " MWh sur "
            + str(rep.get("heures_total", "?")) + " h"
            + " (pointe : " + str((rep.get("mwh") or {}).get("pointe", 0)) + " MWh)\n"
        )

    texte += "Strategie : " + str(resume) + "\n"
    if str(cout).strip() != "":
        texte += "Cout estime : " + str(cout) + " MAD"
        # Un plan 100 % delestage coute 0 MAD : sans la reference "sans plan",
        # le chiffre passerait pour une panne.
        economie = (plan.get("detail_cout") or {}).get("economie_mad")
        if economie is not None:
            texte += (" (evite " + str(economie) + " MAD de depassement)")
        texte += "\n"
        ens = plan.get("energie_non_distribuee_mwh")
        if ens:
            texte += "Energie non distribuee (delestage) : " + str(ens) + " MWh\n"
    if cid_suspect:
        texte += (
            "\n:warning: _correlation_id non conforme (UUID attendu) : le plan n'a "
            "probablement pas recu l'identifiant reel du run._\n"
        )

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
             "poste_a": horodatage, "correlation_id_suspect": cid_suspect,
             "erreur": data.get("error"), "ts": data.get("ts")},
            ensure_ascii=False,
        )
    except Exception as e:  # noqa: BLE001
        return json.dumps({"ok": False, "correlation_id": cid, "erreur": str(e)},
                          ensure_ascii=False)
