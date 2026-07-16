"""Etat des equipements : SCADA (observer) et EMS (piloter).

Trois couches, trois questions — c'est la separation du projet :

    SCADA  « que se passe-t-il ? »        -> etats, mesures, alarmes
    EMS    « comment piloter ? »          -> consignes, contraintes, dispatch
    Agents « quelle decision prendre ? »  -> plan, arbitrage, validation humaine

Ce service branche les deux couches basses sur la meme horloge de simulation que
la tuile live : la meteo vient de la collection `weather`, via clock._point(), et
JAMAIS d'une seconde source qui divergerait.

Collections ecrites :
    scada_telemetry : une ligne par equipement et par heure
    scada_alarms    : alarmes derivees des seuils
    ems_setpoints   : bilan + consignes par heure
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.core.db import get_db
from app.services import clock
from app.services import gridbalance_engine as engine

#: Bornes batterie — reprises du simulateur EMS pour ne pas diverger.
CAPACITE_MWH = 8.0
RENDEMENT = 0.92
SOC_MIN, SOC_MAX = 0.10, 0.95

_grid_cap_cache: float | None = None


def _grid_cap() -> float:
    """Plafond de puissance souscrite (MW), lu sur la facture."""
    global _grid_cap_cache
    if _grid_cap_cache is None:
        facture = engine.load_facture()
        _grid_cap_cache = round(facture.puissance_souscrite_kva * 0.8 / 1000, 3)
    return _grid_cap_cache


def _integre_soc(soc: float, batterie_mw: float, capacite_mwh: float = CAPACITE_MWH) -> float:
    """Fait evoluer l'etat de charge d'un module sur une heure.

    Convention du moteur : positif = decharge. Le rendement penalise les DEUX
    sens (on perd a la charge comme a la decharge). `capacite_mwh` est celle du
    MODULE : un rack de 4 x 2 MWh ne se vide pas comme un bloc de 8 MWh.
    """
    if batterie_mw > 0:  # decharge : il faut puiser plus que ce qu'on delivre
        soc -= (batterie_mw / RENDEMENT) / capacite_mwh
    elif batterie_mw < 0:  # charge : une part est perdue
        soc += (-batterie_mw * RENDEMENT) / capacite_mwh
    return min(SOC_MAX, max(SOC_MIN, soc))


async def _fenetre(hours: int) -> list[dict]:
    idx = await clock.current_index()
    lo = max(0, idx - hours + 1)
    cursor = (
        get_db().weather.find({"h_index": {"$gte": lo, "$lte": idx}}).sort("h_index", 1)
    )
    return [d async for d in cursor]


def _horodatage_affiche(points: list[dict]) -> list[str]:
    """Meme convention que la tuile live : les donnees sont de 2023 mais on les
    presente A LA DATE DU JOUR, ancrees sur aujourd'hui (pas d'accumulation)."""
    now = datetime.now(UTC)
    today0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    cur_hl = int(points[-1]["hour_local"]) if points else now.hour
    stamps = []
    for offset in range(len(points)):
        recul = len(points) - 1 - offset
        stamps.append((today0 + timedelta(hours=cur_hl - recul)).isoformat())
    return stamps


def _chaine(pt: dict, socs: list[float], cycles: float, ts: str,
            graine: int) -> tuple[dict, dict]:
    """SCADA -> EMS -> SCADA pour une heure.

    Le second passage SCADA n'est pas un gaspillage : la consigne batterie de
    l'EMS doit apparaitre dans la telemetrie, sinon l'ecran montrerait un rack
    au repos alors que l'EMS vient de le solliciter.

    L'EMS raisonne sur un stockage AGREGE (il ne connait pas le cablage) ; le
    SCADA repartit ensuite sa consigne module par module.
    """
    soc_agrege = sum(socs) / len(socs)
    snap = engine.scada_snapshot(
        pt["wind_ms"], pt["ghi"], pt["temp_c"], soc=soc_agrege, cycles=cycles,
        ts_utc=ts, seed=graine, socs=socs,
        rh2m=pt.get("humidite_pct", 0.0), wd10m=pt.get("vent_direction_deg", 0.0),
    )
    ems = engine.ems_consignes(snap, pt["demand_mw"], _grid_cap(), pt["tariff_period"])
    snap = engine.scada_snapshot(
        pt["wind_ms"], pt["ghi"], pt["temp_c"], soc=soc_agrege, cycles=cycles,
        puissance_batterie_mw=ems["bilan"]["batterie_mw"], ts_utc=ts, seed=graine,
        socs=socs,
        rh2m=pt.get("humidite_pct", 0.0), wd10m=pt.get("vent_direction_deg", 0.0),
    )
    return snap, ems


async def live() -> dict:
    """Etat courant du parc : SCADA + EMS, calcules a la volee."""
    docs = await _fenetre(1)
    if not docs:
        raise RuntimeError("Collection 'weather' vide : lancez ingest_weather.py.")
    pt = clock._point(docs[-1])
    ts = _horodatage_affiche([pt])[-1]
    # On reprend le dernier SoC connu de chaque module : sans ca, l'etat courant
    # repartirait de 50 % a chaque appel et contredirait l'historique affiche.
    db = get_db()
    dernier = await db.scada_telemetry.find_one({"type": "batterie"}, sort=[("h_index", -1)])
    socs: list[float] = []
    cycles = 0.0
    if dernier:
        cursor = db.scada_telemetry.find(
            {"type": "batterie", "h_index": dernier["h_index"]}
        ).sort("equipement_id", 1)
        modules = [m async for m in cursor]
        socs = [float(m["soc"]) for m in modules]
        cycles = sum(float(m.get("cycles", 0.0)) for m in modules)
    if not socs:
        socs = [0.5] * len(engine.BATTERIES)

    snap, ems = _chaine(pt, socs, cycles, ts, int(pt["h_index"]))
    return {
        "display_now": ts,
        "meteo": pt,
        "scada": snap,
        "ems": ems,
        "grid_cap_mw": _grid_cap(),
    }


async def _generer(hours: int) -> tuple[list[dict], list[dict], list[dict], list[float], float]:
    """Rejoue la fenetre courante de l'horloge : telemetrie, alarmes, consignes.

    C'est la SEULE fonction qui produit ces series. `seed()` les persiste,
    l'historique les sert. Sans ce partage, la base et l'ecran raconteraient
    deux histoires : la base figee au dernier seed, l'ecran suivant l'horloge.

    Returns:
        (telemetrie, alarmes, consignes, socs_finaux, cycles)
    """
    docs = await _fenetre(hours)
    if not docs:
        raise RuntimeError("Collection 'weather' vide : lancez ingest_weather.py.")

    points = [clock._point(d) for d in docs]
    stamps = _horodatage_affiche(points)

    telemetrie: list[dict] = []
    alarmes: list[dict] = []
    consignes: list[dict] = []
    # Un SoC PAR module : le rack ne se vide pas uniformement, et c'est
    # justement ce que les cartes doivent montrer.
    socs = [0.5] * len(engine.BATTERIES)
    cycles = 0.0
    # Alarmes AU FRONT : un vrai SCADA leve une alarme quand la condition
    # APPARAIT et la leve quand elle disparait. Une alarme par scan noierait
    # l'ecran (un SoC bas 60 h d'affilee = 60 lignes identiques, illisibles).
    actives: dict[str, dict] = {}

    for pt, ts in zip(points, stamps, strict=True):
        snap, ems = _chaine(pt, socs, cycles, ts, int(pt["h_index"]))
        batterie_mw = ems["bilan"]["batterie_mw"]

        for eq in snap["equipements"]:
            telemetrie.append({
                **eq,
                "_id": f"{eq['equipement_id']}-{pt['h_index']}",
                "h_index": int(pt["h_index"]),
                "ts_utc": ts,
                "hour_local": pt["hour_local"],
            })
        # Front montant : on n'insere que les alarmes qui n'etaient pas deja la.
        vues = set()
        for al in snap["alarmes"]:
            cle = f"{al['equipement_id']}-{al['code']}"
            vues.add(cle)
            if cle in actives:
                continue  # deja levee, toujours vraie -> on ne redonde pas
            entree = {
                **al,
                "_id": f"{cle}-{pt['h_index']}",
                "h_index": int(pt["h_index"]),
                "apparue_le": ts,
                "levee_le": None,
                "duree_h": None,
            }
            actives[cle] = entree
            alarmes.append(entree)
        # Front descendant : la condition a disparu -> on cloture.
        for cle in [k for k in actives if k not in vues]:
            entree = actives.pop(cle)
            entree["levee_le"] = ts
            entree["duree_h"] = int(pt["h_index"]) - entree["h_index"]
        consignes.append({
            "_id": f"ems-{pt['h_index']}",
            "h_index": int(pt["h_index"]),
            "ts_utc": ts,
            "hour_local": pt["hour_local"],
            "bilan": ems["bilan"],
            "consignes": ems["consignes"],
            "contraintes": ems["contraintes"],
            "escalade_agents": ems["escalade_agents"],
        })

        # Chaque module evolue selon SA propre part de la consigne, telle que le
        # SCADA vient de la repartir — pas selon la consigne agregee.
        for eq in snap["equipements"]:
            if eq["type"] != "batterie":
                continue
            i = next((k for k, b in enumerate(engine.BATTERIES)
                      if b["id"] == eq["equipement_id"]), None)
            if i is None:
                continue
            socs[i] = _integre_soc(socs[i], eq["puissance_mw"],
                                   float(eq["capacite_mwh"]))
        cycles += abs(batterie_mw) / (2 * CAPACITE_MWH)

    return telemetrie, alarmes, consignes, socs, cycles


async def seed(hours: int = 72, reset: bool = True) -> dict:
    """Persiste dans MongoDB l'historique SCADA/EMS de la fenetre courante.

    Donnees GENEREES (aucun equipement reel) : c'est l'objet du MVP.
    """
    db = get_db()
    telemetrie, alarmes, consignes, socs, cycles = await _generer(hours)

    if reset:
        await db.scada_telemetry.delete_many({})
        await db.scada_alarms.delete_many({})
        await db.ems_setpoints.delete_many({})

    if telemetrie:
        await db.scada_telemetry.insert_many(telemetrie)
    if alarmes:
        await db.scada_alarms.insert_many(alarmes)
    if consignes:
        await db.ems_setpoints.insert_many(consignes)

    return {
        "heures": hours,
        "telemetrie": len(telemetrie),
        "alarmes": len(alarmes),
        "consignes": len(consignes),
        "equipements": len(engine.TURBINES) + len(engine.BATTERIES) + 1,
        # Un SoC par module : la moyenne seule masquerait un module a plat.
        "soc_final": [round(s, 4) for s in socs],
        "soc_final_moyen": round(sum(socs) / len(socs), 4) if socs else 0.0,
        "cycles": round(cycles, 2),
    }


async def equipements() -> list[dict]:
    """Derniere mesure connue de chaque equipement (vue d'inventaire)."""
    db = get_db()
    dernier = await db.scada_telemetry.find_one({}, sort=[("h_index", -1)])
    if not dernier:
        return []
    cursor = db.scada_telemetry.find({"h_index": dernier["h_index"]})
    return [{**e, "id": e.pop("_id")} async for e in cursor]


async def historique(equipement_id: str | None = None, hours: int = 48) -> list[dict]:
    """Historique CALCULE sur la fenetre courante de l'horloge.

    Volontairement pas une relecture de MongoDB : la base est figee au dernier
    seed, alors que l'horloge avance d'une heure simulee par seconde. La relire
    donnerait des panneaux vivants au-dessus de courbes mortes, et les deux se
    contrediraient au bout d'une minute. `seed()` reste la photo persistee ;
    l'ecran, lui, suit l'horloge.
    """
    telemetrie, _alarmes, _consignes, _socs, _cycles = await _generer(hours)
    out = [{**e, "id": e["_id"]} for e in telemetrie]
    if equipement_id:
        out = [e for e in out if e["equipement_id"] == equipement_id]
    return out


async def alarmes(actives_seulement: bool = False, limit: int = 100) -> list[dict]:
    query = {"acquittee": False} if actives_seulement else {}
    cursor = get_db().scada_alarms.find(query).sort("h_index", -1).limit(limit)
    return [{**a, "id": a.pop("_id")} async for a in cursor]


async def acquitter(alarme_id: str, acteur: str) -> bool:
    res = await get_db().scada_alarms.update_one(
        {"_id": alarme_id},
        {"$set": {"acquittee": True, "acquittee_par": acteur,
                  "acquittee_le": datetime.now(UTC).isoformat()}},
    )
    return res.matched_count > 0


async def consignes_ems(hours: int = 48) -> list[dict]:
    """Consignes CALCULEES sur la fenetre courante (meme raison que historique)."""
    _telemetrie, _alarmes, consignes, _socs, _cycles = await _generer(hours)
    return [{**c, "id": c["_id"]} for c in consignes]
