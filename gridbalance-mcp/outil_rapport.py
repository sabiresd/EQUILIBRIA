"""Outil MCP de l'AGENT 4 - Journal & Rapport.

    generer_rapport_pdf(decision_json) -> genere un PDF de la decision, l'envoie en
        piece jointe Gmail, et stocke le resume dans Atlas. Le dashboard affiche
        alors l'historique tout seul (il lit la collection email_reports).

Ecrit dans Atlas :
    decisions      : la carte + hash SHA-256 (integrite verifiable)
    email_reports  : le rapport (schema du backend) -> apparait dans la page Rapports
"""

import io
import json
import os
import smtplib
import uuid
from datetime import datetime, timezone
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from carte import carte_valide, ecrire_decision
from journal import correlation_id_courant, tracer
from mongo_mcp import get_collection, mcp


def _pdf(card: dict, digest: str) -> bytes:
    """Genere le PDF du rapport de decision avec reportlab."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm,
                            leftMargin=2 * cm, rightMargin=2 * cm)
    styles = getSampleStyleSheet()
    h = ParagraphStyle("h", parent=styles["Title"], fontSize=18, textColor=colors.HexColor("#065f46"))
    small = ParagraphStyle("s", parent=styles["Normal"], fontSize=8, textColor=colors.grey)

    cid = str(card.get("correlation_id", "inconnu"))
    decision = card.get("decision", card.get("validation_status", "validee"))
    story = [
        Paragraph("GridBalance — Rapport de decision", h),
        Paragraph(datetime.now(timezone.utc).strftime("Genere le %Y-%m-%d %H:%M UTC"), small),
        Spacer(1, 0.6 * cm),
    ]

    rows = [
        ["correlation_id", cid],
        ["Decision", str(decision)],
        ["Valide par", str(card.get("validated_by", "-"))],
        ["Commentaire", str(card.get("comment", "-"))[:80]],
        ["Strategie", str(card.get("strategie", card.get("levier_retenu", "-")))[:80]],
        ["Deficit residuel", str(card.get("deficit_mwh", card.get("total_deficit_mwh", "-"))) + " MWh"],
        ["Cout estime", str(card.get("cout_estime_mad", card.get("total_cost", "-"))) + " MAD"],
    ]
    t = Table(rows, colWidths=[5 * cm, 11 * cm])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f0fdf4")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    story += [t, Spacer(1, 0.6 * cm)]

    cites = card.get("citations", [])
    if cites:
        story.append(Paragraph("<b>Sources (RAG)</b>", styles["Normal"]))
        for c in cites[:5]:
            story.append(Paragraph("• " + c.get("doc", "") + " — " + c.get("section", c.get("extrait", ""))[:90],
                                    styles["Normal"]))
        story.append(Spacer(1, 0.5 * cm))

    story += [
        Paragraph("<b>Integrite</b>", styles["Normal"]),
        Paragraph("SHA-256 : " + digest, small),
        Spacer(1, 0.5 * cm),
        Paragraph("Prototype de demonstration. Non connecte aux systemes de l'ONEE. "
                  "Aucun equipement reel n'est pilote. Valeurs de demonstration.", small),
    ]
    doc.build(story)
    return buf.getvalue()


def _envoyer_gmail(sujet: str, corps: str, pdf_bytes: bytes, nom_pdf: str) -> tuple[bool, list, str]:
    host = os.environ.get("SMTP_HOST")
    user = os.environ.get("SMTP_USERNAME")
    pwd = os.environ.get("SMTP_PASSWORD")
    dest = os.environ.get("EMAIL_TO", "")
    if not (host and user and pwd and dest):
        return False, [], "SMTP non configure"
    recipients = [d.strip() for d in dest.split(",") if d.strip()]
    try:
        msg = MIMEMultipart()
        msg["Subject"] = sujet
        msg["From"] = os.environ.get("EMAIL_FROM", user)
        msg["To"] = ", ".join(recipients)
        msg.attach(MIMEText(corps, "plain", "utf-8"))
        piece = MIMEApplication(pdf_bytes, _subtype="pdf")
        piece.add_header("Content-Disposition", "attachment", filename=nom_pdf)
        msg.attach(piece)
        with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "587")), timeout=20) as s:
            s.starttls()
            s.login(user, pwd)
            s.send_message(msg)
        return True, recipients, ""
    except Exception as e:  # noqa: BLE001
        return False, recipients, str(e)


@mcp.tool()
@tracer("ecriture_externe", agent="Agent 4 - Journal")
def generer_rapport_pdf(decision_json: str) -> str:
    """Genere le PDF de la decision, l'envoie en piece jointe Gmail, et stocke le
    resume dans Atlas (decisions + email_reports). Le dashboard affiche l'historique.

    Args:
        decision_json: la decision validee (plan, deficit, validateur, commentaire...).
    """
    try:
        raw = json.loads(decision_json) if isinstance(decision_json, str) else decision_json
        if not raw.get("correlation_id"):
            raw["correlation_id"] = correlation_id_courant()

        # Carte normalisee (schema strict) : PDF, hash et ecriture partagent la meme.
        card = carte_valide(raw)
        cid = card["correlation_id"]
        digest = None  # calcule par ecrire_decision (SHA-256 canonique aligne backend)

        sujet = "[GridBalance] Rapport de decision — " + cid[:8]
        nom_pdf = "rapport-" + cid[:8] + ".pdf"

        now = datetime.now(timezone.utc)
        # 1. Decision -> collection `decisions` (page Decisions du dashboard).
        report_id = str(uuid.uuid4())
        # On ecrit d'abord la decision pour obtenir le SHA-256 canonique.
        decision_id, digest = ecrire_decision(card, {"slack": True, "email": True})

        pdf_bytes = _pdf(card, digest)
        corps = ("Rapport de decision GridBalance en piece jointe.\n\n"
                 "correlation_id : " + cid + "\nSHA-256 : " + digest + "\n\n"
                 "Prototype de demonstration.")
        envoye, recipients, err = _envoyer_gmail(sujet, corps, pdf_bytes, nom_pdf)

        # 2. Rapport -> collection `email_reports` (page Rapports du dashboard).
        get_collection("email_reports").insert_one({
            "_id": report_id, "correlation_id": cid, "recipients": recipients,
            "subject": sujet, "created_at": now, "sent_by": "agent4-mcp",
            "status": "sent" if envoye else "failed",
            **({"error": err} if err else {}),
            "pdf_name": nom_pdf,
        })

        return json.dumps({
            "logged": True, "correlation_id": cid, "sha256": digest,
            "mongo_id": decision_id,
            "pdf_genere": True, "pdf_octets": len(pdf_bytes),
            "email_envoye": envoye, "destinataires": recipients,
            "report_id": report_id,
            "note": "Decision (page Decisions) + rapport (page Rapports) visibles dans le dashboard.",
        }, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        return json.dumps({"erreur": "generer_rapport_pdf : " + str(e)}, ensure_ascii=False)
