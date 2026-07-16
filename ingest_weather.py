"""
Ingestion unique de Data2023 dans MongoDB (collection `weather`).

Charge les 8785 lignes horaires NASA 2023 (nettoyees par agent_simulation) et les
insere une fois pour toutes. Le backend s'en sert ensuite comme d'un flux temps
reel : une horloge fait avancer un pointeur `h_index`, et l'heure courante + la
fenetre de prevision [maintenant, +360 h] se lisent depuis cette collection.

    python ingest_weather.py            # ingere dans le MONGO_URL du .env
    python ingest_weather.py --drop     # vide la collection avant (defaut)

Prerequis : MONGO_URL renseigne dans gridbalance-app/.env (Atlas ou local).
Refuse de tourner en mode 'memory' : la base en memoire vit dans le process du
backend, un script externe ne peut pas y ecrire.
"""

from __future__ import annotations

import argparse
import sys
from datetime import timezone
from pathlib import Path

from agent_simulation import DatasetError, load_dataset

ENV_FILE = Path(__file__).with_name("gridbalance-app") / ".env"


def read_env(key: str, default: str = "") -> str:
    if not ENV_FILE.exists():
        return default
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith(f"{key}=") and not line.startswith("#"):
            return line.split("=", 1)[1].strip().strip('"').strip("'") or default
    return default


def main() -> int:
    p = argparse.ArgumentParser(description="Ingestion Data2023 -> MongoDB.weather")
    p.add_argument("--keep", action="store_true", help="ne pas vider la collection avant")
    args = p.parse_args()

    mongo_url = read_env("MONGO_URL", "memory")
    mongo_db = read_env("MONGO_DB", "gridbalance")

    if mongo_url.strip().lower() in ("", "memory", "mock", "none"):
        print(
            "MONGO_URL est en mode 'memory'. Renseignez une vraie URI (Atlas ou local)\n"
            "dans gridbalance-app/.env avant d'ingerer :\n"
            "  MONGO_URL=mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/...",
            file=sys.stderr,
        )
        return 2

    try:
        from pymongo import ASCENDING, MongoClient
    except ImportError:
        print("pymongo manquant : pip install pymongo", file=sys.stderr)
        return 3

    # Sur Windows, la connexion Atlas (mongodb+srv) echoue souvent en
    # 'SSL: CERTIFICATE_VERIFY_FAILED' sans le bundle de certificats de certifi.
    tls_kw = {}
    try:
        import certifi

        tls_kw["tlsCAFile"] = certifi.where()
    except ImportError:
        pass

    try:
        rows = load_dataset()
    except DatasetError as exc:
        print(f"Dataset : {exc}", file=sys.stderr)
        return 1

    print(f"Dataset : {len(rows)} lignes horaires exploitables.")

    docs = []
    for i, r in enumerate(rows):
        ts = r.timestamp_utc.astimezone(timezone.utc)
        docs.append(
            {
                "_id": i,                 # h_index : 0 .. 8784, ordre chronologique
                "h_index": i,
                "ts_utc": ts.isoformat(),
                "year": r.year,
                "month": r.month,
                "day": r.day,
                "hour_utc": r.hour_utc,
                "irr": r.irr,
                "t2m": r.t2m,
                "rh2m": r.rh2m,
                "ws10m": r.ws10m,
                "wd10m": r.wd10m,
            }
        )

    client = MongoClient(mongo_url, serverSelectionTimeoutMS=8000, **tls_kw)
    try:
        client.admin.command("ping")
    except Exception as exc:  # noqa: BLE001
        print(f"Connexion MongoDB impossible : {exc}", file=sys.stderr)
        print("Verifiez l'URI, le mot de passe (caracteres encodes) et Network Access (0.0.0.0/0).",
              file=sys.stderr)
        return 4

    col = client[mongo_db]["weather"]
    if not args.keep:
        col.drop()
    col.insert_many(docs)
    col.create_index([("h_index", ASCENDING)], unique=True)
    col.create_index([("month", ASCENDING), ("day", ASCENDING), ("hour_utc", ASCENDING)])

    n = col.count_documents({})
    first = col.find_one(sort=[("h_index", ASCENDING)])
    last = col.find_one(sort=[("h_index", -1)])
    print(f"Insere dans {mongo_db}.weather : {n} documents.")
    print(f"  premier : h={first['h_index']} {first['ts_utc']}")
    print(f"  dernier : h={last['h_index']} {last['ts_utc']}")
    print("OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
