"""Authentification : login, refresh, logout, profil."""
from __future__ import annotations

from fastapi import APIRouter, Cookie, HTTPException, Response, status
from pydantic import BaseModel, EmailStr

from app.core.config import settings
from app.core.db import get_db
from app.core.security import (
    ACCESS_COOKIE,
    CSRF_COOKIE,
    REFRESH_COOKIE,
    TokenUser,
    create_access_token,
    create_refresh_token,
    decode_token,
    new_csrf_token,
    verify_password,
)
from app.services import audit

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    csrf_token: str | None = None


def _set_cookies(resp: Response, user: TokenUser) -> str:
    csrf = new_csrf_token()
    common = {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": "lax",
        "domain": settings.cookie_domain,
    }
    resp.set_cookie(
        ACCESS_COOKIE,
        create_access_token(user),
        max_age=settings.jwt_access_minutes * 60,
        **common,
    )
    resp.set_cookie(
        REFRESH_COOKIE,
        create_refresh_token(user),
        max_age=settings.jwt_refresh_days * 86400,
        path="/api/auth",
        **common,
    )
    # Le jeton CSRF est LISIBLE par le JS (pas httpOnly) : le front le renvoie en
    # header. Un site tiers ne peut pas le lire (SameSite), donc pas le forger.
    resp.set_cookie(
        CSRF_COOKIE,
        csrf,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="lax",
        domain=settings.cookie_domain,
        max_age=settings.jwt_refresh_days * 86400,
    )
    return csrf


@router.post("/login", response_model=UserOut)
async def login(body: LoginBody, response: Response) -> UserOut:
    user = await get_db().users.find_one({"email": body.email.lower(), "active": True})
    if not user or not verify_password(body.password, user["password_hash"]):
        await audit.log("auth.login_failed", actor=body.email, detail={"reason": "bad_credentials"})
        # Message volontairement identique dans les deux cas : ne pas reveler
        # l'existence d'un compte.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Identifiants invalides")

    token_user = TokenUser(
        sub=str(user["_id"]), email=user["email"], name=user["name"], role=user["role"]
    )
    csrf = _set_cookies(response, token_user)
    await audit.log("auth.login", actor=user["email"], detail={"role": user["role"]})
    return UserOut(
        id=str(user["_id"]),
        email=user["email"],
        name=user["name"],
        role=user["role"],
        csrf_token=csrf,
    )


@router.post("/refresh", response_model=UserOut)
async def refresh(response: Response, gb_refresh: str | None = Cookie(default=None)) -> UserOut:
    if not gb_refresh:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expiree")
    payload = decode_token(gb_refresh, "refresh")
    user = await get_db().users.find_one({"_id": payload["sub"], "active": True})
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Compte introuvable ou desactive")

    token_user = TokenUser(
        sub=str(user["_id"]), email=user["email"], name=user["name"], role=user["role"]
    )
    csrf = _set_cookies(response, token_user)
    return UserOut(
        id=str(user["_id"]),
        email=user["email"],
        name=user["name"],
        role=user["role"],
        csrf_token=csrf,
    )


@router.post("/logout")
async def logout(response: Response, gb_access: str | None = Cookie(default=None)) -> dict:
    if gb_access:
        try:
            payload = decode_token(gb_access, "access")
            await audit.log("auth.logout", actor=payload["email"])
        except HTTPException:
            pass
    for name in (ACCESS_COOKIE, CSRF_COOKIE):
        response.delete_cookie(name, domain=settings.cookie_domain)
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth", domain=settings.cookie_domain)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def me(gb_access: str | None = Cookie(default=None)) -> UserOut:
    if not gb_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentification requise")
    payload = decode_token(gb_access, "access")
    return UserOut(
        id=payload["sub"], email=payload["email"], name=payload["name"], role=payload["role"]
    )
