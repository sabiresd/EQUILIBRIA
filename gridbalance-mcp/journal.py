"""
Tracage des appels d'outils MCP (meme role que MCP/journal.py).

Chaque outil decore par @tracer("<permission>", agent="<agent>") voit ses appels
enregistres dans la CONSOLE et dans la collection Mongo `mcp_journal` (persistante,
reliee par correlation_id). Le correlation_id relie tous les appels d'un meme
traitement a travers les 4 agents.
"""

import contextvars
import functools
import os
import uuid
from datetime import datetime, timezone

_ID_SESSION = uuid.uuid4().hex[:12]
_correlation_id = contextvars.ContextVar("correlation_id", default=None)
_TAILLE_MAX = 2000


def definir_correlation_id(cid=None):
    cid = cid or uuid.uuid4().hex[:12]
    _correlation_id.set(cid)
    return cid


def correlation_id_courant():
    return _correlation_id.get() or os.environ.get("MCP_CORRELATION_ID") or _ID_SESSION


def _tronquer(v):
    t = v if isinstance(v, str) else str(v)
    return t[:_TAILLE_MAX] + "..." if len(t) > _TAILLE_MAX else t


def _ecrire(entree):
    # La journalisation ne doit JAMAIS casser l'outil.
    try:
        from mongo_mcp import get_collection

        get_collection("mcp_journal").insert_one(dict(entree))
    except Exception:  # noqa: BLE001
        pass


def tracer(permission="inconnue", agent="inconnu"):
    def decorateur(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            date_heure = datetime.now(timezone.utc).isoformat()
            cid = correlation_id_courant()
            statut, erreur, resultat = "succes", None, None
            try:
                resultat = func(*args, **kwargs)
                return resultat
            except Exception as e:  # noqa: BLE001
                statut, erreur = "erreur", str(e)
                raise
            finally:
                entree = {
                    "date_heure": date_heure,
                    "correlation_id": cid,
                    "agent": agent,
                    "outil": func.__name__,
                    "permission": permission,
                    "arguments": kwargs if kwargs else (list(args) if args else {}),
                    "statut": statut,
                    "resultat": _tronquer(resultat) if statut == "succes" else None,
                    "erreur": erreur,
                }
                print(
                    f"[MCP] {date_heure} | {cid} | {agent} | {func.__name__} | "
                    f"{permission} | {statut}",
                    flush=True,
                )
                _ecrire(entree)

        return wrapper

    return decorateur
