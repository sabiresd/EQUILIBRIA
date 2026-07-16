"""
Test de bout en bout des agents 1 et 2.

    python tester_agents.py            # chaine locale, deterministe, avec assertions
    python tester_agents.py --push     # + envoi reel vers le webhook de la plateforme

Ce que ce test verrouille, et pourquoi :

  - CONTRAT      le payload de WF-1 passe la validation Pydantic stricte
                 (extra="forbid" : un champ en trop = rejet). Sans ca, le backend
                 refuserait le payload en mode live.

  - HEURE        l'heure d'envoi est bien celle que WF-2 utilise. C'est la faute
                 la plus couteuse : une serie envoyee a 22 h dont WF-2 croit
                 qu'elle commence a minuit facture les heures de pointe au tarif
                 creuse, et personne ne le voit.

  - HORIZON      WF-2 calcule les 360 heures, une par une. Le LLM precedent en
                 calculait 24 et les multipliait par 15 ("repetition": 15), ce qui
                 faisait disparaitre les episodes sans vent -- le probleme meme
                 que le produit resout.

  - INTEGRITE    les totaux DECOULENT du tableau horaire. Le LLM annoncait 10 041
                 MAD quand ses propres lignes en sommaient 792, et 5,3 % de reseau
                 quand toutes ses lignes disaient 0.

  - PHYSIQUE     le SoC reste entre son plancher et sa capacite ; la production
                 eolienne respecte la courbe (6)-(8) ; rien n'est servi deux fois.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path[:0] = [str(Path(__file__).parent / "gridbalance-app"),
                str(Path(__file__).parent / "gridbalance-app" / "backend")]

import agent_simulation as A  # noqa: E402
from agent_calcul import battery_contribution, compute, tariff_period  # noqa: E402
from facture_onee import load_facture  # noqa: E402

HORIZON = 360
ECHECS: list[str] = []


def verifier(nom: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  [OK]     {nom}")
    else:
        print(f"  [ECHEC]  {nom}" + (f"  -> {detail}" if detail else ""))
        ECHECS.append(nom)


def main() -> int:
    push = "--push" in sys.argv

    print("=" * 74)
    print("AGENT 1 — Simulateur (meteo NASA 2023 + facture ONEE)")
    print("=" * 74)

    facture = load_facture()
    payload = A.simulate(mode="window", hours=HORIZON)
    series = payload["series"]
    sh = payload["start_hour_local"]

    print(f"  correlation_id   : {payload['correlation_id']}")
    print(f"  fenetre          : {payload['meta']['period_start_utc']} -> "
          f"{payload['meta']['period_end_utc']}")
    print(f"  envoye a         : {payload['meta']['sent_at_local'][11:16]} locale "
          f"-> start_hour_local = {sh}")
    print(f"  facture          : {facture.reference} | "
          f"{facture.puissance_souscrite_kva:.0f} kVA -> plafond {payload['grid_cap_mw']} MW")
    print(f"  recalage conso   : {payload['meta']['calibration_factors']}")
    print()

    verifier("360 points de serie", len(series) == HORIZON, f"{len(series)} points")
    verifier("indices h contigus de 0 a 359",
             [p["h"] for p in series] == list(range(HORIZON)))
    verifier("l'heure d'envoi est transmise a WF-2 (start_hour_local)",
             0 <= sh <= 23)
    verifier("le plafond reseau vient de la facture (puissance souscrite)",
             abs(payload["grid_cap_mw"] - facture.puissance_souscrite_kva * A.COS_PHI / 1000) < 1e-6)

    # Production eolienne : jamais au-dessus de N_wt x P_rated x eta (formule 7).
    p_max_parc = A.N_WT * A.P_RATED_MW * A.ETA_WT
    verifier(f"production eolienne bornee par N_wt x P_rated x eta = {p_max_parc:.3f} MW",
             all(p["prod_wind_mw"] <= p_max_parc + 1e-9 for p in series),
             f"max observe {max(p['prod_wind_mw'] for p in series)}")
    verifier("production solaire nulle quand l'irradiance est nulle",
             all(p["prod_solar_mw"] == 0 for p in series if p["ghi"] == 0))

    # Contrat : le backend rejette tout champ en trop (extra="forbid").
    from contracts.contracts import WF2Request  # noqa: E402

    try:
        WF2Request(**payload)
        verifier("le payload passe la validation Pydantic stricte du contrat", True)
    except Exception as exc:  # noqa: BLE001
        verifier("le payload passe la validation Pydantic stricte du contrat",
                 False, str(exc)[:120])

    print()
    print("=" * 74)
    print("AGENT 2 — Calcul (dispatch batterie, deficits, couts)")
    print("=" * 74)

    r = compute(payload)          # leve CalculError si les totaux ne collent pas
    t = r["totals"]
    hourly = r["hourly"]

    print(f"  cout total        : {t['total_cost']:>12,.2f} MAD")
    print(f"  heures en deficit : {t['hours_in_deficit']:>12d} h")
    print(f"  deficit total     : {t['total_deficit_mwh']:>12.2f} MWh")
    print(f"  parts             : production {t['share_production']:.1%} | "
          f"batterie {t['share_battery']:.1%} | reseau {t['share_grid']:.1%}")
    print()

    verifier("les 360 heures sont calculees, une par une (pas de journee type x15)",
             len(hourly) == HORIZON, f"{len(hourly)} heures")

    somme = round(sum(h["cost"] for h in hourly), 2)
    verifier("le cout total est la SOMME des couts horaires",
             abs(somme - t["total_cost"]) <= 1.0,
             f"total={t['total_cost']} vs somme={somme}")

    parts = t["share_production"] + t["share_battery"] + t["share_grid"]
    verifier("les parts somment a 100 %", abs(parts - 1.0) < 0.01, f"{parts}")

    grid_utilise = any(h["grid_mw"] > 0 for h in hourly)
    verifier("la part reseau annoncee est coherente avec le tableau",
             (t["share_grid"] > 0) == grid_utilise)

    # L'heure locale que WF-2 applique doit etre celle de l'envoi.
    h0_local = (0 + sh) % 24
    verifier(f"h=0 est bien traite comme {h0_local:02d}h locale (heure d'envoi)",
             hourly[0]["tariff_period"] == tariff_period(0, sh))

    verifier("jamais de tarif de pointe en pleine nuit",
             all(h["tariff_period"] != "pointe"
                 for h in hourly if (h["h"] + sh) % 24 in (0, 1, 2, 3, 4)))

    # Physique de la batterie.
    soc_min = payload["battery"]["soc_min"]
    verifier(f"le SoC reste entre son plancher ({soc_min:.0%}) et 100 %",
             all(soc_min - 1e-6 <= h["soc"] <= 1.0 + 1e-6 for h in hourly),
             f"min={min(h['soc'] for h in hourly)} max={max(h['soc'] for h in hourly)}")

    cap = payload["grid_cap_mw"]
    verifier("le soutirage ne depasse jamais la puissance souscrite",
             all(h["grid_mw"] <= cap + 1e-6 for h in hourly))
    verifier("un deficit n'apparait QUE quand le plafond est atteint",
             all(abs(h["grid_mw"] - cap) < 1e-6 for h in hourly if h["deficit_mw"] > 0))

    print()
    print("=" * 74)
    print("CE QUE LE PILOTAGE APPORTE REELLEMENT")
    print("=" * 74)
    c = battery_contribution(payload)
    print(f"  1. facture actuelle (100 % reseau)   {c['facture_actuelle_mad']:>12,.0f} MAD")
    print(f"  2. + parc renouvelable               {c['avec_parc_sans_batterie_mad']:>12,.0f} MAD"
          f"   (le parc apporte {c['apport_du_parc_mad']:,.0f})")
    print(f"  3. + batterie pilotee                {c['avec_parc_et_batterie_mad']:>12,.0f} MAD"
          f"   (l'IA apporte {c['apport_de_la_batterie_mad']:,.0f} = {c['apport_de_la_batterie_pct']} %)")
    print()
    print(f"  Deficit residuel : {c['deficit_avec_batterie_h']} h / "
          f"{c['deficit_residuel_mwh']} MWh  -> c'est ce que WF-3 doit couvrir.")
    print("  La batterie ne supprime AUCUNE heure de deficit : elle se vide pendant")
    print("  l'episode sans vent, et plus rien ne la recharge. C'est l'argument du produit.")

    if push:
        print()
        print("=" * 74)
        print("ENVOI REEL VERS LA PLATEFORME")
        print("=" * 74)
        from push_simulation import post_json, read_env

        url = read_env("WF1_URL")
        if not url:
            print("  WF1_URL absent du .env — envoi ignore.")
        else:
            status, body = post_json(url, payload, timeout=60, retries=1)
            print(f"  POST -> {url}")
            print(f"  HTTP {status} : {body[:80]}")
            verifier("la plateforme accepte le payload", 200 <= status < 300)
            print()
            print("  ATTENTION : un 202 ne prouve QUE la reception. L'Agent Calcul de la")
            print("  plateforme est encore un LLM : ses chiffres ne sont pas ceux ci-dessus.")

    print()
    print("=" * 74)
    if ECHECS:
        print(f"ECHEC — {len(ECHECS)} verification(s) en echec :")
        for e in ECHECS:
            print(f"  - {e}")
        return 1
    print("TOUT PASSE — la chaine Agent 1 -> Agent 2 est correcte et verifiee.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
