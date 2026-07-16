# =============================================================================
# HITL SLACK - POSTER (Agent Plan -> Slack)   [mode Bot Token + chat.postMessage]
# A coller dans le noeud Prompt Template qui alimente le Python Interpreter.
# Poste le plan dans le canal avec deux boutons : Valider (vert) / Refuser
# (rouge). La valeur des boutons = correlation_id, relu ensuite par l'Agent 4.
#
# Chaque execution poste une ALERTE NEUVE, horodatee a l'heure locale.
#
# A REMPLIR :
#   SLACK_BOT_TOKEN : jeton "Bot User OAuth Token" (xoxb-...) de votre app Slack.
#   CHANNEL_ID      : deja rempli (#hitl_projet_fin_specialisation).
# Le bot doit avoir le scope chat:write ET etre invite dans le canal.
#
# IMPORTANT - Global Imports du Python Interpreter :
#   requests,json,datetime,re
#
# DEUX variables sont injectees par le Prompt Template :
#   {plan}     -> la sortie de l'Agent Plan (le plan redige par le LLM)
#   {cid_reel} -> le payload A2A RECU du webhook (Agent 2).
#
# Pourquoi {cid_reel} ? Le LLM qui redige le plan INVENTE volontiers un
# correlation_id. Un identifiant invente casse le fil : le callback Slack ne
# retrouve plus le run, et le dashboard ne peut plus relier la decision. On
# prend donc l'identifiant REEL transporte par la chaine A2A, et le plan du LLM
# ne sert que de repli. Brancher la sortie du webhook sur {cid_reel} : peu
# importe le format, on extrait l'UUID.
# =============================================================================
import json
import re
from datetime import datetime, timedelta, timezone

import requests

SLACK_BOT_TOKEN = "xoxb-REMPLACER-PAR-VOTRE-BOT-TOKEN"
CHANNEL_ID = "C0BHLKL0GA0"

# --- 1. Le plan redige par l'Agent Plan -------------------------------------
plan_brut = """{plan}"""
try:
    plan = json.loads(plan_brut)
except Exception:
    plan = {"resume": plan_brut}

# --- 2. L'identifiant REEL, extrait du payload A2A --------------------------
source_cid = """{cid_reel}"""
UUID_RE = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
trouve = re.search(UUID_RE, source_cid or "")
correlation_id = trouve.group(0) if trouve else str(plan.get("correlation_id", "inconnu"))
cid_suspect = not re.fullmatch(UUID_RE, correlation_id or "")

# --- 3. Le message ----------------------------------------------------------
horodatage = datetime.now(timezone(timedelta(hours=1))).strftime("%d/%m/%Y a %H:%M")
resume = plan.get("strategie_recommandee") or plan.get("levier_retenu") or "Plan de reequilibrage"
cout = plan.get("cout_estime_mad", plan.get("estimated_cost", ""))
citations = plan.get("citations", [])

texte = "*PLAN DE REEQUILIBRAGE - VALIDATION REQUISE*\n"
texte += "Heure : " + horodatage + " (heure locale)\n"
texte += "correlation_id : " + correlation_id + "\n"
texte += "Strategie : " + str(resume) + "\n"
if cout != "":
    texte += "Cout estime : " + str(cout) + " MAD\n"
if citations:
    texte += "Sources : " + ", ".join(c.get("doc", "") for c in citations[:3]) + "\n"
if cid_suspect:
    texte += ("\n:warning: _correlation_id non conforme : {cid_reel} n'a "
              "probablement pas ete branche sur la sortie du webhook._\n")

message = dict()
message["channel"] = CHANNEL_ID
message["text"] = "Plan de reequilibrage - validation requise (" + horodatage + ")"
message["blocks"] = [
    dict(type="section", text=dict(type="mrkdwn", text=texte)),
    dict(type="actions", elements=[
        dict(type="button", text=dict(type="plain_text", text="Valider"),
             style="primary", action_id="hitl_valider", value=correlation_id),
        dict(type="button", text=dict(type="plain_text", text="Refuser"),
             style="danger", action_id="hitl_refuser", value=correlation_id),
    ]),
]

resp = requests.post(
    "https://slack.com/api/chat.postMessage",
    headers={"Authorization": "Bearer " + SLACK_BOT_TOKEN,
             "Content-Type": "application/json; charset=utf-8"},
    json=message, timeout=30,
)
data = resp.json()
print("Slack HITL: ok=" + str(data.get("ok")) + " | cid=" + correlation_id
      + " | poste a " + horodatage
      + (" | erreur=" + str(data.get("error")) if not data.get("ok") else ""))
