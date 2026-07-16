"""Horloge de simulation : rejoue les donnees NASA 2023 comme un flux temps reel.

Un pointeur `h_index` avance dans la collection `weather` a vitesse ACCELEREE
(1 heure simulee = 1 seconde reelle par defaut). L'heure courante et une fenetre
recente se lisent a la volee, ce qui donne au dashboard une tuile vivante sans
aucun script externe : l'etat du temps vit dans la base, pas dans un process.

Le pointeur est calcule, pas incremente : `current = start_index + floor(secondes
ecoulees x vitesse)`, modulo le nombre d'heures. Il survit donc a un redemarrage
du backend, et rien ne derive.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.core.db import get_db
from app.services import gridbalance_engine as engine

CLOCK_ID = "sim_clock"
DEFAULT_SPEED = 1.0  # heures simulees par seconde reelle (1 h sim = 1 s reelle)

_calibration: dict[str, float] | None = None


def _calib() -> dict[str, float]:
    """Facteurs de recalage de la demande sur la facture (charges une fois)."""
    global _calibration
    if _calibration is None:
        facture = engine.load_facture()
        _calibration = engine.calibration_factors(
            engine.profile_kwh_by_period(facture.heures_facturees), facture
        )
    return _calibration


async def _count() -> int:
    return await get_db().weather.count_documents({})


async def _project_now(n: int) -> int:
    """Projette l'instant reel sur le meme creneau (mois, jour, heure) de 2023."""
    now = datetime.now(UTC)
    doc = await get_db().weather.find_one(
        {"month": now.month, "day": now.day, "hour_utc": now.hour}
    )
    if doc:
        return int(doc["h_index"])
    # Creneau absent (dataset Jan->Oct) : on prend le plus proche par mois/jour.
    docs = get_db().weather.find({}, {"h_index": 1, "month": 1, "day": 1, "hour_utc": 1})
    best, best_d = 0, 10**9
    target = now.month * 31 * 24 + now.day * 24 + now.hour
    async for d in docs:
        dist = abs((d["month"] * 31 * 24 + d["day"] * 24 + d["hour_utc"]) - target)
        if dist < best_d:
            best, best_d = int(d["h_index"]), dist
    return best


async def ensure_clock() -> dict:
    db = get_db()
    clk = await db.sim_clock.find_one({"_id": CLOCK_ID})
    if clk:
        return clk
    n = await _count()
    if n == 0:
        raise RuntimeError("Collection 'weather' vide : lancez ingest_weather.py.")
    clk = {
        "_id": CLOCK_ID,
        "started_at": datetime.now(UTC).isoformat(),
        "start_h_index": await _project_now(n),
        "speed": DEFAULT_SPEED,
        "paused": False,
        "paused_index": 0,
        "count": n,
    }
    await db.sim_clock.insert_one(clk)
    return clk


async def current_index() -> int:
    clk = await ensure_clock()
    n = clk.get("count") or await _count()
    if clk.get("paused"):
        return int(clk.get("paused_index", clk["start_h_index"])) % n
    started = datetime.fromisoformat(clk["started_at"])
    elapsed = (datetime.now(UTC) - started).total_seconds() * float(clk["speed"])
    return int(clk["start_h_index"] + int(elapsed)) % n


async def set_speed(speed: float) -> dict:
    await get_db().sim_clock.update_one(
        {"_id": CLOCK_ID}, {"$set": {"speed": max(0.0, speed)}}
    )
    return await ensure_clock()


async def set_paused(paused: bool) -> dict:
    idx = await current_index()
    if paused:
        await get_db().sim_clock.update_one(
            {"_id": CLOCK_ID}, {"$set": {"paused": True, "paused_index": idx}}
        )
    else:
        # Reprendre : on recale started_at pour continuer depuis l'index courant.
        await get_db().sim_clock.update_one(
            {"_id": CLOCK_ID},
            {"$set": {"paused": False, "started_at": datetime.now(UTC).isoformat(),
                      "start_h_index": idx}},
        )
    return await ensure_clock()


def _point(doc: dict) -> dict:
    """Reconstruit production/demande/tarif pour une heure, comme un run le ferait."""
    calib = _calib()
    hour_local = (int(doc["hour_utc"]) + engine.UTC_OFFSET_HOURS) % 24
    period, price_kwh = engine.tariff_for_hour(hour_local)
    demand = round(engine.demand_mw(hour_local) * calib.get(period, 1.0), 3)
    wind = engine.wind_power_mw(float(doc["ws10m"]))
    solar = engine.solar_power_mw(float(doc["irr"]), float(doc["t2m"]))
    return {
        "h_index": int(doc["h_index"]),
        "ts_utc": doc["ts_utc"],
        "hour_local": hour_local,
        "wind_ms": round(float(doc["ws10m"]), 2),
        "ghi": round(float(doc["irr"]), 1),
        "temp_c": round(float(doc["t2m"]), 1),
        "prod_wind_mw": wind,
        "prod_solar_mw": solar,
        "prod_total_mw": round(wind + solar, 3),
        "demand_mw": demand,
        "net_balance_mw": round(wind + solar - demand, 3),
        "tariff_period": period,
        "tariff_mad_kwh": price_kwh,
    }


async def live_state(history_hours: int = 48) -> dict:
    """Etat courant + fenetre recente, pour la tuile live et son sparkline."""
    clk = await ensure_clock()
    n = clk.get("count") or await _count()
    idx = await current_index()

    lo = max(0, idx - history_hours + 1)
    cursor = get_db().weather.find({"h_index": {"$gte": lo, "$lte": idx}}).sort("h_index", 1)
    window = [_point(d) async for d in cursor]

    # Affichage "comme maintenant" : les donnees sont de 2023, mais on les presente
    # a la DATE DU JOUR. L'heure affichee est l'heure locale de la donnee (pour que le
    # tarif/solaire affiches restent coherents avec l'heure). Ancre sur aujourd'hui,
    # donc pas d'accumulation entre sessions.
    now = datetime.now(UTC)
    today0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    cur_hl = int(window[-1]["hour_local"]) if window else now.hour
    for offset, pt in enumerate(reversed(window)):  # window[-1] = heure courante
        pt["display_ts"] = (today0 + timedelta(hours=cur_hl - offset)).isoformat()
    now_ref = today0 + timedelta(hours=cur_hl)

    current = window[-1] if window else None

    return {
        "h_index": idx,
        "count": n,
        "speed": float(clk["speed"]),
        "paused": bool(clk.get("paused", False)),
        "display_now": now_ref.isoformat(),
        "current": current,
        "history": window,
    }
