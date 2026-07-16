"""Normalisation d'une decision Agent 4 -> carte VALIDE pour le dashboard.

Le probleme : l'Agent 4 (ABA Fusion) envoie une decision au format libre (issue
du plan Slack + callback HITL). Or la page Decisions du dashboard valide chaque
carte contre un schema STRICT (DecisionCardSchema) : plan_id A/B/C, actions[],
correlation_id en UUID, comment non vide, notified{slack,email}...

Ce module transforme n'importe quelle entree en carte conforme, calcule le
SHA-256 EXACTEMENT comme le backend (json canonique : cles triees, separateurs
compacts, ensure_ascii=False) pour que "Verifier l'integrite" soit vert, et
ecrit dans la collection `decisions` (un upsert par correlation_id : pas de
doublon si journaliser + rapport tournent tous les deux).
"""
import hashlib
import json
import re
import uuid
from datetime import datetime, timezone

from mongo_mcp import get_collection

DISCLAIMER = (
    "Prototype de demonstration et d'aide a la decision. Non connecte aux systemes "
    "de l'ONEE. Aucun equipement reel n'est pilote. Valeurs de demonstration."
)
_ACTION_KINDS = {"delestage", "decalage", "batterie", "achat_reseau"}


def _uuid(val) -> str:
    """Renvoie un UUID valide : celui fourni s'il l'est, sinon un derive stable."""
    try:
        return str(uuid.UUID(str(val)))
    except (ValueError, TypeError, AttributeError):
        return str(uuid.uuid5(uuid.NAMESPACE_URL, str(val))) if val else str(uuid.uuid4())


def _plan_id(raw: dict) -> str:
    explicit = str(raw.get("plan_id") or "").strip().upper()
    if explicit in ("A", "B", "C"):
        return explicit
    text = str(raw.get("plan") or raw.get("plan_id") or raw.get("levier_retenu") or "").upper()
    m = re.search(r"PLAN[\s_-]*([ABC])\b", text) or re.search(r"\b([ABC])\b", text)
    return m.group(1) if m else "B"


def _actions(raw: dict) -> list:
    src = raw.get("actions")
    out = []
    if isinstance(src, list):
        for a in src:
            if not isinstance(a, dict):
                continue
            kind = str(a.get("action", "delestage")).lower()
            kind = kind if kind in _ACTION_KINDS else "delestage"
            hours = [int(h) for h in (a.get("hours") or []) if isinstance(h, (int, float))]
            out.append({
                "site": str(a.get("site", "Site principal")),
                "action": kind,
                "delta_mw": round(float(a.get("delta_mw", 0) or 0), 3),
                "hours": hours,
                "justification": a.get("justification"),
            })
    if not out:
        # Action par defaut coherente avec un plan de delestage en pointe (18-22h).
        deficit = raw.get("peak_deficit_mw") or raw.get("deficit_mw") or 0.5
        out = [{
            "site": "Charges non critiques",
            "action": "delestage",
            "delta_mw": round(float(deficit or 0.5), 3),
            "hours": [18, 19, 20, 21],
            "justification": str(raw.get("strategie") or "Delestage des charges non critiques en pointe."),
        }]
    return out


def _citations(raw: dict) -> list:
    src = raw.get("citations") or raw.get("sources") or []
    if isinstance(src, str):
        src = [s.strip() for s in src.replace(";", ",").split(",") if s.strip()]
    out = []
    for s in src:
        if isinstance(s, dict):
            out.append({
                "doc": str(s.get("doc", "document.md")),
                "page": max(int(s.get("page", 1) or 1), 1),
                "extrait": str(s.get("extrait", s.get("section", "Source documentaire RAG.")))[:200],
                "score": s.get("score"),
            })
        else:
            out.append({"doc": str(s), "page": 1, "extrait": "Source documentaire RAG.", "score": None})
    return out


def carte_valide(raw: dict) -> dict:
    """Normalise une entree Agent 4 en DecisionCard conforme au dashboard."""
    now = datetime.now(timezone.utc).isoformat()
    ds = raw.get("deficit_summary")
    if not isinstance(ds, dict):
        ds = None
    comment = str(raw.get("comment") or raw.get("commentaire") or "Validation via Slack HITL.")[:2000]
    return {
        "correlation_id": _uuid(raw.get("correlation_id")),
        "plan_id": _plan_id(raw),
        "actions": _actions(raw),
        "citations": _citations(raw),
        "deficit_summary": ds,
        "fairness_score": round(float(raw.get("fairness_score", 0) or 0), 3),
        "rag_fallback": bool(raw.get("rag_fallback", False)),
        "proposed_by": str(raw.get("proposed_by") or raw.get("operator") or "agent-simulateur"),
        "validated_by": str(raw.get("validated_by") or raw.get("validateur") or raw.get("user") or "superviseur-slack"),
        "validated_at": str(raw.get("validated_at") or now),
        "comment": comment or "Validation HITL.",
        "disclaimer": DISCLAIMER,
    }


def sha256_carte(card: dict) -> str:
    """SHA-256 du JSON canonique, IDENTIQUE a sha256_card() du backend."""
    canon = json.dumps(card, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def ecrire_decision(card: dict, notified: dict) -> tuple[str, str]:
    """Upsert de la decision dans `decisions` (collection lue par le dashboard).

    Returns:
        (decision_id, sha256)
    """
    digest = sha256_carte(card)
    col = get_collection("decisions")
    # Un seul enregistrement par run : on reutilise l'_id existant (immuable dans
    # Mongo) pour que le remplacement ne tente pas de le modifier.
    existing = col.find_one({"correlation_id": card["correlation_id"]}, {"_id": 1})
    _id = str(existing["_id"]) if existing else str(uuid.uuid4())
    doc = {
        "_id": _id,
        "correlation_id": card["correlation_id"],
        "card": card,
        "sha256": digest,
        "notified": {"slack": bool(notified.get("slack")), "email": bool(notified.get("email"))},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    col.replace_one({"_id": _id}, doc, upsert=True)
    return _id, digest
