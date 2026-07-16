"""Simulateurs internes des 4 agents (WF_MODE=stub).

Ils produisent des donnees REALISTES conformes aux contrats, pour que la demo tourne
sans dependre de la plateforme agentique. Les valeurs sont deterministes (seed derive du
correlation_id) : deux runs identiques donnent le meme resultat, ce qui rend la demo
reproductible et les tests stables.

Aucune donnee reelle ONEE/ANRE. Tarifs en MAD/MWh, valeurs de DEMONSTRATION.
"""
from __future__ import annotations

import math
import random
from uuid import UUID

from app.services import gridbalance_engine as engine
from contracts.contracts import (
    Citation,
    DeficitSummary,
    HourlyPoint,
    Plan,
    PlanAction,
    SeriesPoint,
    WF1Request,
    WF1Response,
    WF2Request,
    WF2Response,
    WF2Totals,
    WF3Request,
    WF3Response,
    WF4Request,
    WF4Response,
    WindlessWindow,
    sha256_card,
)

HORIZON = 360
# Fenetre sans vent : ~120 h au milieu de l'horizon (jours 6 a 11).
WINDLESS_START, WINDLESS_END = 120, 240

# Parc du site (demo)
WIND_CAPACITY_MW = 12.0
SOLAR_CAPACITY_MW = 8.0


def _rng(correlation_id: UUID) -> random.Random:
    return random.Random(correlation_id.int & 0xFFFFFFFF)


def _tariff_period(h: int, start_hour_local: int = 0) -> str:
    """Periode tarifaire du point h.

    L'heure locale n'est PAS h % 24 : elle depend de l'heure a laquelle la serie
    commence. Une serie envoyee a 15 h porte start_hour_local=15, et son point
    h=3 tombe donc a 18 h — en pointe, pas a 3 h du matin.

    Periodes de demonstration, alignees sur la facture ONEE (18 h -> 22 h en pointe).
    """
    hod = (h + start_hour_local) % 24
    if hod < 6 or hod >= 22:
        return "creuse"
    if 18 <= hod < 22:
        return "pointe"
    return "normale"


