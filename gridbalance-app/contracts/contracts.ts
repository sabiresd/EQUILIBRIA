/**
 * Contrats d'echange GridBalance AI Morocco — schemas Zod (frontend).
 *
 * Source de verite : contracts/schemas.json. Le pendant Python est contracts.py.
 * Toute evolution du contrat se fait dans schemas.json, puis ici ET dans contracts.py.
 */
import { z } from "zod";

export const DISCLAIMER =
  "Prototype de simulation et d'aide à la décision. Non connecté aux systèmes de l'ONEE. " +
  "Aucun équipement réel n'est piloté. Tarifs affichés à titre de démonstration, non officiels ANRE.";

export const ScenarioSchema = z.enum(["normal", "windless"]);
export const RagModeSchema = z.enum(["strict", "hybrid", "off"]);
export const PlanIdSchema = z.enum(["A", "B", "C"]);
export const TariffPeriodSchema = z.enum(["creuse", "normale", "pointe"]);
export const ActionKindSchema = z.enum(["delestage", "decalage", "batterie", "achat_reseau"]);

export const SiteSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  name: z.string().optional(),
});

/* ------------------------------------------------------------------ WF-1 */
export const SeriesPointSchema = z.object({
  h: z.number().int().min(0).max(359),
  wind_ms: z.number().min(0),
  ghi: z.number().min(0),
  prod_wind_mw: z.number().min(0),
  prod_solar_mw: z.number().min(0),
  demand_mw: z.number().min(0),
});

export const WF1RequestSchema = z.object({
  correlation_id: z.string().uuid(),
  site: SiteSchema,
  horizon_hours: z.literal(360),
  scenario: ScenarioSchema,
});

export const WF1ResponseSchema = z.object({
  series: z.array(SeriesPointSchema).min(1),
});

/* ------------------------------------------------------------------ WF-2 */
export const BatterySchema = z.object({
  capacity_mwh: z.number().positive(),
  p_max_mw: z.number().positive(),
  soc_min: z.number().min(0).max(1),
  efficiency: z.number().positive().max(1),
  degradation_cost_mwh: z.number().min(0).default(45),
});

/** MAD/MWh. Valeurs de DÉMONSTRATION, non officielles ANRE. */
export const TariffsSchema = z.object({
  creuse: z.number().min(0),
  normale: z.number().min(0),
  pointe: z.number().min(0),
});

/**
 * Heure locale du point h : (h + start_hour_local) % 24.
 * Une série envoyée à 15 h porte start_hour_local = 15. Par défaut 0 (minuit).
 */
export const StartHourLocalSchema = z.number().int().min(0).max(23).default(0);

/** Énergie (kWh) ventilée par période tarifaire. */
export const PeriodKwhSchema = z.object({
  creuse: z.number().min(0),
  normale: z.number().min(0),
  pointe: z.number().min(0),
});

/** Facture ONEE Moyenne Tension du site. Valeurs de DÉMONSTRATION. */
export const FactureSchema = z.object({
  reference: z.string(),
  periode_debut: z.string(),
  periode_fin: z.string(),
  jours_factures: z.number().int().min(1),
  puissance_souscrite_kva: z.number().min(0),
  prime_puissance_mad_kva_mois: z.number().min(0),
  consommation_kwh: PeriodKwhSchema,
  prix_mad_kwh: PeriodKwhSchema,
  montant_ht_mad: z.number().min(0).nullable().optional(),
  montant_total_ttc_mad: z.number().min(0).nullable().optional(),
});

/**
 * Coût de référence sur l'horizon, SANS batterie ni rééquilibrage : toute la
 * demande est achetée au réseau aux prix de la facture. C'est ce que le site
 * paie aujourd'hui, et donc le point de comparaison de l'économie annoncée.
 */
