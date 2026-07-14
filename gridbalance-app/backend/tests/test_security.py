"""Tests de la chaine auth + RBAC + hash des cartes de decision.

Ces trois briques sont celles dont une regression serait invisible a l'oeil nu mais
grave : un role trop permissif, un hash non deterministe, un token accepte a tort.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.core.security import (
    PERMISSIONS,
    TokenUser,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from contracts.contracts import (
    DecisionCard,
    PlanAction,
    canonical_json,
    sha256_card,
    verify_card,
)


@pytest.fixture
def user() -> TokenUser:
    return TokenUser(sub="u1", email="operator@demo.ma", name="Op", role="operator")


# --------------------------------------------------------------------- auth
def test_password_hash_roundtrip():
    hashed = hash_password("demo1234")
    assert hashed != "demo1234"
    assert verify_password("demo1234", hashed)
    assert not verify_password("mauvais", hashed)


def test_access_token_roundtrip(user: TokenUser):
    payload = decode_token(create_access_token(user), "access")
    assert payload["sub"] == "u1"
    assert payload["role"] == "operator"
    assert payload["typ"] == "access"


def test_refresh_token_cannot_be_used_as_access(user: TokenUser):
    """Un refresh token presente comme access doit etre rejete."""
    with pytest.raises(HTTPException) as exc:
        decode_token(create_refresh_token(user), "access")
    assert exc.value.status_code == 401


def test_expired_token_is_rejected(user: TokenUser):
    expired = jwt.encode(
        {
            **user.model_dump(),
            "typ": "access",
            "iat": datetime.now(UTC) - timedelta(hours=2),
            "exp": datetime.now(UTC) - timedelta(hours=1),
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    with pytest.raises(HTTPException) as exc:
        decode_token(expired, "access")
    assert exc.value.status_code == 401


def test_token_signed_with_wrong_secret_is_rejected(user: TokenUser):
    forged = jwt.encode({**user.model_dump(), "typ": "access"}, "mauvais-secret", algorithm="HS256")
    with pytest.raises(HTTPException):
        decode_token(forged, "access")


# --------------------------------------------------------------------- RBAC
def test_operator_cannot_validate_plans():
    """Le coeur du HITL : celui qui propose ne valide pas."""
    assert "plan:propose" in PERMISSIONS["operator"]
    assert "plan:validate" not in PERMISSIONS["operator"]


def test_supervisor_validates_but_does_not_administer():
    assert "plan:validate" in PERMISSIONS["supervisor"]
    assert "alert:ack" in PERMISSIONS["supervisor"]
    assert "user:manage" not in PERMISSIONS["supervisor"]
    assert "config:manage" not in PERMISSIONS["supervisor"]


def test_admin_inherits_everything():
    assert PERMISSIONS["supervisor"] <= PERMISSIONS["admin"]
    assert PERMISSIONS["operator"] <= PERMISSIONS["supervisor"]
    assert {"user:manage", "config:manage", "audit:purge"} <= PERMISSIONS["admin"]


# --------------------------------------------------------------------- hash
def _card(comment: str = "Plan retenu, equite respectee.") -> DecisionCard:
    return DecisionCard(
        correlation_id=uuid4(),
        plan_id="B",
        actions=[
            PlanAction(site="Site tertiaire B", action="delestage", delta_mw=2.5, hours=[18, 19])
        ],
        proposed_by="operator@demo.ma",
        validated_by="supervisor@demo.ma",
        validated_at=datetime.now(UTC),
        comment=comment,
    )


def test_sha256_is_deterministic():
    card = _card()
    assert sha256_card(card) == sha256_card(card)
    assert len(sha256_card(card)) == 64


def test_sha256_changes_when_card_changes():
    """Une carte alteree doit produire un hash different — c'est tout l'interet."""
    card = _card()
    tampered = card.model_copy(update={"comment": "Commentaire modifie apres coup"})
    assert sha256_card(card) != sha256_card(tampered)


def test_canonical_json_is_key_order_independent():
    """Le hash ne doit pas dependre de l'ordre des cles en memoire."""
    card = _card()
    as_dict = card.model_dump(mode="json")
    shuffled = dict(reversed(list(as_dict.items())))
    assert canonical_json(as_dict) == canonical_json(shuffled)
    assert sha256_card(as_dict) == sha256_card(shuffled)


def test_verify_detects_tampering():
    card = _card()
    stored_hash = sha256_card(card)
    stored_card = card.model_dump(mode="json")
    assert verify_card(stored_card, stored_hash)["valid"] is True

    stored_card["actions"][0]["delta_mw"] = 99.0  # falsification apres coup
    result = verify_card(stored_card, stored_hash)
    assert result["valid"] is False
    assert result["computed_sha256"] != result["expected_sha256"]