def _demand(h: int, rng: random.Random) -> float:
    """Profil industriel : creux nocturne, plateau diurne, pointe du soir."""
    hod = h % 24
    if hod < 6:
        base = 6.0
    elif hod < 8:
        base = 10.0
    elif hod < 18:
        base = 15.0
    elif hod < 22:
        base = 11.0
    else:
        base = 7.0
    if (h // 24) % 7 in (5, 6):  # week-end
        base *= 0.5
    return round(base * rng.uniform(0.97, 1.03), 3)


def _ghi(h: int, rng: random.Random) -> float:
    """Irradiance globale horizontale : cloche diurne, pic ~850 W/m2 a midi."""
    hod = h % 24
    if hod < 7 or hod > 19:
        return 0.0
    x = (hod - 7) / 12.0  # 0 -> 1 sur la journee
    return round(850.0 * math.sin(math.pi * x) * rng.uniform(0.85, 1.0), 1)


CUT_IN, RATED, CUT_OUT = 3.0, 12.0, 25.0


def _wind_ms(h: int, scenario: str, rng: random.Random) -> float:
    if scenario == "windless" and WINDLESS_START <= h < WINDLESS_END:
        # L'evenement : le vent s'effondre entre 2 et 4 m/s, sous le seuil de
        # demarrage utile des eoliennes.
        return round(rng.uniform(2.0, 4.0), 2)
    return round(rng.uniform(7.0, 13.0), 2)


def _wind_power(wind_ms: float) -> float:
    """Courbe de puissance : cut-in 3 m/s, nominal 12 m/s, cut-out 25 m/s.

    On interpole en CUBE DES VITESSES (v^3 - vin^3) / (vrated^3 - vin^3), la forme
    physique reelle. Une interpolation cubique de l'ecart normalise, elle, sous-estime
    grossierement le regime intermediaire (3 % du nominal a 6 m/s au lieu de ~11 %),
    ce qui affamerait le site meme les jours ventes et rendrait la fenetre sans vent
    indiscernable du reste de l'horizon.
    """
    if wind_ms < CUT_IN or wind_ms > CUT_OUT:
        return 0.0
    if wind_ms >= RATED:
        return WIND_CAPACITY_MW
    ratio = (wind_ms**3 - CUT_IN**3) / (RATED**3 - CUT_IN**3)
    return round(WIND_CAPACITY_MW * ratio, 3)


def wf1(req: WF1Request) -> WF1Response:
    """Agent Simulateur : donnees NASA 2023 reelles + facture ONEE.

    Delegue au moteur deterministe (formules eoliennes (6)-(8), recalage de la
    demande sur la facture, tarifs et plafond reseau issus de la facture). Le
    payload complet est mis en cache pour que l'orchestrateur construise le
    WF2Request et enrichisse le run affiche au dashboard.

    anchor="now" : la serie demarre a l'heure REELLE (temps reel), sauf scenario
    de demonstration explicite.
    """
    anchor = "random" if req.scenario in ("windless", "sans_vent") else "now"
    payload = engine.simulate(
        mode="window",
        hours=req.horizon_hours,
        anchor=anchor,
        correlation_id=str(req.correlation_id),
    )
    engine.stash_payload(str(req.correlation_id), payload)
    return WF1Response(series=[SeriesPoint(**p) for p in payload["series"]])


def wf2(req: WF2Request) -> WF2Response:
    """Agent Calcul : dispatch batterie deterministe sur 360 h.

    Delegue au moteur (meme code que le noeud Python d'ABA Fusion). La periode
    tarifaire suit start_hour_local ; le deficit apparait quand le soutirage
    depasse grid_cap_mw (la puissance souscrite de la facture).
    """
    result = engine.compute(
        {
            "correlation_id": str(req.correlation_id),
            "series": [p.model_dump() for p in req.series],
            "battery": req.battery.model_dump(),
            "tariffs": req.tariffs.model_dump(),
            "start_hour_local": req.start_hour_local,
            "grid_cap_mw": req.grid_cap_mw,
            "baseline": req.baseline.model_dump() if req.baseline else None,
        }
    )
    return WF2Response(
        hourly=[HourlyPoint(**h) for h in result["hourly"]],
        totals=WF2Totals(**result["totals"]),
    )


def _wf2_legacy(req: WF2Request) -> WF2Response:
    """Ancien dispatch synthetique, conserve pour reference (non appele)."""
    bat = req.battery
    soc_mwh = bat.capacity_mwh * 0.8  # etat de charge initial
    floor_mwh = bat.capacity_mwh * bat.soc_min

    hourly: list[HourlyPoint] = []
    cost_total = 0.0
    e_prod = e_bat = e_grid = e_def = 0.0
    hours_deficit = 0

    for p in req.series:
        prod = p.prod_wind_mw + p.prod_solar_mw
        served_prod = min(prod, p.demand_mw)
        surplus = max(0.0, prod - p.demand_mw)
        need = p.demand_mw - served_prod

        # Le surplus recharge la batterie (rendement applique a la charge).
        charge = min(surplus, bat.p_max_mw, bat.capacity_mwh - soc_mwh)
        soc_mwh = min(bat.capacity_mwh, soc_mwh + charge * bat.efficiency)

        period = _tariff_period(p.h, req.start_hour_local)
        tariff = getattr(req.tariffs, period)

        # La batterie ne se decharge que si son cout d'usure est inferieur au tarif
        # du reseau, et jamais sous le SoC minimal.
        available = max(0.0, soc_mwh - floor_mwh)
        discharge = 0.0
        if need > 0 and bat.degradation_cost_mwh < tariff:
            discharge = min(need, bat.p_max_mw, available)
            soc_mwh -= discharge

        grid = max(0.0, need - discharge)
        deficit = 0.0  # le reseau absorbe le reste dans ce modele de demo

        hour_cost = discharge * bat.degradation_cost_mwh + grid * tariff
        cost_total += hour_cost

        # Un deficit apparait quand ni la production, ni la batterie ne repondent et
        # que le besoin depasse ce que le site a le droit de soutirer au reseau.
        # Ce plafond est sa PUISSANCE SOUSCRITE (lue sur la facture) : au-dela, il
        # est en depassement, lourdement penalise. 12 MW = ancien defaut de demo,
        # conserve pour les runs qui ne fournissent pas de facture.
        grid_cap = req.grid_cap_mw if req.grid_cap_mw is not None else 12.0
        if grid > grid_cap:
            deficit = round(grid - grid_cap, 3)
            grid = grid_cap
            hours_deficit += 1

        e_prod += served_prod
        e_bat += discharge
        e_grid += grid
        e_def += deficit

        hourly.append(
            HourlyPoint(
                h=p.h,
                deficit_mw=round(deficit, 3),
                soc=round(soc_mwh / bat.capacity_mwh, 4),
                dispatch_mw=round(discharge - charge, 3),
                cost=round(hour_cost, 2),
                grid_mw=round(grid, 3),
                tariff_period=period,  # type: ignore[arg-type]
            )
        )

    total = e_prod + e_bat + e_grid + e_def or 1.0
    return WF2Response(
        hourly=hourly,
        totals=WF2Totals(
            total_cost=round(cost_total, 2),
            total_deficit_mwh=round(e_def, 3),
            hours_in_deficit=hours_deficit,
            share_battery=round(e_bat / total, 4),
            share_grid=round(e_grid / total, 4),
            share_production=round(e_prod / total, 4),
            protected_load_violations=0,
        ),
    )


CORPUS = [
    Citation(
        doc="Reglement interne de delestage — demo",
        page=3,
        extrait=(
            "Les etablissements de sante sont classes en infrastructure critique. "
            "Leur delestage est interdit en toutes circonstances."
        ),
        score=0.97,
    ),
    Citation(
        doc="Charte d'equite entre sites — demo",
        page=7,
        extrait=(
            "Un site ayant subi un delestage au cours des 24 heures glissantes est "
            "exclu du tour suivant tant qu'un site de meme priorite n'a pas ete sollicite."
        ),
        score=0.94,
    ),
    Citation(
        doc="Grille de priorites de charge — demo",
        page=2,
        extrait=(
            "Ordre de delestage : confort, eclairage non essentiel, tertiaire, "
            "industrie a process continu, eau, sante."
        ),
        score=0.91,
    ),
    Citation(
        doc="Note tarifaire de demonstration",
        page=1,
        extrait=(
            "A priorite egale, delester en premier le site dont le cout evite par MWh "
            "est le plus eleve. Valeurs de demonstration, non officielles ANRE."
        ),
        score=0.88,
    ),
]


def wf3(req: WF3Request) -> WF3Response:
    """3 plans candidats aux arbitrages differents.

    A = le moins cher, B = le plus equitable, C = equilibre.
    L'hopital (charge protegee verrouillee) n'est JAMAIS deleste, dans aucun plan.
    """
    ds = req.deficit_summary
    hours = list(range(WINDLESS_START, min(WINDLESS_START + 12, WINDLESS_END)))
    if ds.windless_window:
        hours = list(range(ds.windless_window.start_h, ds.windless_window.start_h + 12))

    delestables = [pl for pl in req.protected_loads if not pl.locked] or [
        pl for pl in req.protected_loads if pl.criticality in ("medium", "low")
    ]
    names = [pl.label for pl in delestables] or ["Site tertiaire B", "Site industriel C"]
    peak = max(ds.peak_deficit_mw, 1.0)

    plans = [
        Plan(
            id="A",
            label="Moins-disant economique",
            actions=[
                PlanAction(
                    site=names[0],
                    action="delestage",
                    delta_mw=round(peak * 0.7, 2),
                    hours=hours,
                    justification=(
                        "Site au cout evite par MWh le plus eleve : le delestage y "
                        "minimise la facture globale."
                    ),
                ),
                PlanAction(
                    site="Batterie centrale",
                    action="batterie",
                    delta_mw=round(peak * 0.3, 2),
                    hours=hours[:6],
                    justification="Decharge concentree sur les heures de pointe.",
                ),
            ],
            citations=[CORPUS[3], CORPUS[0]],
            fairness_score=0.42,
            estimated_cost=round(peak * 1400, 2),
            covered_deficit_mwh=round(ds.total_deficit_mwh * 0.95, 2),
            protected_loads_respected=True,
        ),
        Plan(
            id="B",
            label="Equite maximale",
            actions=[
                PlanAction(
                    site=n,
                    action="delestage",
                    delta_mw=round(peak / max(len(names), 1), 2),
                    hours=hours[i * 3 : i * 3 + 6] or hours[:6],
                    justification=(
                        "Rotation equitable : effort reparti entre les sites de meme "
                        "priorite, aucun site penalise deux fois de suite."
                    ),
                )
                for i, n in enumerate(names)
            ],
            citations=[CORPUS[1], CORPUS[0], CORPUS[2]],
            fairness_score=0.93,
            estimated_cost=round(peak * 1750, 2),
            covered_deficit_mwh=round(ds.total_deficit_mwh * 0.92, 2),
            protected_loads_respected=True,
        ),
        Plan(
            id="C",
            label="Equilibre cout / equite",
            actions=[
                PlanAction(
                    site=names[0],
                    action="decalage",
                    delta_mw=round(peak * 0.4, 2),
                    hours=hours,
                    justification="Decalage de charge plutot que coupure seche.",
                ),
                PlanAction(
                    site=names[-1],
                    action="delestage",
                    delta_mw=round(peak * 0.35, 2),
                    hours=hours[6:],
                    justification="Delestage partiel, plafonne a 2 heures consecutives.",
                ),
                PlanAction(
                    site="Reseau",
                    action="achat_reseau",
                    delta_mw=round(peak * 0.25, 2),
                    hours=hours,
                    justification="Complement achete en heures normales.",
                ),
            ],
            citations=[CORPUS[2], CORPUS[1], CORPUS[0]],
            fairness_score=0.71,
            estimated_cost=round(peak * 1580, 2),
            covered_deficit_mwh=round(ds.total_deficit_mwh * 0.97, 2),
            protected_loads_respected=True,
        ),
    ]

    # rag_mode="off" simule l'indisponibilite du corpus : preuve insuffisante.
    fallback = req.rag_mode == "off"
    if fallback:
        for p in plans:
            p.citations = []
    return WF3Response(
        plans=plans,
        rag_fallback=fallback,
        human_validation_required=True,  # HITL : toujours, par conception
    )


def wf4(req: WF4Request) -> WF4Response:
    digest = sha256_card(req.decision_card)
    return WF4Response(
        logged=True,
        sha256=digest,
        mongo_id=f"stub-{digest[:12]}",
        notified={"slack": False, "email": True},  # type: ignore[arg-type]
    )


def deficit_summary_from(hourly: list[HourlyPoint], totals: WF2Totals) -> DeficitSummary:
    peak = max((p.deficit_mw for p in hourly), default=0.0)
    deficit_hours = [p.h for p in hourly if p.deficit_mw > 0]
    window = None
    if deficit_hours:
        window = WindlessWindow(start_h=min(deficit_hours), end_h=max(deficit_hours))
    return DeficitSummary(
        total_deficit_mwh=totals.total_deficit_mwh,
        hours_in_deficit=totals.hours_in_deficit,
        peak_deficit_mw=round(peak, 3),
        windless_window=window,
    )
