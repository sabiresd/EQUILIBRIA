# =============================================================================
# HITL SLACK - CALLBACK (clic Slack -> Agent Journal)   [version robuste]
# A coller dans le noeud Prompt Template "HITL : injecter le clic" de l'Agent 4.
# Emet une sentinelle que le routeur lit : DECISION_VALIDEE ou DECISION_REFUSEE.
#
# Gere tous les emballages observes de l'interaction Slack :
#   - {text} = {"payload": "payload=<urlencode>"}   (double emballage ABA Fusion)
#   - payload=<urlencode>                            (form body Slack brut)
#   - <json direct>
# Aucune accolade litterale (le Prompt Template les prendrait pour des variables) :
# on utilise dict() et chr(123)/chr(125).
# =============================================================================
import json
from urllib.parse import unquote

brut = """{text}"""

decision = "inconnue"
correlation_id = "0"
utilisateur = "inconnu"
action_id = "inconnu"


def extraire(raw):
    # 1. Si c'est un objet {"payload": "..."} -> prendre la valeur interne.
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict) and "payload" in obj:
            raw = obj["payload"]
    except Exception:
        pass
    # 2. Retirer un prefixe "payload=" eventuel.
    if "payload=" in raw:
        raw = raw.split("payload=", 1)[1]
    # 3. Decoder l'url-encodage.
    raw = unquote(raw)
    # 4. Isoler l'objet JSON (premiere accolade ouvrante -> derniere fermante).
    i = raw.find(chr(123))
    j = raw.rfind(chr(125))
    if i >= 0 and j > i:
        raw = raw[i:j + 1]
    return json.loads(raw)


try:
    parsed = extraire(brut)
    actions = parsed.get("actions", [])
    if actions:
        action_id = actions[0].get("action_id", "inconnu")
        correlation_id = actions[0].get("value", "0")
    user = parsed.get("user", dict())
    utilisateur = user.get("name") or user.get("username") or user.get("id", "inconnu")

    if action_id == "hitl_valider":
        decision = "validee"
    elif action_id == "hitl_refuser":
        decision = "refusee"
except Exception as e:
    decision = "erreur_parse: " + str(e)

resultat = dict(decision=decision, correlation_id=correlation_id,
                validated_by=utilisateur, action_id=action_id)

sentinelle = "DECISION_VALIDEE" if decision == "validee" else "DECISION_REFUSEE"
print(json.dumps(resultat, ensure_ascii=False))
print(sentinelle)
