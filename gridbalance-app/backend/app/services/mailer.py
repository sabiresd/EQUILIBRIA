"""E-mails : templates HTML + envoi (SMTP ou fichier local) + planification."""
from __future__ import annotations

import logging
import smtplib
from datetime import UTC, datetime
from email.message import EmailMessage
from pathlib import Path
from uuid import uuid4

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.config import settings
from app.core.db import get_db
from app.services import audit
from contracts.contracts import DISCLAIMER

log = logging.getLogger("gridbalance.mailer")
scheduler = AsyncIOScheduler()


def _bar(label: str, value: float, total: float, color: str) -> str:
    pct = 0 if total <= 0 else min(100, round(100 * value / total))
    return f"""
      <tr>
        <td style="padding:4px 8px;color:#94a3b8;font-size:13px">{label}</td>
        <td style="padding:4px 8px;width:60%">
          <div style="background:#0d1b2b;border-radius:4px;height:10px">
            <div style="background:{color};width:{pct}%;height:10px;border-radius:4px"></div>
          </div>
        </td>
        <td style="padding:4px 8px;color:#e2e8f0;font-size:13px;text-align:right">{pct}%</td>
      </tr>"""


def render_report(run: dict, decision: dict | None) -> str:
    totals = run.get("totals") or {}
    cid = run["correlation_id"]
    card = (decision or {}).get("card", {})
    sha = (decision or {}).get("sha256", "—")

    plan_block = ""
    if decision:
        actions = "".join(
            f"<li style='margin:4px 0'><strong>{a['site']}</strong> — {a['action']} "
            f"{a['delta_mw']} MW sur {len(a['hours'])} h</li>"
            for a in card.get("actions", [])
        )
        plan_block = f"""
        <h3 style="color:#17c884;margin:24px 0 8px">Plan validé — {card.get('plan_id')}</h3>
        <ul style="color:#cbd5e1;font-size:14px;padding-left:18px;margin:0">{actions}</ul>
        <p style="color:#94a3b8;font-size:13px;margin:12px 0 0">
          Validé par <strong style="color:#e2e8f0">{card.get('validated_by')}</strong><br>
          Commentaire : « {card.get('comment')} »
        </p>
        <p style="color:#64748b;font-size:11px;font-family:monospace;margin:8px 0 0;
                  word-break:break-all">SHA-256 : {sha}</p>"""

    prod = totals.get("share_production", 0)
    bat = totals.get("share_battery", 0)
    grid = totals.get("share_grid", 0)

    return f"""<!doctype html>
<html lang="fr"><body style="margin:0;background:#040e1b;font-family:system-ui,-apple-system,Segoe UI,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:32px 24px">
    <h1 style="color:#17c884;font-size:22px;margin:0 0 4px">GridBalance AI Morocco</h1>
    <p style="color:#64748b;font-size:13px;margin:0 0 24px">
      Rapport de simulation — {datetime.now(UTC):%d/%m/%Y %H:%M} UTC
    </p>

    <div style="background:#0a1626;border:1px solid #1e293b;border-radius:10px;padding:20px">
      <h2 style="color:#e2e8f0;font-size:16px;margin:0 0 16px">Indicateurs clés</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="color:#94a3b8;font-size:13px;padding:6px 0">Coût total (démo)</td>
          <td style="color:#e2e8f0;font-size:15px;text-align:right;font-weight:600">
            {totals.get('total_cost', 0):,.0f} MAD</td>
        </tr>
        <tr>
          <td style="color:#94a3b8;font-size:13px;padding:6px 0">Déficit résiduel</td>
          <td style="color:#f59e0b;font-size:15px;text-align:right;font-weight:600">
            {totals.get('total_deficit_mwh', 0):,.1f} MWh</td>
        </tr>
        <tr>
          <td style="color:#94a3b8;font-size:13px;padding:6px 0">Heures en déficit</td>
          <td style="color:#e2e8f0;font-size:15px;text-align:right;font-weight:600">
            {totals.get('hours_in_deficit', 0)}</td>
        </tr>
        <tr>
          <td style="color:#94a3b8;font-size:13px;padding:6px 0">Violations charges protégées</td>
          <td style="color:{'#17c884' if not totals.get('protected_load_violations') else '#ef4444'};
                     font-size:15px;text-align:right;font-weight:600">
            {totals.get('protected_load_violations', 0)} <span style="font-size:12px">(cible 0)</span></td>
        </tr>
      </table>

      <h3 style="color:#e2e8f0;font-size:14px;margin:20px 0 8px">Mix de couverture</h3>
      <table style="width:100%;border-collapse:collapse">
        {_bar('Production', prod, 1, '#17c884')}
        {_bar('Batterie', bat, 1, '#38bdf8')}
        {_bar('Réseau', grid, 1, '#f59e0b')}
      </table>
      {plan_block}
    </div>

    <p style="text-align:center;margin:24px 0">
      <a href="{settings.app_public_url}/decisions"
         style="background:#17c884;color:#040e1b;text-decoration:none;padding:10px 20px;
                border-radius:6px;font-weight:600;font-size:14px">Ouvrir dans l'application</a>
    </p>

    <p style="color:#64748b;font-size:11px;font-family:monospace;margin:16px 0 0">
      correlation_id : {cid}
    </p>
    <p style="color:#475569;font-size:11px;line-height:1.6;margin:16px 0 0;
              border-top:1px solid #1e293b;padding-top:16px">{DISCLAIMER}</p>
  </div>
</body></html>"""


