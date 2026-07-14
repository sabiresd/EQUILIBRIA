/**
 * Theme des graphiques — palette VALIDEE (scripts/validate_palette.js).
 *
 * Surface de rendu : #071627 (base-800, fond des cartes) sur page #040e1b.
 * Verifications sur cette surface, mode sombre :
 *   - bande de luminosite  : OK (L 0.48–0.67 pour les 6 slots)
 *   - plancher de chroma   : OK
 *   - separation daltonisme: OK — pire paire adjacente ΔE 35.8 (protan), tres au-dessus du seuil de 12
 *   - contraste vs surface : OK (>= 3:1 pour les 6 slots)
 *
 * REGLE : la couleur suit l'ENTITE, jamais son rang. Un filtre qui retire une
 * serie ne repeint jamais les survivantes.
 */

/** Slots categoriels, dans l'ordre fixe valide. Ne JAMAIS cycler au-dela. */
export const SERIES = {
  vent: "#3987e5", // slot 1 — bleu
  solaire: "#c98500", // slot 2 — ambre
  batterie: "#12a56c", // slot 3 — emeraude (marque)
  demande: "#9085e9", // slot 4 — violet
  reseau: "#d55181", // slot 5 — magenta
  cout: "#d95926", // slot 6 — orange
} as const;

/**
 * Couleurs de STATUT — reservees. Elles signifient bon/mauvais, jamais une
 * identite de serie. Toujours accompagnees d'une icone ou d'un libelle.
 */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

/** Le deficit est une grandeur NEGATIVE par nature => couleur de statut. */
export const DEFICIT_COLOR = STATUS.critical;

/** Chrome du graphique : grille et axes en filet, recessifs. */
export const CHART = {
  surface: "#071627",
  grid: "rgba(255,255,255,0.06)",
  axis: "rgba(255,255,255,0.14)",
  tick: "#94a3b8",
  ink: "#e2e8f0",
  muted: "#94a3b8",
  /** Zone de la fenetre SANS VENT (ReferenceArea) — ambre discret. */
  windlessFill: "rgba(250, 178, 25, 0.10)",
  windlessStroke: "rgba(250, 178, 25, 0.45)",
  cursor: "rgba(255,255,255,0.22)",
} as const;

export const AXIS_PROPS = {
  stroke: CHART.axis,
  tick: { fill: CHART.tick, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: CHART.axis },
} as const;

/** Ticks toutes les 24 h sur l'horizon de 360 h (15 jours). */
export function dayTicks(maxHour = 359, step = 24): number[] {
  const ticks: number[] = [];
  for (let h = 0; h <= maxHour; h += step) ticks.push(h);
  return ticks;
}
