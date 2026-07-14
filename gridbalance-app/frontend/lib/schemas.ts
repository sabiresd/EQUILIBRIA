/**
 * Schemas de niveau APPLICATION (enveloppes d'API exposees par le backend FastAPI).
 *
 * Les types metier vivent dans contracts/contracts.ts (source de verite) et sont
 * simplement reexportes ici. On n'invente RIEN qui existe deja la-bas.
 */
import { z } from "zod";
import {
  AlertSchema,
  BatterySchema,
  RagModeSchema,
  RoleSchema,
  RunSchema,
  ScenarioSchema,
  SeriesPointSchema,
  SiteSchema,
  TariffsSchema,
  PlanIdSchema,
} from "./contracts";

/* ------------------------------------------------------------------ auth */
export const LoginRequestSchema = z.object({
  email: z.string().email("Adresse e-mail invalide."),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caracteres."),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/* ------------------------------------------------------------- dashboard */
export const DashboardKpisSchema = z.object({
  deficit_mw: z.number(),
  soc: z.number(),
  cumulative_cost: z.number(),
  protected_violations: z.number().int(),
  last_runs: z.array(RunSchema).default([]),
  last_alerts: z.array(AlertSchema).default([]),
  main_series: z.array(SeriesPointSchema).default([]),
  windless_window: z
    .object({ start_h: z.number().int(), end_h: z.number().int() })
    .nullable()
    .optional(),
});
export type DashboardKpis = z.infer<typeof DashboardKpisSchema>;

/* ------------------------------------------------------------------- run */
export const CreateRunRequestSchema = z.object({
  site: SiteSchema,
  scenario: ScenarioSchema,
  battery: BatterySchema,
  tariffs: TariffsSchema,
  rag_mode: RagModeSchema,
});
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const CreateRunResponseSchema = z.object({
  correlation_id: z.string().uuid(),
});

export const ProposeRequestSchema = z.object({ plan_id: PlanIdSchema });

export const ValidateRequestSchema = z.object({
  plan_id: PlanIdSchema,
  /** Le commentaire est OBLIGATOIRE (tracabilite HITL). */
  comment: z.string().trim().min(1, "Le commentaire est obligatoire."),
  approve: z.boolean(),
});
export type ValidateRequest = z.infer<typeof ValidateRequestSchema>;

/* -------------------------------------------------------------- decisions */
export const VerifyResultSchema = z.object({
  valid: z.boolean(),
  expected_sha256: z.string(),
  computed_sha256: z.string(),
});
export type VerifyResult = z.infer<typeof VerifyResultSchema>;

/* ---------------------------------------------------------------- rapports */
export const ReportFrequencySchema = z.enum(["daily", "weekly"]);
export type ReportFrequency = z.infer<typeof ReportFrequencySchema>;

export const ReportSchema = z.object({
  id: z.string(),
  correlation_id: z.string().nullable().optional(),
  recipients: z.array(z.string()).default([]),
  status: z.enum(["sent", "failed", "scheduled", "pending"]),
  frequency: ReportFrequencySchema.nullable().optional(),
  error: z.string().nullable().optional(),
  created_at: z.string(),
});
export type Report = z.infer<typeof ReportSchema>;

export const SendReportRequestSchema = z.object({
  correlation_id: z.string().uuid(),
  recipients: z.array(z.string().email()).min(1, "Au moins un destinataire est requis."),
});

export const ScheduleReportRequestSchema = z.object({
  frequency: ReportFrequencySchema,
  recipients: z.array(z.string().email()).min(1, "Au moins un destinataire est requis."),
});

/* ----------------------------------------------------------------- journal */
export const AuditEntrySchema = z.object({
  id: z.string(),
  correlation_id: z.string().nullable().optional(),
  actor: z.string(),
  role: RoleSchema.nullable().optional(),
  action: z.string(),
  target: z.string().nullable().optional(),
  outcome: z.enum(["success", "failure"]).default("success"),
  detail: z.string().nullable().optional(),
  created_at: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/* ------------------------------------------------------------------- admin */
export const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: RoleSchema,
  active: z.boolean().default(true),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUserInputSchema = z.object({
  email: z.string().email("Adresse e-mail invalide."),
  name: z.string().min(1, "Le nom est obligatoire."),
  role: RoleSchema,
  active: z.boolean(),
  password: z
    .string()
    .min(8, "Le mot de passe doit contenir au moins 8 caracteres.")
    .optional()
    .or(z.literal("")),
});
export type AdminUserInput = z.infer<typeof AdminUserInputSchema>;

export const AlertThresholdsSchema = z.object({
  deficit_mw: z.number().min(0),
  soc_min: z.number().min(0).max(1),
});

export const AdminConfigSchema = z.object({
  workflows: z.object({
    WF1: z.string(),
    WF2: z.string(),
    WF3: z.string(),
    WF4: z.string(),
  }),
  smtp: z.object({
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    user: z.string(),
    from: z.string(),
    tls: z.boolean().default(true),
  }),
  thresholds: AlertThresholdsSchema,
  rules_enabled: z.object({
    deficit_threshold: z.boolean().default(true),
    soc_threshold: z.boolean().default(true),
    protected_load_violation: z.boolean().default(true),
    workflow_failure: z.boolean().default(true),
    rag_fallback: z.boolean().default(true),
  }),
});
export type AdminConfig = z.infer<typeof AdminConfigSchema>;

export const TestServiceResultSchema = z.object({
  service: z.string(),
  ok: z.boolean(),
  latency_ms: z.number().nullable().optional(),
  detail: z.string().nullable().optional(),
});
export type TestServiceResult = z.infer<typeof TestServiceResultSchema>;

/* Reexport des contrats pour n'avoir qu'un point d'import cote UI. */
export * from "./contracts";
