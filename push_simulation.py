"""
Pousse un tirage de l'Agent Simulation vers le webhook d'un flow Langflow / ABA Fusion.

C'est TA machine qui appelle la plateforme : rien a exposer, aucun tunnel,
fonctionne que Langflow soit en local ou heberge.

    python push_simulation.py --url https://<instance>/api/v1/webhook/<flow_id>
    python push_simulation.py --mode window -n 360 --seed 42     # URL lue dans .env (WF1_URL)
    python push_simulation.py --dry-run                          # affiche sans envoyer

Bibliotheque standard uniquement (urllib) : rien a installer.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from agent_simulation import DEFAULT_HORIZON_HOURS, DatasetError, simulate
from facture_onee import FactureError

ENV_FILE = Path(__file__).with_name("gridbalance-app") / ".env"
DEFAULT_TIMEOUT = 60
DEFAULT_RETRIES = 2


def read_env(key: str, env_file: Path = ENV_FILE) -> str | None:
    """Lit une cle du .env sans dependance a python-dotenv."""
    if not env_file.exists():
        return None
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith(f"{key}=") and not line.startswith("#"):
            value = line.split("=", 1)[1].strip().strip('"').strip("'")
            return value or None
    return None


def post_json(url: str, payload: dict, timeout: int, retries: int) -> tuple[int, str]:
    """POST avec backoff exponentiel. Renvoie (status, corps)."""
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    last_error: Exception | None = None

    for attempt in range(retries + 1):
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            # 4xx : la requete est mauvaise, reessayer n'y changera rien.
            detail = exc.read().decode("utf-8", "replace")
            if 400 <= exc.code < 500:
                return exc.code, detail
            last_error = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc

        if attempt < retries:
            delay = 2**attempt
            print(f"  tentative {attempt + 1} echouee ({last_error}) — nouvel essai dans {delay}s",
                  file=sys.stderr)
            time.sleep(delay)

    raise ConnectionError(f"{retries + 1} tentatives echouees : {last_error}")


def main() -> int:
    p = argparse.ArgumentParser(description="Pousse un tirage NASA vers le webhook Langflow")
    p.add_argument("--url", default=None,
                   help="endpoint webhook du flow (defaut : WF1_URL du .env)")
    p.add_argument("--mode", choices=("spot", "window"), default="window")
    p.add_argument("-n", "--hours", type=int, default=DEFAULT_HORIZON_HOURS)
    p.add_argument("--anchor", choices=("now", "random"), default="now",
                   help="now = la serie demarre a l'heure reelle d'envoi (defaut)")
    p.add_argument("--seed", type=int, default=None, help="tirage reproductible (avec --anchor random)")
    p.add_argument("--correlation-id", default=None)
    p.add_argument("--data", default=None, help="chemin du dataset")
    p.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    p.add_argument("--retries", type=int, default=DEFAULT_RETRIES)
    p.add_argument("--dry-run", action="store_true", help="affiche le payload sans l'envoyer")
    args = p.parse_args()

    # 1. Construire le payload
    try:
        kwargs = {"mode": args.mode, "hours": args.hours, "seed": args.seed,
                  "correlation_id": args.correlation_id, "anchor": args.anchor}
        if args.data:
            kwargs["data_path"] = args.data
        payload = simulate(**kwargs)
    except (DatasetError, FactureError, ValueError) as exc:
        print(f"ECHEC — payload non construit : {exc}", file=sys.stderr)
        return 1

    cid = payload["correlation_id"]
    n = len(payload["series"])
    meta = payload["meta"]
    print(f"Payload : {n} point(s), correlation_id={cid}")
    print(f"          {meta['period_start_utc']} -> {meta['period_end_utc']}")
    print(f"          envoye a {meta['sent_at_local'][11:16]} locale "
          f"-> start_hour_local={payload['start_hour_local']} "
          f"(l'heure que WF-2 utilisera pour h=0)")

    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    # 2. Resoudre l'URL
    url = args.url or read_env("WF1_URL")
    if not url:
        print(
            "ECHEC — aucune URL de webhook.\n"
            "  Passez --url, ou renseignez WF1_URL dans gridbalance-app/.env.\n"
            "  L'endpoint est visible dans le noeud Webhook du flow, apres import\n"
            "  (il change a CHAQUE reimport : pensez a le relever).",
            file=sys.stderr,
        )
        return 2

    # 3. Envoyer
    print(f"POST -> {url}")
    try:
        status, body = post_json(url, payload, args.timeout, args.retries)
    except ConnectionError as exc:
        print(f"ECHEC — plateforme injoignable : {exc}", file=sys.stderr)
        return 3

    print(f"HTTP {status}")
    print(body[:800] or "(corps vide)")

    if status == 202:
        # Langflow/ABA Fusion accuse reception et traite en tache de fond : le
        # resultat de l'agent n'est PAS dans cette reponse. Voir le README.
        print(
            f"\nATTENTION : 202 Accepted — la plateforme a pris la tache en arriere-plan\n"
            f"et ne renvoie PAS le resultat de l'agent dans cette reponse.\n"
            f"Le payload est bien parti. Pour savoir ce que l'agent en a fait, ouvrez\n"
            f"le flow dans l'interface, ou suivez le correlation_id {cid}.",
            file=sys.stderr,
        )
        return 0

    if not (200 <= status < 300):
        print(f"\nECHEC — la plateforme a rejete le payload (HTTP {status}).", file=sys.stderr)
        return 4

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
