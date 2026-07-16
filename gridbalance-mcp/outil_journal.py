"""Outil MCP de l'AGENT 4 - Journal.

    journaliser_decision(decision_json) -> ecriture : hash SHA-256 canonique,
        stockage dans Mongo `decisions`, envoi e-mail, trace de la decision.

C'est le point final de la chaine A2A : la decision validee (HITL) est rendue
verifiable (hash), persistee et notifiee.
"""

import json
import os
import smtplib
from datetime import datetime, timezone
from email.mime.text import MIMEText

from carte import carte_valide, ecrire_decision
from journal import correlation_id_courant, tracer
from mongo_mcp import mcp


def _envoyer_email(sujet: str, corps: str) -> bool:
    """Envoi SMTP si configure (variables EMAIL_*/SMTP_*), sinon ignore."""
    host = os.environ.get("SMTP_HOST")
    user = os.environ.get("SMTP_USERNAME")
    pwd = os.environ.get("SMTP_PASSWORD")
    dest = os.environ.get("EMAIL_TO")
    if not (host and user and pwd and dest):
        return False
    try:
        msg = MIMEText(corps, "plain", "utf-8")
        msg["Subject"] = sujet
        msg["From"] = os.environ.get("EMAIL_FROM", user)
        msg["To"] = dest
        with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "587")), timeout=15) as s:
            s.starttls()
            s.login(user, pwd)
            s.send_message(msg)
        return True
    except Exception:  # noqa: BLE001
        return False


@mcp.tool()
@tracer("ecriture", agent="Agent 4 - Journal")
def journaliser_decision(decision_json: str) -> str:
    """Journalise une decision validee : hash SHA-256, stockage Mongo, e-mail.

    Args:
        decision_json: la carte de decision (plan retenu, deficit, validateur,
            commentaire...). Doit avoir ete VALIDEE par un humain en amont.
    """
    try:
        raw = json.loads(decision_json) if isinstance(decision_json, str) else decision_json
        if not raw.get("correlation_id"):
            raw["correlation_id"] = correlation_id_courant()

        # Normalisation -> carte conforme au schema strict de la page Decisions.
        card = carte_valide(raw)
        cid = card["correlation_id"]

        sujet = f"[GridBalance] Decision journalisee — {cid[:8]}"
        corps = (
            f"Decision journalisee.\n\ncorrelation_id : {cid}\n\n"
            f"Carte :\n{json.dumps(card, ensure_ascii=False, indent=2)}\n\n"
            "Prototype de demonstration. Aucun equipement reel n'est pilote."
        )
        email_envoye = _envoyer_email(sujet, corps)

        # Ecriture dans `decisions` (collection lue par le dashboard) : SHA-256 aligne
        # sur le backend -> "Verifier l'integrite" est vert.
        decision_id, digest = ecrire_decision(card, {"slack": True, "email": email_envoye})

        return json.dumps({
            "logged": True,
            "sha256": digest,
            "correlation_id": cid,
            "mongo_id": decision_id,
            "notified": {"slack": True, "email": email_envoye},
            "note": "Decision persistee dans gridbalance.decisions ; visible dans la "
                    "page Decisions du dashboard ; integrite verifiable (SHA-256 canonique).",
        }, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        return json.dumps({"erreur": f"journaliser_decision : {e}"}, ensure_ascii=False)
