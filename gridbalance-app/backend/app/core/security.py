"""Auth Gate -> JWT -> RBAC. La chaine de securite du BFF.

Ordre applique a chaque requete protegee :
  1. Auth Gate   : presence d'un access token (cookie httpOnly)
  2. JWT         : signature + expiration (access 15 min, refresh 7 j)
  3. RBAC        : le role porte par le token couvre-t-il la permission demandee ?
  4. Rate limit  : applique globalement par slowapi (voir main.py)
  5. Validation  : Pydantic, sur le body (voir les routers)
  6. correlation_id : injecte avant tout appel workflow (voir services/orchestrator.py)
"""
from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.core.config import settings

Role = Literal["operator", "supervisor", "admin"]

ACCESS_COOKIE = "gb_access"
REFRESH_COOKIE = "gb_refresh"
CSRF_COOKIE = "gb_csrf"
CSRF_HEADER = "X-CSRF-Token"

# Hierarchie : un admin peut tout ce que peut un supervisor, qui peut tout ce que
# peut un operator. On garde une table explicite des permissions pour que le RBAC
# soit lisible et testable, plutot qu'un simple niveau numerique.
PERMISSIONS: dict[Role, set[str]] = {
    "operator": {
        "run:create",
        "run:read",
        "plan:generate",
        "plan:propose",
        "dashboard:read",
        "decision:read",
        "alert:read",
        "report:read",
        "audit:read",
    },
    "supervisor": set(),  # complete ci-dessous
    "admin": set(),
}
PERMISSIONS["supervisor"] = PERMISSIONS["operator"] | {
    "plan:validate",
    "alert:ack",
    "report:send",
    "report:schedule",
}
PERMISSIONS["admin"] = PERMISSIONS["supervisor"] | {
    "user:manage",
    "config:manage",
    "audit:purge",
    "audit:export",
}


class TokenUser(BaseModel):
    sub: str  # user id
    email: str
    name: str
    role: Role


def hash_password(plain: str) -> str:
    # bcrypt appele directement : passlib n'est pas compatible avec bcrypt >= 4.1.
    # bcrypt tronque silencieusement au-dela de 72 octets, on coupe donc nous-memes.
    return bcrypt.hashpw(plain.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))
    except ValueError:
        return False


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def _encode(payload: dict, expires: timedelta, kind: str) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {**payload, "iat": now, "exp": now + expires, "typ": kind},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def create_access_token(user: TokenUser) -> str:
    return _encode(
        user.model_dump(), timedelta(minutes=settings.jwt_access_minutes), "access"
    )


def create_refresh_token(user: TokenUser) -> str:
    return _encode({"sub": user.sub}, timedelta(days=settings.jwt_refresh_days), "refresh")


def decode_token(token: str, expected: str) -> dict:
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expiree")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Jeton invalide")
    if payload.get("typ") != expected:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Type de jeton invalide")
    return payload


# ------------------------------------------------------------------ 1 + 2 --
async def current_user(gb_access: str | None = Cookie(default=None)) -> TokenUser:
    if not gb_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentification requise")
    payload = decode_token(gb_access, "access")
    return TokenUser(**{k: payload[k] for k in ("sub", "email", "name", "role")})


# ---------------------------------------------------------------------- 3 --
def require(*permissions: str):
    """Dependance RBAC : exige TOUTES les permissions listees."""

    async def _guard(user: TokenUser = Depends(current_user)) -> TokenUser:
        granted = PERMISSIONS[user.role]
        missing = [p for p in permissions if p not in granted]
        if missing:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Role '{user.role}' insuffisant : permission requise {missing[0]}",
            )
        return user

    return _guard


# ---------------------------------------------------------------- CSRF -----
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


async def csrf_guard(request: Request) -> None:
    """Double-submit cookie : le header doit reproduire le cookie CSRF.

    Le cookie de session etant httpOnly + SameSite=Lax, un site tiers ne peut pas
    lire le cookie CSRF, donc ne peut pas forger le header.
    """
    if request.method not in UNSAFE:
        return
    if request.url.path in ("/api/auth/login", "/api/auth/refresh"):
        return
    cookie = request.cookies.get(CSRF_COOKIE)
    header = request.headers.get(CSRF_HEADER)
    if not cookie or not header or not secrets.compare_digest(cookie, header):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Jeton CSRF invalide ou absent")
