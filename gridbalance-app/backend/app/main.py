"""GridBalance AI Morocco — BFF FastAPI.

Chaine de securite, dans l'ordre :
  Auth Gate -> JWT -> RBAC -> rate limit -> validation Pydantic -> correlation_id -> workflows

Le navigateur ne parle JAMAIS aux workflows directement : il passe toujours par ici.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings
from app.core.db import init_db
from app.core.security import ACCESS_COOKIE, csrf_guard, decode_token
from app.routers import auth, decisions, ops, runs
from app.services.mailer import scheduler
from contracts.contracts import DISCLAIMER

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("gridbalance")


def rate_key(request: Request) -> str:
    """Limite par UTILISATEUR quand il est connu, sinon par IP."""
    token = request.cookies.get(ACCESS_COOKIE)
    if token:
        try:
            return decode_token(token, "access")["sub"]
        except Exception:  # noqa: BLE001
            pass
    return get_remote_address(request)


limiter = Limiter(
    key_func=rate_key,
    default_limits=[f"{settings.rate_limit_per_minute}/minute"],
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    scheduler.start()
    log.info("GridBalance demarre — mode workflows : %s", settings.wf_mode)
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(
    title=settings.app_name,
    description=DISCLAIMER,
    version="1.0.0",
    lifespan=lifespan,
    dependencies=[Depends(csrf_guard)],
)

app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,  # indispensable : les cookies httpOnly transitent ici
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limit_exceeded",
            "message": "Trop de requetes. Reessayez dans une minute.",
        },
    )


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Erreurs propres : jamais de stack trace cote client."""
    detail = exc.detail
    body = detail if isinstance(detail, dict) else {"message": str(detail)}
    body.setdefault("error", "http_error")
    cid = request.headers.get("X-Correlation-Id")
    if cid:
        body.setdefault("correlation_id", cid)
    return JSONResponse(status_code=exc.status_code, content=body)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": "validation_error",
            "message": "Les donnees envoyees sont invalides.",
            "fields": [
                {"champ": ".".join(str(p) for p in e["loc"][1:]), "probleme": e["msg"]}
                for e in exc.errors()
            ],
        },
    )


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception("Erreur non geree sur %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_error",
            "message": (
                "Une erreur interne est survenue. Communiquez le correlation_id au support."
            ),
        },
    )


app.include_router(auth.router)
app.include_router(runs.router)
app.include_router(decisions.router)
app.include_router(ops.router)


@app.get("/")
async def root() -> dict:
    return {"app": settings.app_name, "version": "1.0.0", "disclaimer": DISCLAIMER}
