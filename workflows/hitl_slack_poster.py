# =============================================================================
# HITL SLACK - POSTER AUTONOME (Agent 3 Plan -> Slack)
#
# A coller dans le noeud Prompt Template "HITL : poster le plan sur Slack",
# qui alimente le Python Interpreter "Executer le post Slack".
#
# CE QUE FAIT CE SCRIPT
#   1. lit le payload A2A recu de l'Agent Calcul (variable payload)
#   2. en DERIVE la strategie et le cout, a partir du deficit horaire reel
#   3. poste une alerte NEUVE dans Slack, horodatee, avec Valider / Refuser
#
# POURQUOI DERIVER PLUTOT QUE DEMANDER AU LLM
#   Un LLM invente les chiffres : il a produit "3850 MAD" et un correlation_id
#   fantaisiste, ce qui cassait le fil (le callback ne retrouvait plus le run).
#   Ici les documents donnent la REGLE (ordre des leviers, tarifs) et les
#   donnees donnent les CHIFFRES. Le LLM ne touche plus a rien de tout ca.
#
# A REMPLIR
#   SLACK_BOT_TOKEN : le "Bot User OAuth Token" (xoxb-...) de votre app Slack.
#
# DANS LE NOEUD Python Interpreter
#   Global Imports :  requests,json,datetime,re
#
# BRANCHEMENT
#   La variable payload doit recevoir la sortie du WEBHOOK de l'Agent 3
#   (le message A2A envoye par l'Agent Calcul, qui contient le detail horaire).
#
# NOTE : le nom de la variable n'apparait entre accolades qu'A UN SEUL ENDROIT
# (la ligne "recu = ..."), et jamais dans un commentaire : le Prompt Template
# substitue partout, et un JSON multi-ligne injecte dans un commentaire ferait
# echouer le script. Pour la meme raison, aucune accolade litterale ici : on
# utilise dict() et chr(123). Meme contrainte que le script de callback.
#
# PROVISOIRE : duplique la logique de gridbalance-mcp/outil_plan.py. A remplacer
# par un appel aux outils MCP (rechercher_strategie_rag + poster_plan_hitl) des
# que le tunnel sera en place pour l'Agent 4.
# =============================================================================
import json
import re
from datetime import datetime, timedelta, timezone

import requests

SLACK_BOT_TOKEN = "xoxb-REMPLACER-PAR-VOTRE-BOT-TOKEN"
CHANNEL_ID = "C0BHLKL0GA0"

# Tarifs ONEE MT en MAD/MWh (documents/arbitrage_cout.md : creuse 0,65 /
# normale 0,90 / pointe 1,40 MAD/kWh).
TARIF_CREUSE = 650.0
# Penalite de depassement de la puissance souscrite, MAD/MWh. Valeur de
# DEMONSTRATION : le document la decrit sans la chiffrer. C'est la reference
# du "ne rien faire" : le deficit depasse le plafond, donc sans plan il serait
# facture en depassement.
PENALITE_DEPASSEMENT = 2500.0

OUVRANTE = chr(123)

recu = """{payload}"""

# --- 1. Retrouver le resultat de l'Agent Calcul ------------------------------
# Le message A2A est un texte : le JSON du calcul, suivi d'un JSON d'enveloppe.
# On balaie les objets JSON et on garde celui qui porte les donnees du calcul.
resultat = dict()
texte_recu = (recu or "").strip()
position = texte_recu.find(OUVRANTE)
while position >= 0:
    try:
        candidat, _fin = json.JSONDecoder().raw_decode(texte_recu[position:])
        porte_le_calcul = isinstance(candidat, dict) and (
            "hourly" in candidat or "totals" in candidat or "deficit_summary" in candidat
        )
        if porte_le_calcul:
            resultat = candidat
            break
    except Exception:
        pass
    position = texte_recu.find(OUVRANTE, position + 1)

# --- 2. Le correlation_id REEL, jamais celui d'un LLM ------------------------
correlation_id = str(resultat.get("correlation_id") or "").strip()
if not correlation_id:
    trouve = re.search("[0-9a-fA-F]+-[0-9a-fA-F]+-[0-9a-fA-F]+-[0-9a-fA-F]+-[0-9a-fA-F]+",
                       texte_recu)
    correlation_id = trouve.group(0) if trouve else "inconnu"

# --- 3. Repartir le deficit reel par periode tarifaire -----------------------
# Sur un pas d'une heure, les MW valent des MWh.
mwh = dict(creuse=0.0, normale=0.0, pointe=0.0)
heures = dict(creuse=0, normale=0, pointe=0)
for point in resultat.get("hourly") or []:
    deficit = float(point.get("deficit_mw") or 0.0)
    if deficit <= 0:
        continue
    periode = point.get("tariff_period", "normale")
    if periode not in mwh:
        periode = "normale"
    mwh[periode] = mwh[periode] + deficit
    heures[periode] = heures[periode] + 1

