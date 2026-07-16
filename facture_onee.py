"""
Facture ONEE (Moyenne Tension) — chargement, controle, et exploitation.

La facture sert a TROIS choses dans la chaine :

  1. RECALER la consommation simulee. Le profil horaire synthetique (0.8 -> 2.2 MW)
     donne une COURBE plausible, mais pas le bon NIVEAU. La facture donne les kWh
     reellement consommes par poste horaire : on met le profil a l'echelle, poste
     par poste, pour que son total colle a la facture.

  2. FOURNIR LES VRAIS TARIFS a l'Agent Calcul, au lieu de prix codes en dur.

  3. SERVIR DE REFERENCE (baseline). C'est ce que l'usine paie AUJOURD'HUI, sans
     batterie ni reequilibrage. L'Agent Calcul chiffre l'economie par rapport a ca.
     C'est l'argument commercial : "vous payez X, vous paierez Y".

Valeurs de DEMONSTRATION. Aucune valeur officielle ONEE / ANRE.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

FACTURE_FILE = Path(__file__).with_name("facture_onee_demo.json")

PERIODS = ("creuse", "normale", "pointe")

# Tolerance sur le controle des montants (arrondis de facturation).
MONTANT_TOLERANCE_MAD = 1.0


class FactureError(RuntimeError):
    """Facture introuvable, malformee, ou dont les montants ne sont pas coherents."""


@dataclass(frozen=True)
class Facture:
    reference: str
    periode_debut: str
    periode_fin: str
    jours_factures: int
    puissance_souscrite_kva: float
    prime_puissance_mad_kva_mois: float
    consommation_kwh: dict[str, float]   # par poste horaire
    prix_mad_kwh: dict[str, float]       # par poste horaire
    montant_energie_mad: float
    montant_puissance_mad: float
    montant_ht_mad: float
    tva_pct: float
    montant_total_ttc_mad: float
    raw: dict[str, Any]

    @property
    def total_kwh(self) -> float:
        return sum(self.consommation_kwh.values())

    @property
    def heures_facturees(self) -> int:
        return self.jours_factures * 24

    @property
    def prix_moyen_mad_kwh(self) -> float:
        return self.montant_energie_mad / self.total_kwh if self.total_kwh else 0.0

    def tariffs_mad_mwh(self) -> dict[str, float]:
        """Contrat Tariffs : MAD/MWh (la facture est en MAD/kWh)."""
        return {p: round(self.prix_mad_kwh[p] * 1000, 2) for p in PERIODS}


def _check_amounts(f: Facture) -> list[str]:
    """Recalcule la facture et signale toute incoherence.

    Une facture dont les montants ne tombent pas juste fausse silencieusement
    la baseline, donc l'economie annoncee. On prefere le dire tout de suite.
    """
    warnings: list[str] = []

    energie = sum(f.consommation_kwh[p] * f.prix_mad_kwh[p] for p in PERIODS)
    if abs(energie - f.montant_energie_mad) > MONTANT_TOLERANCE_MAD:
        warnings.append(
            f"montant_energie_mad={f.montant_energie_mad:,.2f} mais le recalcul "
            f"donne {energie:,.2f} MAD (ecart {energie - f.montant_energie_mad:+,.2f})"
        )

    puissance = f.puissance_souscrite_kva * f.prime_puissance_mad_kva_mois
    if abs(puissance - f.montant_puissance_mad) > MONTANT_TOLERANCE_MAD:
        warnings.append(
            f"montant_puissance_mad={f.montant_puissance_mad:,.2f} mais "
            f"{f.puissance_souscrite_kva:,.0f} kVA x {f.prime_puissance_mad_kva_mois} "
            f"= {puissance:,.2f} MAD"
        )

    ht = f.montant_energie_mad + f.montant_puissance_mad
    if abs(ht - f.montant_ht_mad) > MONTANT_TOLERANCE_MAD:
        warnings.append(f"montant_ht_mad={f.montant_ht_mad:,.2f} au lieu de {ht:,.2f}")

    ttc = f.montant_ht_mad * (1 + f.tva_pct / 100)
    if abs(ttc - f.montant_total_ttc_mad) > MONTANT_TOLERANCE_MAD:
        warnings.append(
            f"montant_total_ttc_mad={f.montant_total_ttc_mad:,.2f} au lieu de {ttc:,.2f}"
        )

    return warnings


def load_facture(path: Path | str = FACTURE_FILE, strict: bool = True) -> Facture:
    """Charge et CONTROLE une facture.

    strict=True : une incoherence de montants leve une erreur.
    strict=False : elle est seulement signalee (retournee dans .raw['_warnings']).
    """
    path = Path(path)
    if not path.exists():
        raise FactureError(
            f"Facture introuvable : {path}\n"
            f"Utilisez facture_onee_demo.json comme modele, ou passez --facture."
        )

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise FactureError(f"{path.name} n'est pas un JSON valide : {exc}") from exc

    required = [
        "reference", "periode_debut", "periode_fin", "jours_factures",
        "puissance_souscrite_kva", "prime_puissance_mad_kva_mois",
        "consommation_kwh", "prix_mad_kwh", "montant_energie_mad",
        "montant_puissance_mad", "montant_ht_mad", "tva_pct", "montant_total_ttc_mad",
    ]
    missing = [k for k in required if k not in raw]
    if missing:
        raise FactureError(f"Champs manquants dans {path.name} : {missing}")

    for field in ("consommation_kwh", "prix_mad_kwh"):
        absent = [p for p in PERIODS if p not in raw[field]]
        if absent:
            raise FactureError(f"{field} : postes horaires manquants {absent}")

    facture = Facture(
        reference=str(raw["reference"]),
        periode_debut=str(raw["periode_debut"]),
        periode_fin=str(raw["periode_fin"]),
        jours_factures=int(raw["jours_factures"]),
        puissance_souscrite_kva=float(raw["puissance_souscrite_kva"]),
        prime_puissance_mad_kva_mois=float(raw["prime_puissance_mad_kva_mois"]),
        consommation_kwh={p: float(raw["consommation_kwh"][p]) for p in PERIODS},
        prix_mad_kwh={p: float(raw["prix_mad_kwh"][p]) for p in PERIODS},
        montant_energie_mad=float(raw["montant_energie_mad"]),
        montant_puissance_mad=float(raw["montant_puissance_mad"]),
        montant_ht_mad=float(raw["montant_ht_mad"]),
        tva_pct=float(raw["tva_pct"]),
        montant_total_ttc_mad=float(raw["montant_total_ttc_mad"]),
        raw=raw,
    )

    if facture.total_kwh <= 0:
        raise FactureError("La facture ne declare aucune consommation.")

    warnings = _check_amounts(facture)
    if warnings:
        message = f"Facture {facture.reference} incoherente :\n  - " + "\n  - ".join(warnings)
        if strict:
            raise FactureError(message)
        facture.raw["_warnings"] = warnings

    return facture


# --------------------------------------------------------------------------
# 1. Recalage de la consommation simulee sur la facture
# --------------------------------------------------------------------------


def calibration_factors(
    profile_kwh_by_period: dict[str, float],
    facture: Facture,
) -> dict[str, float]:
    """Facteur d'echelle par poste, pour que le profil colle a la facture.

    `profile_kwh_by_period` doit couvrir la MEME duree que la facture (un mois
    type), sinon on compare des choux et des carottes.

    Un poste absent du profil (facteur indefini) reste a 1.0 : on ne fabrique
    pas de consommation la ou le profil n'en a pas.
    """
    factors: dict[str, float] = {}
    for p in PERIODS:
        simule = profile_kwh_by_period.get(p, 0.0)
        reel = facture.consommation_kwh[p]
        factors[p] = round(reel / simule, 4) if simule > 0 else 1.0
    return factors


# --------------------------------------------------------------------------
# 3. Baseline : ce que l'usine paie aujourd'hui, sur l'horizon simule
# --------------------------------------------------------------------------


def baseline_cost(
    demand_kwh_by_period: dict[str, float],
    facture: Facture,
    horizon_hours: int,
) -> dict[str, Any]:
    """Cout de reference sur l'horizon : tout est achete au reseau, sans batterie.

    C'est le point de comparaison de l'Agent Calcul. La prime de puissance est
    proratisee sur l'horizon (elle est mensuelle sur la facture).
    """
    energie = sum(demand_kwh_by_period.get(p, 0.0) * facture.prix_mad_kwh[p] for p in PERIODS)

    # La prime de puissance est due quel que soit le reequilibrage : elle depend
    # de la puissance SOUSCRITE, pas de l'energie consommee. On la proratise pour
    # que la comparaison porte sur des durees identiques.
    prorata = horizon_hours / facture.heures_facturees
    puissance = facture.montant_puissance_mad * prorata

    ht = energie + puissance
    ttc = ht * (1 + facture.tva_pct / 100)

    return {
        "horizon_hours": horizon_hours,
        "energy_kwh": {p: round(demand_kwh_by_period.get(p, 0.0), 1) for p in PERIODS},
        "energy_kwh_total": round(sum(demand_kwh_by_period.values()), 1),
        "cost_energy_mad": round(energie, 2),
        "cost_power_mad": round(puissance, 2),
        "cost_ht_mad": round(ht, 2),
        "cost_ttc_mad": round(ttc, 2),
        "tva_pct": facture.tva_pct,
        "source": f"facture {facture.reference} ({facture.periode_debut} -> {facture.periode_fin})",
        "note": (
            "Cout SANS batterie ni reequilibrage : toute la demande est achetee au "
            "reseau aux prix de la facture. Prime de puissance proratisee sur l'horizon."
        ),
    }


def facture_to_contract(facture: Facture) -> dict[str, Any]:
    """Projection de la facture pour le contrat WF2Request."""
    return {
        "reference": facture.reference,
        "periode_debut": facture.periode_debut,
        "periode_fin": facture.periode_fin,
        "jours_factures": facture.jours_factures,
        "puissance_souscrite_kva": facture.puissance_souscrite_kva,
        "prime_puissance_mad_kva_mois": facture.prime_puissance_mad_kva_mois,
        "consommation_kwh": dict(facture.consommation_kwh),
        "prix_mad_kwh": dict(facture.prix_mad_kwh),
        "montant_ht_mad": facture.montant_ht_mad,
        "montant_total_ttc_mad": facture.montant_total_ttc_mad,
    }
