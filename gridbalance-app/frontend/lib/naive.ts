/**
 * Reference NAIVE, calculee cote client pour la comparaison "naif vs look-ahead".
 *
 * Le contrat ne transporte PAS de serie naive : WF-2 ne renvoie que le dispatch
 * optimise (look-ahead). On reconstruit donc la strategie de reference a partir
 * des memes entrees (series + parametres batterie + tarifs), afin de rendre la
 * comparaison honnete et reproductible.
 *
 * Strategie naive (gloutonne, sans anticipation) :
 *   - des qu'un deficit apparait, on decharge la batterie au maximum possible ;
 *   - le reliquat est achete au reseau au tarif de l'heure courante ;
 *   - tout surplus de production recharge la batterie (dans la limite de P_max).
 * Elle ignore les heures de pointe a venir : c'est precisement ce que le
 * look-ahead de WF-2 sait eviter.
 */
import type { Battery, HourlyPoint, SeriesPoint, Tariffs } from "./contracts";
import type { ComparisonPoint } from "@/components/charts";

export type NaiveResult = {
  points: ComparisonPoint[];
  naive_total: number;
  lookahead_total: number;
  /** Economie absolue (MAD) apportee par le look-ahead. Peut etre negative. */
  savings: number;
  /** Economie relative (0..1). */
  savings_ratio: number;
};

export function computeNaiveComparison(
  series: SeriesPoint[],
  hourly: HourlyPoint[],
  battery: Battery,
  tariffs: Tariffs,
): NaiveResult {
  const byHour = new Map<number, HourlyPoint>();
  hourly.forEach((p) => byHour.set(p.h, p));

  const capacity = battery.capacity_mwh;
  const socMin = battery.soc_min;
  const pMax = battery.p_max_mw;
  const eff = battery.efficiency;
  const degradation = battery.degradation_cost_mwh ?? 45;

  // On demarre au meme etat de charge que le dispatch optimise, sinon la
  // comparaison serait biaisee des la premiere heure.
  let soc = hourly.length ? hourly[0].soc : 1;

  let naiveCum = 0;
  let lookaheadCum = 0;
  const points: ComparisonPoint[] = [];

  for (const point of series) {
    const h = point.h;
    const lookaheadPoint = byHour.get(h);

    const prod = point.prod_wind_mw + point.prod_solar_mw;
    const net = prod - point.demand_mw;

    let hourCost = 0;

    if (net < 0) {
      // Deficit : on vide la batterie sans reflechir a la suite.
      const deficit = -net;
      const energyAvailable = Math.max(0, (soc - socMin) * capacity);
      const discharge = Math.min(deficit, pMax, energyAvailable);

      soc -= discharge / capacity;
      hourCost += discharge * degradation;

      const fromGrid = deficit - discharge;
      if (fromGrid > 0) {
        const period = lookaheadPoint?.tariff_period ?? "normale";
        hourCost += fromGrid * tariffs[period];
      }
    } else if (net > 0) {
      // Surplus : on recharge, pertes de conversion incluses.
      const headroom = Math.max(0, (1 - soc) * capacity);
      const charge = Math.min(net, pMax, headroom / Math.max(eff, 0.01));
      soc += (charge * eff) / capacity;
    }

    soc = Math.min(1, Math.max(0, soc));

    naiveCum += hourCost;
    lookaheadCum += lookaheadPoint?.cost ?? 0;

    points.push({
      h,
      naive_cost: Math.round(naiveCum),
      lookahead_cost: Math.round(lookaheadCum),
    });
  }

  const savings = naiveCum - lookaheadCum;
  return {
    points,
    naive_total: naiveCum,
    lookahead_total: lookaheadCum,
    savings,
    savings_ratio: naiveCum > 0 ? savings / naiveCum : 0,
  };
}
