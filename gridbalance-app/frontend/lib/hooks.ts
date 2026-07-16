"use client";

/**
 * Couche donnees SWR. Temps reel = polling toutes les 2 s (POLL_MS).
 *
 * Aucun appel direct a la plateforme : tout passe par le backend FastAPI (lib/api.ts).
 */
import useSWR, { useSWRConfig, type SWRConfiguration } from "swr";
import {
  api,
  ApiError,
  type Alarme,
  type EmsSetpoint,
  type LiveState,
  type ScadaLive,
  type Telemetrie,
} from "./api";
import type {
  Alert,
  Decision,
  Health,
  Run,
  User,
} from "./contracts";
import type { AdminConfig, AdminUser, AuditEntry, DashboardKpis, Report } from "./schemas";

/** Cadence de polling temps reel imposee : 2 secondes. */
export const POLL_MS = 2000;
/** Cadence plus lente pour les donnees peu volatiles. */
export const SLOW_POLL_MS = 15000;
/**
 * Cadence du stockage : 5 minutes.
 *
 * Une batterie n'est pas une girouette. Son SoC bouge lentement, et le
 * rafraichir toutes les 2 s ferait sauter les chiffres sans rien apprendre —
 * pire, ca donnerait l'illusion d'une instabilite qui n'existe pas. On observe
 * donc le rack au rythme auquel il change reellement.
 */
export const BATTERY_POLL_MS = 5 * 60 * 1000;

/** Ne pas reessayer indefiniment sur une erreur d'autorisation. */
const baseConfig: SWRConfiguration = {
  revalidateOnFocus: true,
  shouldRetryOnError: (err: unknown) => {
    if (err instanceof ApiError) {
      return err.kind !== "unauthorized" && err.kind !== "forbidden" && err.kind !== "not_found";
    }
    return true;
  },
  errorRetryInterval: 4000,
  errorRetryCount: 3,
};

export const KEYS = {
  me: "/api/auth/me",
  health: "/api/health",
  kpis: "/api/dashboard/kpis",
  runs: (limit: number) => `/api/runs?limit=${limit}`,
  run: (cid: string) => `/api/runs/${cid}`,
  validations: "/api/validations",
  decisions: "/api/decisions",
  decision: (id: string) => `/api/decisions/${id}`,
  alerts: "/api/alerts",
  reports: "/api/reports",
  audit: "/api/audit",
  adminUsers: "/api/admin/users",
  adminConfig: "/api/admin/config",
  scadaLive: "/api/scada/live",
  scadaEquipements: "/api/scada/equipements",
  scadaHistorique: (id: string | undefined, hours: number) =>
    `/api/scada/historique?hours=${hours}${id ? `&equipement_id=${id}` : ""}`,
  scadaAlarmes: (actives: boolean) => `/api/scada/alarmes?actives=${actives}`,
  emsConsignes: (hours: number) => `/api/ems/consignes?hours=${hours}`,
} as const;

/* --------------------------------------------------------------------- auth */

export function useMe() {
  const { data, error, isLoading, mutate } = useSWR<User, ApiError>(
    KEYS.me,
    () => api.auth.me(),
    { ...baseConfig, revalidateOnFocus: true, shouldRetryOnError: false },
  );
  return { user: data, error, isLoading, mutate };
}

/** Droits derives du role (le backend applique la regle de toute facon). */
export function usePermissions() {
  const { user } = useMe();
  const role = user?.role;
  return {
    role,
    user,
    /** operator, supervisor, admin : tous peuvent lancer une simulation. */
    canSimulate: !!role,
    /** operator : PROPOSE une selection de plan. */
    canPropose: role === "operator" || role === "supervisor" || role === "admin",
    /** supervisor (+ admin) : valide/rejette les plans (HITL), acquitte les alertes. */
    canValidate: role === "supervisor" || role === "admin",
    canAcknowledge: role === "supervisor" || role === "admin",
    /** admin : gestion utilisateurs, configuration, purge/export du journal. */
    canAdmin: role === "admin",
  };
}

/* ------------------------------------------------------------------- health */

export function useHealth() {
  const { data, error, isLoading, mutate } = useSWR<Health, ApiError>(
    KEYS.health,
    () => api.health(),
    { ...baseConfig, refreshInterval: POLL_MS },
  );
  return { health: data, error, isLoading, mutate };
}

/* ---------------------------------------------------------------- dashboard */

export function useDashboardKpis() {
  const { data, error, isLoading, mutate } = useSWR<DashboardKpis, ApiError>(
    KEYS.kpis,
    () => api.dashboard.kpis(),
    { ...baseConfig, refreshInterval: POLL_MS, keepPreviousData: true },
  );
  return { kpis: data, error, isLoading, mutate };
}

/* --------------------------------------------------------------------- live */

/** Cadence rapide pour l'horloge temps reel : 1 seconde. */
export const LIVE_POLL_MS = 1000;

/** Etat courant du reseau, rejeu accelere de Data2023 (tuile live). */
export function useLive(history = 48) {
  const { data, error, isLoading, mutate } = useSWR<LiveState, ApiError>(
    `/api/live?history=${history}`,
    () => api.live.get(history),
    { ...baseConfig, refreshInterval: LIVE_POLL_MS, keepPreviousData: true },
  );
  return { live: data, error, isLoading, mutate };
}

/* --------------------------------------------------------------------- runs */

export function useRuns(limit = 20, refresh = SLOW_POLL_MS) {
  const { data, error, isLoading, mutate } = useSWR<Run[], ApiError>(
    KEYS.runs(limit),
    () => api.runs.list(limit),
    { ...baseConfig, refreshInterval: refresh, keepPreviousData: true },
  );
  return { runs: data, error, isLoading, mutate };
}

