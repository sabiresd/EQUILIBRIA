"""Cartes de decision : historique, verification d'integrite, export JSON/PDF."""
from __future__ import annotations

import io
import json

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse, StreamingResponse
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from app.core.db import get_db
from app.core.security import TokenUser, require
from app.services import audit, orchestrator
from contracts.contracts import DISCLAIMER, canonical_json

router = APIRouter(prefix="/api/decisions", tags=["decisions"])


def _out(d: dict) -> dict:
    d["id"] = d.pop("_id")
    return d


@router.get("")
async def list_decisions(user: TokenUser = Depends(require("decision:read"))) -> list[dict]:
    cursor = get_db().decisions.find().sort("created_at", -1)
    return [_out(d) async for d in cursor]  # type: ignore[misc]


@router.get("/{decision_id}")
async def get_decision(
    decision_id: str, user: TokenUser = Depends(require("decision:read"))
) -> dict:
    d = await get_db().decisions.find_one({"_id": decision_id})
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Decision introuvable")
    return _out(d)


@router.get("/{decision_id}/verify")
async def verify(decision_id: str, user: TokenUser = Depends(require("decision:read"))) -> dict:
    d = await get_db().decisions.find_one({"_id": decision_id})
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Decision introuvable")
    result = orchestrator.verify_decision(d)
    await audit.log(
        "decision.verify",
        actor=user.email,
        correlation_id=d["correlation_id"],
        detail={"valid": result["valid"]},
    )
    return result


@router.get("/{decision_id}/json")
async def download_json(
    decision_id: str, user: TokenUser = Depends(require("decision:read"))
) -> JSONResponse:
    d = await get_db().decisions.find_one({"_id": decision_id})
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Decision introuvable")
    # On renvoie le JSON CANONIQUE : c'est exactement la chaine qui a ete hashee.
    payload = json.loads(canonical_json(d["card"]))
    return JSONResponse(
        payload,
        headers={
            "Content-Disposition": f'attachment; filename="decision-{decision_id[:8]}.json"'
        },
    )


@router.get("/{decision_id}/pdf")
async def download_pdf(
    decision_id: str, user: TokenUser = Depends(require("decision:read"))
) -> StreamingResponse:
    d = await get_db().decisions.find_one({"_id": decision_id})
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Decision introuvable")

    card = d["card"]
    buf = io.BytesIO()
    pdf = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    y = height - 25 * mm

    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(20 * mm, y, "GridBalance AI Morocco — Carte de decision")
    y -= 10 * mm

    pdf.setFont("Helvetica", 9)
    for label, value in [
        ("Plan retenu", card["plan_id"]),
        ("correlation_id", card["correlation_id"]),
        ("Propose par", card["proposed_by"]),
        ("Valide par", card["validated_by"]),
        ("Date de validation", card["validated_at"]),
        ("Score d'equite", f"{card.get('fairness_score', 0):.2f}"),
        ("RAG en repli", "oui" if card.get("rag_fallback") else "non"),
    ]:
        pdf.drawString(20 * mm, y, f"{label} :")
        pdf.drawString(65 * mm, y, str(value))
        y -= 6 * mm

    y -= 4 * mm
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(20 * mm, y, "Actions")
    y -= 7 * mm
    pdf.setFont("Helvetica", 9)
    for a in card["actions"]:
        pdf.drawString(
            24 * mm,
            y,
            f"- {a['site']} : {a['action']} {a['delta_mw']} MW sur {len(a['hours'])} h",
        )
        y -= 5.5 * mm

    y -= 4 * mm
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(20 * mm, y, "Commentaire de validation")
    y -= 6 * mm
    pdf.setFont("Helvetica-Oblique", 9)
    pdf.drawString(24 * mm, y, f"« {card['comment'][:110]} »")
    y -= 10 * mm

    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawString(20 * mm, y, "Empreinte SHA-256")
    y -= 5 * mm
    pdf.setFont("Courier", 7)
    pdf.drawString(20 * mm, y, d["sha256"])

    pdf.setFont("Helvetica", 6.5)
    text = pdf.beginText(20 * mm, 18 * mm)
    for line in [DISCLAIMER[i : i + 115] for i in range(0, len(DISCLAIMER), 115)]:
        text.textLine(line)
    pdf.drawText(text)

    pdf.showPage()
    pdf.save()
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="decision-{decision_id[:8]}.pdf"'
        },
    )