mwh_pointe = mwh["pointe"]
mwh_hors_pointe = mwh["creuse"] + mwh["normale"]
h_pointe = heures["pointe"]
h_hors_pointe = heures["creuse"] + heures["normale"]
total_mwh = mwh_pointe + mwh_hors_pointe
total_h = h_pointe + h_hors_pointe

# Repli : pas de detail horaire recu -> on garde au moins le resume.
if total_mwh == 0:
    resume = resultat.get("deficit_summary") or resultat.get("totals") or dict()
    total_mwh = float(resume.get("total_deficit_mwh") or 0.0)
    total_h = int(resume.get("hours_in_deficit") or 0)
    mwh_hors_pointe = total_mwh
    h_hors_pointe = total_h

# --- 4. Strategie et cout, derives (ordre des leviers du document) -----------
#   1. decalage de charge : le deficit de POINTE est reporte en creuse
#   2. delestage non critique : le reste ; n'achete pas d'energie
#   3. depassement : dernier recours, sert ici de reference "sans plan"
cout_plan = round(mwh_pointe * TARIF_CREUSE, 2)
cout_sans_plan = round(total_mwh * PENALITE_DEPASSEMENT, 2)
economie = round(cout_sans_plan - cout_plan, 2)

phrases = []
if mwh_pointe > 0:
    phrases.append("Decalage de charge sur " + str(h_pointe) + " h de pointe ("
                   + ("%.2f" % mwh_pointe) + " MWh reportes en creuse)")
if mwh_hors_pointe > 0:
    phrases.append("delestage des charges non critiques sur " + str(h_hors_pointe)
                   + " h (" + ("%.2f" % mwh_hors_pointe) + " MWh)")
if not phrases:
    phrases.append("Aucun deficit a couvrir")
strategie = " ; puis ".join(phrases) + " ; hopital et station d'eau preserves."

# --- 5. Le message ----------------------------------------------------------
horodatage = datetime.now(timezone(timedelta(hours=1))).strftime("%d/%m/%Y a %H:%M")

corps = "*PLAN DE REEQUILIBRAGE - VALIDATION REQUISE*\n"
corps += "Heure : " + horodatage + " (heure locale)\n"
corps += "correlation_id : " + correlation_id + "\n"
corps += ("Deficit : " + ("%.2f" % total_mwh) + " MWh sur " + str(total_h)
          + " h (pointe : " + ("%.2f" % mwh_pointe) + " MWh)\n")
corps += "Strategie : " + strategie + "\n"
# Un plan 100 % delestage coute 0 MAD : sans la reference "sans plan", le
# chiffre passerait pour une panne.
corps += ("Cout estime : " + ("%.2f" % cout_plan) + " MAD (evite "
          + ("%.2f" % economie) + " MAD de depassement)\n")
if mwh_hors_pointe > 0:
    corps += ("Energie non distribuee (delestage) : "
              + ("%.2f" % mwh_hors_pointe) + " MWh\n")
if not resultat:
    corps += ("\n:warning: _Payload de calcul introuvable : verifier que "
              "la variable payload recoit bien la sortie du webhook._\n")

message = dict()
message["channel"] = CHANNEL_ID
message["text"] = "Plan de reequilibrage - validation requise (" + horodatage + ")"
message["blocks"] = [
    dict(type="section", text=dict(type="mrkdwn", text=corps)),
    dict(type="actions", elements=[
        dict(type="button", text=dict(type="plain_text", text="Valider"),
             style="primary", action_id="hitl_valider", value=correlation_id),
        dict(type="button", text=dict(type="plain_text", text="Refuser"),
             style="danger", action_id="hitl_refuser", value=correlation_id),
    ]),
]

reponse = requests.post(
    "https://slack.com/api/chat.postMessage",
    headers=dict(Authorization="Bearer " + SLACK_BOT_TOKEN,
                 **dict([("Content-Type", "application/json; charset=utf-8")])),
    json=message, timeout=30,
)
data = reponse.json()
print("Slack HITL: ok=" + str(data.get("ok"))
      + " | cid=" + correlation_id
      + " | deficit=" + ("%.2f" % total_mwh) + " MWh"
      + " | cout=" + ("%.2f" % cout_plan) + " MAD"
      + " | poste a " + horodatage
      + (" | erreur=" + str(data.get("error")) if not data.get("ok") else ""))