/**
 * Suit un run. Poll toutes les 2 s TANT QUE le run n'est pas termine ;
 * on arrete le polling une fois `done`/`error` pour ne pas marteler le backend.
 */
export function useRun(cid: string | null) {
  const { data, error, isLoading, mutate } = useSWR<Run, ApiError>(
    cid ? KEYS.run(cid) : null,
    () => api.runs.get(cid as string),
    {
      ...baseConfig,
      refreshInterval: (latest?: Run) => {
        if (!latest) return POLL_MS;
        const stepsRunning = latest.steps.some(
          (s) => s.status === "running" || s.status === "pending",
        );
        return latest.status === "running" || latest.status === "pending" || stepsRunning
          ? POLL_MS
          : 0;
      },
      keepPreviousData: true,
    },
  );
  return { run: data, error, isLoading, mutate };
}

export function useValidations() {
  const { data, error, isLoading, mutate } = useSWR<Run[], ApiError>(
    KEYS.validations,
    () => api.validations.list(),
    { ...baseConfig, refreshInterval: POLL_MS, keepPreviousData: true },
  );
  return { validations: data, error, isLoading, mutate };
}

/* ---------------------------------------------------------------- decisions */

export function useDecisions() {
  const { data, error, isLoading, mutate } = useSWR<Decision[], ApiError>(
    KEYS.decisions,
    () => api.decisions.list(),
    { ...baseConfig, refreshInterval: SLOW_POLL_MS, keepPreviousData: true },
  );
  return { decisions: data, error, isLoading, mutate };
}

export function useDecision(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<Decision, ApiError>(
    id ? KEYS.decision(id) : null,
    () => api.decisions.get(id as string),
    baseConfig,
  );
  return { decision: data, error, isLoading, mutate };
}

/* ------------------------------------------------------------------- alerts */

export function useAlerts() {
  const { data, error, isLoading, mutate } = useSWR<Alert[], ApiError>(
    KEYS.alerts,
    () => api.alerts.list(),
    { ...baseConfig, refreshInterval: POLL_MS, keepPreviousData: true },
  );
  return { alerts: data, error, isLoading, mutate };
}

/* ------------------------------------------------------------------ reports */

export function useReports() {
  const { data, error, isLoading, mutate } = useSWR<Report[], ApiError>(
    KEYS.reports,
    () => api.reports.list(),
    { ...baseConfig, refreshInterval: SLOW_POLL_MS, keepPreviousData: true },
  );
  return { reports: data, error, isLoading, mutate };
}

/* -------------------------------------------------------------------- audit */

export function useAudit() {
  const { data, error, isLoading, mutate } = useSWR<AuditEntry[], ApiError>(
    KEYS.audit,
    () => api.audit.list(),
    { ...baseConfig, refreshInterval: SLOW_POLL_MS, keepPreviousData: true },
  );
  return { entries: data, error, isLoading, mutate };
}

/* -------------------------------------------------------------------- admin */

export function useAdminUsers() {
  const { data, error, isLoading, mutate } = useSWR<AdminUser[], ApiError>(
    KEYS.adminUsers,
    () => api.admin.users.list(),
    baseConfig,
  );
  return { users: data, error, isLoading, mutate };
}

export function useAdminConfig() {
  const { data, error, isLoading, mutate } = useSWR<AdminConfig, ApiError>(
    KEYS.adminConfig,
    () => api.admin.config.get(),
    baseConfig,
  );
  return { config: data, error, isLoading, mutate };
}

/* ---------------------------------------------------------------- SCADA / EMS */

/**
 * Etat courant du parc.
 *
 * `refresh` se choisit selon la grandeur observee, pas par principe : le vent
 * change en secondes (2 s), un rack de batteries en minutes (BATTERY_POLL_MS).
 */
export function useScadaLive(refresh = POLL_MS) {
  const { data, error, isLoading, mutate } = useSWR<ScadaLive, ApiError>(
    KEYS.scadaLive,
    () => api.scada.live(),
    { ...baseConfig, refreshInterval: refresh, keepPreviousData: true },
  );
  return { live: data, error, isLoading, mutate };
}

export function useScadaHistorique(equipementId?: string, hours = 48, refresh = SLOW_POLL_MS) {
  const { data, error, isLoading, mutate } = useSWR<Telemetrie[], ApiError>(
    KEYS.scadaHistorique(equipementId, hours),
    () => api.scada.historique(equipementId, hours),
    { ...baseConfig, refreshInterval: refresh, keepPreviousData: true },
  );
  return { historique: data, error, isLoading, mutate };
}

export function useScadaAlarmes(actives = false) {
  const { data, error, isLoading, mutate } = useSWR<Alarme[], ApiError>(
    KEYS.scadaAlarmes(actives),
    () => api.scada.alarmes(actives),
    { ...baseConfig, refreshInterval: SLOW_POLL_MS },
  );
  return { alarmes: data, error, isLoading, mutate };
}

export function useEmsConsignes(hours = 48, refresh = SLOW_POLL_MS) {
  const { data, error, isLoading, mutate } = useSWR<EmsSetpoint[], ApiError>(
    KEYS.emsConsignes(hours),
    () => api.ems.consignes(hours),
    { ...baseConfig, refreshInterval: refresh, keepPreviousData: true },
  );
  return { consignes: data, error, isLoading, mutate };
}

/** Invalide plusieurs cles d'un coup apres une mutation. */
export function useRevalidate() {
  const { mutate } = useSWRConfig();
  return (...keys: string[]) => keys.forEach((k) => mutate(k));
}