export const BaselineSchema = z.object({
  horizon_hours: z.number().int().min(1),
  energy_kwh: PeriodKwhSchema.nullable().optional(),
  energy_kwh_total: z.number().min(0),
  cost_energy_mad: z.number().min(0).nullable().optional(),
  cost_power_mad: z.number().min(0).nullable().optional(),
  cost_ht_mad: z.number().min(0),
  cost_ttc_mad: z.number().min(0).nullable().optional(),
  tva_pct: z.number().min(0).nullable().optional(),
  source: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const HourlyPointSchema = z.object({
  h: z.number().int(),
  deficit_mw: z.number().min(0),
  soc: z.number().min(0).max(1),
  dispatch_mw: z.number(), // > 0 décharge, < 0 charge
  cost: z.number().min(0),
  grid_mw: z.number().min(0).default(0),
  tariff_period: TariffPeriodSchema.default("normale"),
});

export const WF2TotalsSchema = z.object({
  total_cost: z.number(),
  total_deficit_mwh: z.number(),
  hours_in_deficit: z.number().int(),
  share_battery: z.number().default(0),
  share_grid: z.number().default(0),
  share_production: z.number().default(0),
  protected_load_violations: z.number().int().default(0),
});

export const WF2ResponseSchema = z.object({
  hourly: z.array(HourlyPointSchema),
  totals: WF2TotalsSchema,
});

/* ------------------------------------------------------------------ WF-3 */
export const ProtectedLoadSchema = z.object({
  id: z.string(),
  label: z.string(),
  criticality: z.enum(["critical", "high", "medium", "low"]).default("high"),
  locked: z.boolean().default(true),
});

export const DeficitSummarySchema = z.object({
  total_deficit_mwh: z.number(),
  hours_in_deficit: z.number().int(),
  peak_deficit_mw: z.number(),
  windless_window: z
    .object({ start_h: z.number().int(), end_h: z.number().int() })
    .nullable()
    .optional(),
});

export const CitationSchema = z.object({
  doc: z.string(),
  page: z.number().int().min(1),
  extrait: z.string(),
  score: z.number().min(0).max(1).nullable().optional(),
});

export const PlanActionSchema = z.object({
  site: z.string(),
  action: ActionKindSchema,
  delta_mw: z.number(),
  hours: z.array(z.number().int()),
  justification: z.string().nullable().optional(),
});

export const PlanSchema = z.object({
  id: PlanIdSchema,
  label: z.string().nullable().optional(),
  actions: z.array(PlanActionSchema),
  citations: z.array(CitationSchema),
  fairness_score: z.number().min(0).max(1),
  estimated_cost: z.number().default(0),
  covered_deficit_mwh: z.number().default(0),
  protected_loads_respected: z.boolean().default(true),
});

export const WF3ResponseSchema = z.object({
  plans: z.array(PlanSchema).min(1).max(3),
  rag_fallback: z.boolean().default(false),
  human_validation_required: z.boolean().default(false),
});

/* ------------------------------------------------------------------ WF-4 */
export const DecisionCardSchema = z.object({
  correlation_id: z.string().uuid(),
  plan_id: PlanIdSchema,
  actions: z.array(PlanActionSchema),
  citations: z.array(CitationSchema).default([]),
  deficit_summary: DeficitSummarySchema.nullable().optional(),
  fairness_score: z.number().default(0),
  rag_fallback: z.boolean().default(false),
  proposed_by: z.string(),
  validated_by: z.string(),
  validated_at: z.string(),
  comment: z.string().min(1),
  disclaimer: z.string().default(DISCLAIMER),
});

export const WF4ResponseSchema = z.object({
  logged: z.boolean(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mongo_id: z.string().nullable().optional(),
  notified: z
    .object({ slack: z.boolean().default(false), email: z.boolean().default(false) })
    .default({ slack: false, email: false }),
});

/* --------------------------------------------------------------- app-level */
export const RoleSchema = z.enum(["operator", "supervisor", "admin"]);

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: RoleSchema,
  active: z.boolean().default(true),
});

export const RunStatusSchema = z.enum(["pending", "running", "done", "error"]);

export const WorkflowStepSchema = z.object({
  workflow: z.enum(["WF1", "WF2", "WF3", "WF4"]),
  status: RunStatusSchema,
  duration_ms: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
});

export const RunSchema = z.object({
  correlation_id: z.string().uuid(),
  status: RunStatusSchema,
  scenario: ScenarioSchema,
  created_at: z.string(),
  created_by: z.string(),
  // Les paramètres d'entrée du run sont renvoyés par le backend : ils font partie
  // du run, pas de l'état du navigateur. La comparaison naïf vs look-ahead s'appuie
  // dessus — les stocker côté client les ferait diverger du calcul réel.
  site: SiteSchema.nullable().optional(),
  battery: BatterySchema.nullable().optional(),
  tariffs: TariffsSchema.nullable().optional(),
  rag_mode: RagModeSchema.nullable().optional(),
  steps: z.array(WorkflowStepSchema).default([]),
  series: z.array(SeriesPointSchema).nullable().optional(),
  hourly: z.array(HourlyPointSchema).nullable().optional(),
  totals: WF2TotalsSchema.nullable().optional(),
  deficit_summary: DeficitSummarySchema.nullable().optional(),
  plans: z.array(PlanSchema).nullable().optional(),
  rag_fallback: z.boolean().default(false),
  proposed_plan_id: PlanIdSchema.nullable().optional(),
  proposed_by: z.string().nullable().optional(),
  decision_id: z.string().nullable().optional(),
});

export const DecisionSchema = z.object({
  id: z.string(),
  correlation_id: z.string().uuid(),
  card: DecisionCardSchema,
  sha256: z.string(),
  mongo_id: z.string().nullable().optional(),
  notified: z.object({ slack: z.boolean(), email: z.boolean() }),
  created_at: z.string(),
});

export const AlertSchema = z.object({
  id: z.string(),
  rule: z.enum([
    "deficit_threshold",
    "soc_threshold",
    "protected_load_violation",
    "workflow_failure",
    "rag_fallback",
  ]),
  severity: z.enum(["info", "warning", "critical"]),
  message: z.string(),
  correlation_id: z.string().nullable().optional(),
  created_at: z.string(),
  acknowledged_by: z.string().nullable().optional(),
  acknowledged_at: z.string().nullable().optional(),
});

export const HealthSchema = z.object({
  workflows: z.record(
    z.enum(["WF1", "WF2", "WF3", "WF4"]),
    z.object({
      status: z.enum(["up", "degraded", "down"]),
      latency_ms: z.number().nullable(),
      mode: z.enum(["stub", "live"]),
    }),
  ),
  mongo: z.enum(["up", "down"]),
  smtp: z.enum(["up", "down"]),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
export type RagMode = z.infer<typeof RagModeSchema>;
export type SeriesPoint = z.infer<typeof SeriesPointSchema>;
export type HourlyPoint = z.infer<typeof HourlyPointSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type PlanAction = z.infer<typeof PlanActionSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type DecisionCard = z.infer<typeof DecisionCardSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Alert = z.infer<typeof AlertSchema>;
export type User = z.infer<typeof UserSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Health = z.infer<typeof HealthSchema>;
export type Battery = z.infer<typeof BatterySchema>;
export type Tariffs = z.infer<typeof TariffsSchema>;
export type PeriodKwh = z.infer<typeof PeriodKwhSchema>;
export type Facture = z.infer<typeof FactureSchema>;
export type Baseline = z.infer<typeof BaselineSchema>;
export type ProtectedLoad = z.infer<typeof ProtectedLoadSchema>;
export type DeficitSummary = z.infer<typeof DeficitSummarySchema>;
export type WF2Totals = z.infer<typeof WF2TotalsSchema>;
