"""Installation du projet : verifie l'environnement et remplit la base.

    python init_projet.py            # verifie, ingere la meteo, remplit le SCADA
    python init_projet.py --check    # verifie seulement, n'ecrit rien
    python init_projet.py --skip-scada

Ce script est volontairement DEFENSIF : il diagnostique tout avant d'ecrire quoi
que ce soit, et chaque echec dit quoi faire. Une installation qui echoue a la
moitie du chemin laisse une base a moitie remplie, plus dure a reparer qu'a
recommencer.

Ce qu'il fait :
    1. verifie Python, les paquets, le .env, le dataset
    2. teste la connexion MongoDB
    3. ingere Data2023.xlsx -> collection `weather` (~8785 lignes horaires)
    4. genere l'etat des equipements -> `scada_telemetry` / `scada_alarms` / `ems_setpoints`

Ce qu'il ne fait PAS : creer les utilisateurs et les index. Le backend s'en
charge tout seul a son premier demarrage (init_db).
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent
ENV_FILE = RACINE / "gridbalance-app" / ".env"
ENV_EXEMPLE = RACINE / "gridbalance-app" / ".env.example"
DATASET = RACINE / "Data2023.xlsx"

VERT, ROUGE, JAUNE, GRIS, RAZ = "\033[92m", "\033[91m", "\033[93m", "\033[90m", "\033[0m"


def ok(msg: str) -> None:
    print(f"  {VERT}OK{RAZ}    {msg}")


def echec(msg: str, remede: str = "") -> None:
    print(f"  {ROUGE}ECHEC{RAZ} {msg}")
    if remede:
        print(f"        {GRIS}-> {remede}{RAZ}")


def alerte(msg: str, detail: str = "") -> None:
    print(f"  {JAUNE}NOTE{RAZ}  {msg}")
    if detail:
        print(f"        {GRIS}{detail}{RAZ}")


def titre(t: str) -> None:
    print(f"\n{t}\n{'-' * len(t)}")


def lire_env(cle: str, defaut: str = "") -> str:
    if not ENV_FILE.exists():
        return defaut
    for ligne in ENV_FILE.read_text(encoding="utf-8").splitlines():
        ligne = ligne.strip()
        if ligne.startswith(f"{cle}=") and not ligne.startswith("#"):
            return ligne.split("=", 1)[1].strip().strip('"').strip("'") or defaut
    return defaut


# --------------------------------------------------------------------------
# 1. Verifications
# --------------------------------------------------------------------------
def verifier() -> tuple[bool, str]:
    """Renvoie (tout_va_bien, mongo_url)."""
    bon = True
    titre("1. Environnement")

    if sys.version_info < (3, 11):
        echec(f"Python {sys.version_info.major}.{sys.version_info.minor}",
              "Python 3.11+ requis (le code utilise la syntaxe `X | None`).")
        bon = False
    else:
        ok(f"Python {sys.version_info.major}.{sys.version_info.minor}")

    manquants = []
    for paquet, pip in [("pymongo", "pymongo"), ("openpyxl", "openpyxl"), ("certifi", "certifi")]:
        try:
            __import__(paquet)
            ok(f"paquet {paquet}")
        except ImportError:
            echec(f"paquet {paquet} manquant")
            manquants.append(pip)
    if manquants:
        print(f"        {GRIS}-> pip install -r gridbalance-app/backend/requirements.txt{RAZ}")
        bon = False

    titre("2. Fichiers")
    if not ENV_FILE.exists():
        echec(f"{ENV_FILE.relative_to(RACINE)} absent",
              f"copiez {ENV_EXEMPLE.relative_to(RACINE)} en .env, puis renseignez MONGO_URL")
        bon = False
    else:
        ok(f"{ENV_FILE.relative_to(RACINE)}")

    if not DATASET.exists():
        echec("Data2023.xlsx absent",
              "le dataset NASA doit etre a la racine du depot")
        bon = False
    else:
        ok(f"Data2023.xlsx ({DATASET.stat().st_size // 1024} Ko)")

    titre("3. Base de donnees")
    mongo_url = lire_env("MONGO_URL", "memory")
    if mongo_url.strip().lower() in ("", "memory", "mock", "none"):
        echec("MONGO_URL est en mode 'memory'")
        print(f"        {GRIS}Le mode memoire vit dans le process du backend : un script")
        print("        externe ne peut pas y ecrire, et la meteo ne peut donc pas etre")
        print("        ingeree. La tuile temps reel et les pages SCADA resteront vides.")
        print("        -> renseignez une vraie URI dans gridbalance-app/.env :")
        print("           MONGO_URL=mongodb://localhost:27017")
        print(f"           MONGO_URL=mongodb+srv://user:pass@cluster.mongodb.net/{RAZ}")
        return False, mongo_url

    hote = mongo_url.split("@")[-1].split("/")[0] if "@" in mongo_url else mongo_url
    ok(f"MONGO_URL -> {hote}")

    if bon:
        try:
            import certifi
            from pymongo import MongoClient

            cli = MongoClient(mongo_url, tlsCAFile=certifi.where(), serverSelectionTimeoutMS=8000)
            cli.admin.command("ping")
            ok("connexion MongoDB etablie")
        except Exception as exc:  # noqa: BLE001
            echec(f"connexion MongoDB : {str(exc)[:90]}",
                  "verifiez l'URI, le mot de passe, et que votre IP est autorisee (Atlas > Network Access)")
            bon = False

    return bon, mongo_url


# --------------------------------------------------------------------------
# 2. Remplissage
# --------------------------------------------------------------------------
def ingerer_meteo() -> bool:
    titre("4. Meteo -> collection `weather`")
    res = subprocess.run(
        [sys.executable, str(RACINE / "ingest_weather.py")],
        cwd=RACINE, capture_output=True, text=True,
    )
    sortie = (res.stdout + res.stderr).strip()
    if res.returncode != 0:
        echec("ingestion echouee")
        print(f"        {GRIS}{sortie[:400]}{RAZ}")
        return False
    for ligne in sortie.splitlines()[-3:]:
        if ligne.strip():
            ok(ligne.strip())
    return True


def remplir_scada(mongo_url: str, mongo_db: str) -> bool:
    """Genere l'etat des equipements sans passer par le backend.

    On rejoue ici la meme chaine que le service (SCADA -> EMS -> SCADA) : le
    script n'a pas besoin que l'API tourne, ce qui evite un ordre de demarrage
    fragile ("lancez le backend PUIS le script PUIS...").
    """
    titre("5. Equipements -> `scada_telemetry` / `scada_alarms` / `ems_setpoints`")
    try:
        import certifi
        from pymongo import MongoClient

        sys.path.insert(0, str(RACINE))
        import agent_simulation as eng
        import ems_simulation as ems
        import facture_onee
        import scada_simulation as scada

        db = MongoClient(mongo_url, tlsCAFile=certifi.where(),
                         serverSelectionTimeoutMS=8000)[mongo_db]

        n = db.weather.count_documents({})
        if n == 0:
            echec("collection `weather` vide", "l'etape 4 doit reussir avant celle-ci")
            return False

        heures = 72
        docs = list(db.weather.find({"h_index": {"$lt": heures}}).sort("h_index", 1))

        facture = facture_onee.load_facture()
        grid_cap = round(facture.puissance_souscrite_kva * eng.COS_PHI / 1000, 3)
        calib = facture_onee.calibration_factors(
            eng.profile_kwh_by_period(facture.heures_facturees), facture
        )

        telemetrie, consignes = [], []
        socs = [0.5] * len(scada.BATTERIES)

        for d in docs:
            h_local = (int(d["hour_utc"]) + eng.UTC_OFFSET_HOURS) % 24
            periode, _prix = eng.tariff_for_hour(h_local)
            demande = round(eng.demand_mw(h_local) * calib.get(periode, 1.0), 3)

            snap = scada.scada_snapshot(
                float(d["ws10m"]), float(d["irr"]), float(d["t2m"]),
                soc=sum(socs) / len(socs), socs=socs, ts_utc=d["ts_utc"],
                seed=int(d["h_index"]), rh2m=float(d.get("rh2m") or 0),
                wd10m=float(d.get("wd10m") or 0),
            )
            plan = ems.ems_consignes(snap, demande, grid_cap, periode)
            snap = scada.scada_snapshot(
                float(d["ws10m"]), float(d["irr"]), float(d["t2m"]),
                soc=sum(socs) / len(socs), socs=socs, ts_utc=d["ts_utc"],
                puissance_batterie_mw=plan["bilan"]["batterie_mw"],
                seed=int(d["h_index"]), rh2m=float(d.get("rh2m") or 0),
                wd10m=float(d.get("wd10m") or 0),
            )

            for e in snap["equipements"]:
                telemetrie.append({**e, "_id": f"{e['equipement_id']}-{d['h_index']}",
                                   "h_index": int(d["h_index"]), "ts_utc": d["ts_utc"],
                                   "hour_local": h_local})
                if e["type"] != "batterie":
                    continue
                i = next((k for k, b in enumerate(scada.BATTERIES)
                          if b["id"] == e["equipement_id"]), None)
                if i is None:
                    continue
                p = e["puissance_mw"]
                cap = float(e["capacite_mwh"])
                if p > 0:
                    socs[i] -= (p / 0.92) / cap
                elif p < 0:
                    socs[i] += (-p * 0.92) / cap
                socs[i] = min(0.95, max(0.10, socs[i]))

            consignes.append({"_id": f"ems-{d['h_index']}", "h_index": int(d["h_index"]),
                              "ts_utc": d["ts_utc"], "hour_local": h_local,
                              "bilan": plan["bilan"], "consignes": plan["consignes"],
                              "contraintes": plan["contraintes"],
                              "escalade_agents": plan["escalade_agents"]})

        db.scada_telemetry.delete_many({})
        db.ems_setpoints.delete_many({})
        if telemetrie:
            db.scada_telemetry.insert_many(telemetrie)
        if consignes:
            db.ems_setpoints.insert_many(consignes)

        n_eq = len({t["equipement_id"] for t in telemetrie})
        ok(f"{len(telemetrie)} mesures ({n_eq} equipements x {heures} h)")
        ok(f"{len(consignes)} consignes EMS")
        return True
    except Exception as exc:  # noqa: BLE001
        echec(f"generation SCADA : {str(exc)[:120]}")
        return False


def main() -> int:
    p = argparse.ArgumentParser(description="Installation du projet EQUILIBRIA.")
    p.add_argument("--check", action="store_true", help="verifier sans rien ecrire")
    p.add_argument("--skip-scada", action="store_true", help="ne pas generer les equipements")
    args = p.parse_args()

    print("\nEQUILIBRIA — verification de l'installation")
    print("=" * 44)

    bon, mongo_url = verifier()
    if not bon:
        print(f"\n{ROUGE}Corrigez les points ci-dessus, puis relancez.{RAZ}\n")
        return 1
    if args.check:
        print(f"\n{VERT}Environnement pret.{RAZ} Relancez sans --check pour remplir la base.\n")
        return 0

    if not ingerer_meteo():
        return 1
    if not args.skip_scada and not remplir_scada(mongo_url, lire_env("MONGO_DB", "gridbalance")):
        return 1

    print(f"\n{VERT}Base prete.{RAZ} Il reste a lancer les deux services :\n")
    print("  cd gridbalance-app/backend")
    print("  python -m uvicorn app.main:app --port 8000")
    print(f"      {GRIS}(cree les index et les 3 utilisateurs demo au demarrage){RAZ}\n")
    print("  cd gridbalance-app/frontend")
    print("  npm install && npm run dev\n")
    print(f"  -> http://localhost:3000   {GRIS}operator@demo.ma / demo1234{RAZ}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
