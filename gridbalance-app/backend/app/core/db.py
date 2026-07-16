"""MongoDB : connexion, index, seed des comptes de demo.

Deux modes, pilotes par MONGO_URL :
  - une URL (mongodb://... ou mongodb+srv://... pour Atlas) -> vrai serveur, donnees
    persistantes ;
  - "memory" ou valeur vide -> base EN MEMOIRE (mongomock). Aucune installation
    requise, mais les donnees disparaissent a l'arret du backend. C'est le defaut en
    local : on peut lancer le projet sans rien installer d'autre que Python.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import settings
from app.core.security import hash_password

log = logging.getLogger("gridbalance.db")

_client = None

# Comptes affiches sur la page de login. Mot de passe volontairement trivial :
# c'est un prototype de demonstration, pas un systeme de production.
DEMO_USERS = [
    {
        "email": "operator@demo.ma",
        "name": "Operateur Demo",
        "role": "operator",
        "password": "demo1234",
    },
    {
        "email": "supervisor@demo.ma",
        "name": "Superviseur Demo",
        "role": "supervisor",
        "password": "demo1234",
    },
    {
        "email": "admin@demo.ma",
        "name": "Administrateur Demo",
        "role": "admin",
        "password": "demo1234",
    },
]

DEFAULT_CONFIG = {
    "_id": "app_config",
    "workflow_urls": settings.workflow_urls,
    "wf_mode": settings.wf_mode,
    "smtp": {
        "host": settings.smtp_host,
        "port": settings.smtp_port,
        "from": settings.smtp_from,
    },
    "alert_rules": {
        "deficit_threshold_mw": settings.alert_deficit_threshold_mw,
        "soc_threshold": settings.alert_soc_threshold,
        "protected_load_violation": True,
        "workflow_failure": True,
        "rag_fallback": True,
    },
}


def in_memory() -> bool:
    url = (settings.mongo_url or "").strip().lower()
    return url in ("", "memory", "mock", "none")


def get_client():
    global _client
    if _client is None:
        if in_memory():
            from mongomock_motor import AsyncMongoMockClient

            log.warning(
                "MongoDB en MEMOIRE : les donnees seront perdues a l'arret du backend. "
                "Renseignez MONGO_URL pour un stockage persistant."
            )
            _client = AsyncMongoMockClient()
        else:
            # Sur Windows, Atlas (mongodb+srv) echoue souvent en SSL sans le
            # bundle de certificats de certifi. On l'ajoute si disponible.
            tls_kw = {}
            try:
                import certifi

                tls_kw["tlsCAFile"] = certifi.where()
            except ImportError:
                pass
            _client = AsyncIOMotorClient(
                settings.mongo_url,
                uuidRepresentation="standard",
                serverSelectionTimeoutMS=5000,
                **tls_kw,
            )
    return _client


def get_db() -> AsyncIOMotorDatabase:
    return get_client()[settings.mongo_db]


async def init_db() -> None:
    db = get_db()

    # mongomock ne supporte pas toutes les formes d'index. Ce sont des optimisations
    # et une contrainte d'unicite : leur absence en mode memoire n'empeche rien.
    try:
        await db.users.create_index("email", unique=True)
        await db.runs.create_index("correlation_id", unique=True)
        await db.runs.create_index([("created_at", -1)])
        await db.decisions.create_index("correlation_id")
        await db.decisions.create_index("sha256")
        await db.alerts.create_index([("created_at", -1)])
        await db.audit_log.create_index([("created_at", -1)])
        await db.audit_log.create_index("correlation_id")
        await db.email_reports.create_index([("created_at", -1)])
    except Exception as exc:  # noqa: BLE001
        log.warning("Index non crees (%s) : sans effet sur le fonctionnement.", exc)

    for u in DEMO_USERS:
        await db.users.update_one(
            {"email": u["email"]},
            {
                "$setOnInsert": {
                    "email": u["email"],
                    "name": u["name"],
                    "role": u["role"],
                    "password_hash": hash_password(u["password"]),
                    "active": True,
                    "created_at": datetime.now(UTC),
                }
            },
            upsert=True,
        )

    await db.config.update_one(
        {"_id": "app_config"}, {"$setOnInsert": DEFAULT_CONFIG}, upsert=True
    )


async def get_config() -> dict:
    cfg = await get_db().config.find_one({"_id": "app_config"})
    return cfg or DEFAULT_CONFIG
