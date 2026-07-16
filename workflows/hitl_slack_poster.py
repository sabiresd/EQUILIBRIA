# =============================================================================
# HITL SLACK - POSTER (Agent Plan -> Slack)   [mode Bot Token + chat.postMessage]
# A coller dans un noeud Prompt Template (qui alimente un Python Interpreter),
# comme dans Mini-Projet S4 / JeudiAnass. Poste le plan dans le canal avec deux
# boutons : Valider (vert) / Refuser (rouge). La valeur du bouton = correlation_id.
#
# A REMPLIR :
#   SLACK_BOT_TOKEN : jeton "Bot User OAuth Token" (xoxb-...) de votre app Slack.
#   CHANNEL_ID      : deja rempli (#hitl_projet_fin_specialisation).
# Le bot doit avoir le scope chat:write ET etre invite dans le canal
# (/invite @votre_bot dans le canal).
#
# La variable {plan} est injectee par le Prompt Template (sortie de l'Agent Plan).
# =============================================================================
import json
import requests

SLACK_BOT_TOKEN = "xoxb-REMPLACER-PAR-VOTRE-BOT-TOKEN"
CHANNEL_ID = "C0BHLKL0GA0"

plan_brut = """{plan}"""
try:
    plan = json.loads(plan_brut)
except Exception:
    plan = {"resume": plan_brut}

correlation_id = str(plan.get("correlation_id", "inconnu"))
resume = plan.get("strategie_recommandee") or plan.get("levier_retenu") or "Plan de reequilibrage"
cout = plan.get("cout_estime_mad", plan.get("estimated_cost", ""))
citations = plan.get("citations", [])

texte = "*PLAN DE REEQUILIBRAGE - VALIDATION REQUISE*\n"
texte += "correlation_id : " + correlation_id + "\n"
texte += "Strategie : " + str(resume) + "\n"
if cout != "":
    texte += "Cout estime : " + str(cout) + " MAD\n"
if citations:
    texte += "Sources : " + ", ".join(c.get("doc", "") for c in citations[:3]) + "\n"

message = dict()
message["channel"] = CHANNEL_ID
message["text"] = "Plan de reequilibrage - validation requise"
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
      + (" | erreur=" + str(data.get("error")) if not data.get("ok") else ""))
