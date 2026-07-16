"""
Generateur de facture ONEE Moyenne Tension (donnees de DEMONSTRATION).

Produit `facture_onee_demo.json` a partir d'hypotheses EXPLICITES, plutot qu'un
JSON ecrit a la main : le fichier est reproductible, parametrable, et chaque
chiffre se justifie.

    python generer_facture.py                       # regenere la facture par defaut
    python generer_facture.py --conso-mwh 1200      # un site plus gros
    python generer_facture.py --mois 2023-01 -o autre.json

Structure (tarif MT, option generale) :
    montant = energie (kWh x prix du poste)  +  prime de puissance (kVA x prix)
    TTC     = montant HT x (1 + TVA)

IMPORTANT — le profil de charge suppose ici (poids par poste horaire) est
DELIBEREMENT different de la sinusoide du simulateur : une usine MT marocaine
tourne en 3x8, elle consomme donc la nuit. C'est ce qui rend le recalage
(agent_simulation.calibration_factors) non trivial : la facture APPREND quelque
chose au simulateur, au lieu de lui renvoyer ses propres hypotheses.

Valeurs de DEMONSTRATION. Aucune valeur officielle ONEE / ANRE.
"""

from __future__ import annotations

import argparse
import calendar
import json
from pathlib import Path

# --- Hypotheses du site ------------------------------------------------------

CONSO_MENSUELLE_MWH = 936.0     # ~1.3 MW moyen : usine MT de taille moyenne
PUISSANCE_SOUSCRITE_KVA = 2500
TAUX_UTILISATION_POINTE = 0.95  # puissance appelee max / souscrite

# Repartition de l'energie par poste horaire. Une usine en 3x8 consomme la nuit :
# les heures creuses pesent lourd, bien plus que ne le supposerait un profil
# purement diurne. Les poids sont normalises, seul leur RAPPORT compte.
REPARTITION_POSTES = {
    "creuse": 0.287,   # 22h-06h : 8 h/j, equipe de nuit
    "normale": 0.548,  # 06h-18h : 12 h/j, plein regime
    "pointe": 0.165,   # 18h-22h : 4 h/j, l'usine leve le pied (le kWh y coute 2x)
}

# Tarification ONEE MT (demonstration).
PRIX_MAD_KWH = {"creuse": 0.65, "normale": 0.90, "pointe": 1.40}
PRIME_PUISSANCE_MAD_KVA_MOIS = 40.0
TVA_PCT = 20.0

CLIENT = "Usine de demonstration - Zone industrielle Kenitra"
TARIF = "Moyenne Tension - Option generale"

OUT_FILE = Path(__file__).with_name("facture_onee_demo.json")


def generer(
    conso_mwh: float = CONSO_MENSUELLE_MWH,
    mois: str = "2023-08",
    puissance_kva: float = PUISSANCE_SOUSCRITE_KVA,
) -> dict:
    annee, m = (int(x) for x in mois.split("-"))
    jours = calendar.monthrange(annee, m)[1]

    total_kwh = conso_mwh * 1000.0
    poids = sum(REPARTITION_POSTES.values())
    conso = {p: round(total_kwh * w / poids) for p, w in REPARTITION_POSTES.items()}

    # L'arrondi par poste ne retombe pas forcement sur le total : on absorbe
    # l'ecart sur le poste le plus gros, pour que la facture soit exacte au kWh.
    ecart = round(total_kwh) - sum(conso.values())
    if ecart:
        plus_gros = max(conso, key=lambda p: conso[p])
        conso[plus_gros] += ecart

    montant_energie = round(sum(conso[p] * PRIX_MAD_KWH[p] for p in conso), 2)
    montant_puissance = round(puissance_kva * PRIME_PUISSANCE_MAD_KVA_MOIS, 2)
    montant_ht = round(montant_energie + montant_puissance, 2)
    montant_tva = round(montant_ht * TVA_PCT / 100, 2)
    montant_ttc = round(montant_ht + montant_tva, 2)

    return {
        "_disclaimer": (
            "Facture GENEREE par generer_facture.py. Structure inspiree du tarif ONEE "
            "Moyenne Tension (option generale), valeurs fictives. "
            "Aucune valeur officielle ONEE / ANRE."
        ),
        "_hypotheses": {
            "conso_mensuelle_mwh": conso_mwh,
            "repartition_postes": REPARTITION_POSTES,
            "note": (
                "Profil 3x8 : l'usine tourne la nuit, d'ou un poste creuse eleve. "
                "C'est cette information que la facture apporte au simulateur."
            ),
        },
        "reference": f"ONEE-MT-{annee}-{m:02d}-004217",
        "client": CLIENT,
        "tarif": TARIF,
        "periode_debut": f"{annee}-{m:02d}-01",
        "periode_fin": f"{annee}-{m:02d}-{jours:02d}",
        "jours_factures": jours,
        "puissance_souscrite_kva": puissance_kva,
        "puissance_appelee_max_kva": round(puissance_kva * TAUX_UTILISATION_POINTE),
        "prime_puissance_mad_kva_mois": PRIME_PUISSANCE_MAD_KVA_MOIS,
        "consommation_kwh": {p: float(conso[p]) for p in ("creuse", "normale", "pointe")},
        "prix_mad_kwh": dict(PRIX_MAD_KWH),
        "montant_energie_mad": montant_energie,
        "montant_puissance_mad": montant_puissance,
        "montant_ht_mad": montant_ht,
        "tva_pct": TVA_PCT,
        "montant_tva_mad": montant_tva,
        "montant_total_ttc_mad": montant_ttc,
    }


def main() -> int:
    p = argparse.ArgumentParser(description="Genere une facture ONEE MT de demonstration")
    p.add_argument("--conso-mwh", type=float, default=CONSO_MENSUELLE_MWH)
    p.add_argument("--mois", default="2023-08", help="AAAA-MM")
    p.add_argument("--puissance-kva", type=float, default=PUISSANCE_SOUSCRITE_KVA)
    p.add_argument("-o", "--out", default=str(OUT_FILE))
    args = p.parse_args()

    facture = generer(args.conso_mwh, args.mois, args.puissance_kva)
    Path(args.out).write_text(
        json.dumps(facture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # On relit avec le controleur : une facture generee doit passer le meme
    # controle d'arithmetique qu'une facture fournie par le client.
    from facture_onee import load_facture

    f = load_facture(args.out, strict=True)
    print(f"Facture generee : {args.out}")
    print(f"  {f.reference} | {f.periode_debut} -> {f.periode_fin} ({f.jours_factures} j)")
    print(f"  consommation : {f.total_kwh:>12,.0f} kWh  ({f.total_kwh / 1000:,.0f} MWh)")
    for poste in ("creuse", "normale", "pointe"):
        part = f.consommation_kwh[poste] / f.total_kwh * 100
        print(f"     {poste:8s} {f.consommation_kwh[poste]:>10,.0f} kWh  ({part:4.1f} %)"
              f"  a {f.prix_mad_kwh[poste]:.2f} MAD/kWh")
    print(f"  energie      : {f.montant_energie_mad:>12,.2f} MAD")
    print(f"  puissance    : {f.montant_puissance_mad:>12,.2f} MAD "
          f"({f.puissance_souscrite_kva:,.0f} kVA)")
    print(f"  TOTAL TTC    : {f.montant_total_ttc_mad:>12,.2f} MAD  (TVA {f.tva_pct:.0f} %)")
    print(f"  prix moyen   : {f.prix_moyen_mad_kwh:>12.3f} MAD/kWh")
    print("\nControle d'arithmetique : OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
