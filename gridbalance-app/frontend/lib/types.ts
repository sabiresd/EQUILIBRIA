/**
 * Types DERIVES des schemas Zod du contrat.
 *
 * contracts.ts exporte deja la majorite des types (`Run`, `Plan`, `User`...).
 * Ce fichier ne fait qu'inferer ceux qui manquent — il ne redefinit RIEN.
 */
import type { z } from "zod";
import type {
  ActionKindSchema,
  AlertSchema,
  HealthSchema,
  PlanIdSchema,
  RunStatusSchema,
  TariffPeriodSchema,
  WorkflowStepSchema,
} from "./contracts";

/** Reexport de commodite : un seul point d'import cote UI. */
export type { Role, Scenario, RagMode } from "./contracts";

export type PlanId = z.infer<typeof PlanIdSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type ActionKind = z.infer<typeof ActionKindSchema>;
export type TariffPeriod = z.infer<typeof TariffPeriodSchema>;
export type AlertRule = z.infer<typeof AlertSchema>["rule"];
export type AlertSeverity = z.infer<typeof AlertSchema>["severity"];
export type WorkflowId = "WF1" | "WF2" | "WF3" | "WF4";
export type WorkflowHealth = z.infer<typeof HealthSchema>["workflows"][WorkflowId];
export type ServiceStatus = "up" | "degraded" | "down";

export const WORKFLOW_IDS: WorkflowId[] = ["WF1", "WF2", "WF3", "WF4"];

/** Libelles metier des 4 workflows d'orchestration. */
export const WORKFLOW_LABELS: Record<WorkflowId, string> = {
  WF1: "Prevision production & demande",
  WF2: "Calcul du deficit & dispatch",
  WF3: "Generation des plans (RAG)",
  WF4: "Journalisation de la decision",
};

export const WORKFLOW_SHORT: Record<WorkflowId, string> = {
  WF1: "Prevision",
  WF2: "Deficit",
  WF3: "Plans",
  WF4: "Decision",
};

export const ACTION_LABELS: Record<ActionKind, string> = {
  delestage: "Delestage",
  decalage: "Decalage de charge",
  batterie: "Batterie",
  achat_reseau: "Achat reseau",
};

export const ALERT_RULE_LABELS: Record<AlertRule, string> = {
  deficit_threshold: "Deficit superieur au seuil",
  soc_threshold: "SoC batterie sous le seuil",
  protected_load_violation: "Violation de charge protegee",
  workflow_failure: "Echec d'un workflow",
  rag_fallback: "Repli RAG (preuve insuffisante)",
};

export const ALERT_RULE_DESCRIPTIONS: Record<AlertRule, string> = {
  deficit_threshold:
    "Declenchee lorsque le deficit instantane depasse le seuil configure (MW).",
  soc_threshold:
    "Declenchee lorsque l'etat de charge de la batterie passe sous le seuil configure.",
  protected_load_violation:
    "Declenchee des qu'un plan touche une charge protegee. Cible : zero violation.",
  workflow_failure:
    "Declenchee lorsqu'un des 4 agents echoue ou devient injoignable.",
  rag_fallback:
    "Declenchee lorsque le RAG ne trouve pas de preuve suffisante : validation humaine requise.",
};

export const ROLE_LABELS = {
  operator: "Operateur",
  supervisor: "Superviseur",
  admin: "Administrateur",
} as const;

export const SCENARIO_LABELS = {
  normal: "Normal",
  windless: "Journee sans vent",
} as const;

export const RAG_MODE_LABELS = {
  strict: "Strict (preuve obligatoire)",
  hybrid: "Hybride (preuve + heuristique)",
  off: "Desactive",
} as const;

export const TARIFF_PERIOD_LABELS: Record<TariffPeriod, string> = {
  creuse: "Heures creuses",
  normale: "Heures normales",
  pointe: "Heures de pointe",
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  pending: "En attente",
  running: "En cours",
  done: "Termine",
  error: "Erreur",
};
