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

/** Chrome du graphique : grille et axes en filet, recessifs. Mode SOMBRE. */
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

/**
 * Chrome en mode CLAIR. Seul le chrome change : les couleurs de SERIES restent
 * identiques. Elles ont ete validees dans une bande de luminosite moyenne
 * (L 0.48–0.67), donc elles gardent >= 3:1 sur blanc comme sur #071627 — c'est
 * precisement l'interet de cette bande, et la couleur reste liee a l'entite.
 */
export const CHART_LIGHT = {
  surface: "#ffffff",
  grid: "rgba(15,30,55,0.10)",
  axis: "rgba(15,30,55,0.22)",
  tick: "#5b6b82",
  ink: "#0f1e37",
  muted: "#5b6b82",
  windlessFill: "rgba(202, 138, 4, 0.12)",
  windlessStroke: "rgba(161, 98, 7, 0.50)",
  cursor: "rgba(15,30,55,0.28)",
} as const;

/** Memes clefs que CHART, mais valeurs elargies : les deux chromes coexistent
 *  (`as const` figerait chaque couleur en type litteral). */
export type ChartChrome = Record<keyof typeof CHART, string>;

/** Proprietes d'axe derivees du chrome courant (clair ou sombre). */
export function axisProps(chrome: ChartChrome = CHART) {
  return {
    stroke: chrome.axis,
    tick: { fill: chrome.tick, fontSize: 11 },
    tickLine: false,
    axisLine: { stroke: chrome.axis },
  } as const;
}

/** Ticks toutes les 24 h sur l'horizon de 360 h (15 jours). */
export function dayTicks(maxHour = 359, step = 24): number[] {
  const ticks: number[] = [];
  for (let h = 0; h <= maxHour; h += step) ticks.push(h);
  return ticks;
}