OUTBOX = Path(__file__).resolve().parents[2] / "outbox"


def _write_to_outbox(to: list[str], subject: str, html: str) -> Path:
    """Ecrit l'e-mail en fichier HTML, a ouvrir dans un navigateur.

    C'est le mode par defaut en local (MAIL_MODE=file) : il evite d'avoir a installer
    un serveur SMTP juste pour voir un rapport. Le fichier contient l'en-tete
    destinataires/sujet, puis le corps HTML tel qu'il serait envoye.
    """
    OUTBOX.mkdir(exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S-%f")
    path = OUTBOX / f"{stamp}.html"
    header = (
        "<div style='background:#17c884;color:#040e1b;padding:10px 16px;"
        "font-family:system-ui;font-size:13px'>"
        f"<strong>A :</strong> {', '.join(to)} &nbsp;|&nbsp; "
        f"<strong>Sujet :</strong> {subject} &nbsp;|&nbsp; "
        "<em>e-mail non envoye : mode fichier local</em></div>"
    )
    path.write_text(header + html, encoding="utf-8")
    log.info("E-mail ecrit dans %s", path)
    return path


def _send(to: list[str], subject: str, html: str) -> None:
    """Envoie l'e-mail, ou l'ecrit dans outbox/ selon MAIL_MODE.

    MAIL_MODE=file (defaut en local) -> fichier HTML dans backend/outbox/
    MAIL_MODE=smtp                   -> envoi SMTP reel (Mailhog, Gmail, etc.)
    """
    if settings.mail_mode == "file":
        _write_to_outbox(to, subject, html)
        return

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    msg.set_content(
        "Votre client e-mail n'affiche pas le HTML. Ouvrez l'application pour le rapport complet."
    )
    msg.add_alternative(html, subtype="html")

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        if settings.smtp_tls:
            smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_pass)
        smtp.send_message(msg)


async def send_report(correlation_id: str, recipients: list[str], actor: str) -> dict:
    db = get_db()
    run = await db.runs.find_one({"_id": correlation_id})
    if not run:
        raise ValueError("Run introuvable.")
    decision = await db.decisions.find_one({"correlation_id": correlation_id})

    html = render_report(run, decision)
    record = {
        "_id": str(uuid4()),
        "correlation_id": correlation_id,
        "recipients": recipients,
        "subject": f"GridBalance — rapport de simulation {correlation_id[:8]}",
        "created_at": datetime.now(UTC),
        "sent_by": actor,
    }
    try:
        _send(recipients, record["subject"], html)
        record["status"] = "sent"
    except Exception as exc:  # noqa: BLE001 — l'echec SMTP ne doit pas casser l'app
        record["status"] = "failed"
        record["error"] = str(exc)

    await db.email_reports.insert_one(record)
    await audit.log(
        "report.send",
        actor=actor,
        correlation_id=correlation_id,
        detail={"recipients": recipients, "status": record["status"]},
    )
    return record


async def send_alert_email(alert: dict) -> None:
    """Alerte envoyee aux supervisors et aux admins."""
    db = get_db()
    supervisors = [
        u["email"]
        async for u in db.users.find({"role": {"$in": ["supervisor", "admin"]}, "active": True})
    ]
    if not supervisors:
        return
    html = f"""<!doctype html><html lang="fr"><body
      style="background:#040e1b;font-family:system-ui,sans-serif;padding:32px">
      <div style="max-width:560px;margin:0 auto;background:#0a1626;border:1px solid #1e293b;
                  border-left:3px solid #f59e0b;border-radius:8px;padding:20px">
        <h2 style="color:#f59e0b;font-size:16px;margin:0 0 8px">Alerte — {alert['rule']}</h2>
        <p style="color:#e2e8f0;font-size:14px;margin:0 0 12px">{alert['message']}</p>
        <p style="color:#64748b;font-size:11px;font-family:monospace;margin:0">
          correlation_id : {alert.get('correlation_id') or '—'}</p>
        <p style="color:#475569;font-size:11px;line-height:1.6;margin:16px 0 0;
                  border-top:1px solid #1e293b;padding-top:12px">{DISCLAIMER}</p>
      </div></body></html>"""
    try:
        _send(supervisors, f"[GridBalance] Alerte {alert['severity']} — {alert['rule']}", html)
    except Exception:  # noqa: BLE001
        pass


async def _scheduled_report(recipients: list[str]) -> None:
    db = get_db()
    run = await db.runs.find_one({"status": "done"}, sort=[("created_at", -1)])
    if run:
        await send_report(run["_id"], recipients, actor="scheduler")


def schedule_report(frequency: str, recipients: list[str]) -> str:
    job_id = f"report-{frequency}"
    trigger = (
        CronTrigger(hour=7, minute=0)
        if frequency == "daily"
        else CronTrigger(day_of_week="mon", hour=7, minute=0)
    )
    scheduler.add_job(
        _scheduled_report,
        trigger,
        args=[recipients],
        id=job_id,
        replace_existing=True,
    )
    return job_id
