/**
 * Client HTTP type du backend FastAPI.
 *
 * Regles :
 *  - le navigateur n'appelle JAMAIS la plateforme agentique directement, uniquement ce backend ;
 *  - authentification par cookies httpOnly => `credentials: "include"` partout ;
 *  - toute erreur remonte sous forme d'ApiError PORTEUSE DU correlation_id,
 *    jamais de stack trace serveur exposee a l'utilisateur ;
 *  - les reponses sont validees par Zod (contrats = source de verite).
 */
import { z } from "zod";
import {
  AlertSchema,
  DecisionSchema,
  HealthSchema,
  RunSchema,
  UserSchema,
  type Alert,
  type Decision,
  type Health,
  type Run,
  type User,
} from "./contracts";
import {
  AdminConfigSchema,
  AdminUserSchema,
  AuditEntrySchema,
  CreateRunResponseSchema,
  DashboardKpisSchema,
  ReportSchema,
  TestServiceResultSchema,
  VerifyResultSchema,
  type AdminConfig,
  type AdminUser,
  type AdminUserInput,
  type AuditEntry,
  type CreateRunRequest,
  type DashboardKpis,
  type Report,
  type ReportFrequency,
  type TestServiceResult,
  type ValidateRequest,
  type VerifyResult,
} from "./schemas";
import type { PlanId } from "./types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

/* -------------------------------------------------------------------------- */
/*                                   Erreurs                                   */
/* -------------------------------------------------------------------------- */

export type ApiErrorKind =
  | "network" // backend injoignable
  | "unauthorized" // 401
  | "forbidden" // 403 (RBAC)
  | "not_found" // 404
  | "validation" // 422 / payload invalide
  | "upstream" // 502/503/504 : un agent est injoignable => mode degrade
  | "server" // 5xx generique
  | "contract"; // la reponse ne respecte pas le contrat Zod

/**
 * Erreur applicative "presentable". Le message est toujours redige en francais
 * et destine a l'utilisateur final. La cause technique n'est jamais affichee.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly correlationId: string | null;
  /** true si l'action peut etre retentee telle quelle (mode degrade). */
  readonly retryable: boolean;

  constructor(params: {
    kind: ApiErrorKind;
    status: number;
    message: string;
    correlationId?: string | null;
    retryable?: boolean;
  }) {
    super(params.message);
    this.name = "ApiError";
    this.kind = params.kind;
    this.status = params.status;
    this.correlationId = params.correlationId ?? null;
    this.retryable = params.retryable ?? false;
  }
}

const MESSAGES: Record<ApiErrorKind, string> = {
  network:
    "Le service GridBalance est injoignable. Verifiez votre connexion, puis reessayez.",
  unauthorized: "Votre session a expire. Veuillez vous reconnecter.",
  forbidden: "Votre role ne vous autorise pas a effectuer cette action.",
  not_found: "La ressource demandee est introuvable.",
  validation: "Les donnees envoyees sont invalides. Verifiez le formulaire.",
  upstream:
    "Un workflow d'orchestration est momentanement injoignable. L'application fonctionne en mode degrade.",
  server: "Une erreur interne est survenue. L'equipe support a ete notifiee.",
  contract:
    "La reponse du serveur ne respecte pas le contrat attendu. Contactez le support.",
};

function kindFromStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "validation";
  if (status === 502 || status === 503 || status === 504) return "upstream";
  if (status >= 500) return "server";
  return "server";
}

/** Extrait un message utilisateur SUR : jamais de stack trace, jamais de HTML brut. */
function safeDetail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const detail = (body as Record<string, unknown>).detail ?? (body as Record<string, unknown>).message;
  if (typeof detail !== "string") return null;
  const trimmed = detail.trim();
  // Heuristique anti-fuite : on rejette tout ce qui ressemble a une trace/technique.
  if (
    trimmed.length === 0 ||
    trimmed.length > 240 ||
    /traceback|<[a-z!/]|\bat\s+\/|\.py["\s:]|\bline \d+|Exception\b|Error: /i.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function extractCorrelationId(res: Response, body: unknown): string | null {
  const header = res.headers.get("x-correlation-id");
  if (header) return header;
  if (body && typeof body === "object") {
    const cid = (body as Record<string, unknown>).correlation_id;
    if (typeof cid === "string") return cid;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*                                   Fetcher                                   */
/* -------------------------------------------------------------------------- */

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** correlation_id connu cote client (ex : action sur un run donne). */
  correlationId?: string | null;
  signal?: AbortSignal;
};

/** Nom du cookie CSRF pose par le backend (non-httpOnly : lisible par le JS). */
const CSRF_COOKIE = "gb_csrf";

/**
 * Lit un cookie cote navigateur. Le backend protege les mutations par
 * double-submit : le cookie `gb_csrf` doit etre reproduit dans le header
 * `X-CSRF-Token`, sinon la requete est rejetee en 403. On le relit donc a
 * chaque mutation. Retourne null cote serveur (SSR) ou si le cookie est absent.
 */
function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Note de typage : on parametre le schema par son type de SORTIE uniquement
 * (`z.ZodType<T, z.ZodTypeDef, unknown>`). Beaucoup de schemas du contrat
 * utilisent `.default(...)`, ce qui rend leur type d'ENTREE different du type de
 * sortie ; contraindre `z.ZodType<T>` (entree = sortie) les rendrait incompatibles.
 * L'entree vient du reseau : elle est `unknown` par nature.
 */
async function request<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, correlationId = null, signal } = options;

  // Mutations : le backend exige le header CSRF en miroir du cookie gb_csrf.
  const csrf = method !== "GET" ? readCookie(CSRF_COOKIE) : null;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: "include", // cookies httpOnly
      cache: "no-store",
      signal,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(correlationId ? { "X-Correlation-Id": correlationId } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError({
      kind: "network",
      status: 0,
      message: MESSAGES.network,
      correlationId,
      retryable: true,
    });
  }

  // 204 No Content
  if (res.status === 204) {
    return schema.parse(undefined as unknown as T);
  }

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null; // reponse non-JSON : on ne l'affiche jamais telle quelle
    }
  }

  if (!res.ok) {
    const kind = kindFromStatus(res.status);
    throw new ApiError({
      kind,
      status: res.status,
      message: safeDetail(payload) ?? MESSAGES[kind],
      correlationId: extractCorrelationId(res, payload) ?? correlationId,
      retryable: kind === "upstream" || kind === "network" || kind === "server",
    });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    if (process.env.NODE_ENV !== "production") {
      // Aide au dev uniquement — jamais affiche a l'utilisateur.
      // eslint-disable-next-line no-console
      console.warn(`[contract] ${path}`, parsed.error.flatten());
    }
    throw new ApiError({
      kind: "contract",
      status: res.status,
      message: MESSAGES.contract,
      correlationId: extractCorrelationId(res, payload) ?? correlationId,
    });
  }
  return parsed.data;
}

/** Telecharge un fichier (PDF / JSON / CSV) via le backend, cookies inclus. */
async function download(path: string, filename: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new ApiError({
      kind: "network",
      status: 0,
      message: MESSAGES.network,
      retryable: true,
    });
  }
  if (!res.ok) {
    const kind = kindFromStatus(res.status);
    throw new ApiError({
      kind,
      status: res.status,
      message: MESSAGES[kind],
      correlationId: res.headers.get("x-correlation-id"),
      retryable: kind === "upstream",
    });
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const Empty = z.any();

/* ------------------------------------------------------------------- live */
export const LivePointSchema = z.object({
  h_index: z.number(),
  ts_utc: z.string(),
  display_ts: z.string().nullable().optional(),
  hour_local: z.number(),
  wind_ms: z.number(),
  ghi: z.number(),
  temp_c: z.number(),
  prod_wind_mw: z.number(),
  prod_solar_mw: z.number(),
  prod_total_mw: z.number(),
  demand_mw: z.number(),
  net_balance_mw: z.number(),
  tariff_period: z.string(),
  tariff_mad_kwh: z.number(),
});
export const LiveStateSchema = z.object({
  h_index: z.number(),
  count: z.number(),
  speed: z.number(),
  paused: z.boolean(),
  display_now: z.string().nullable().optional(),
  current: LivePointSchema.nullable(),
  history: z.array(LivePointSchema),
});
export type LivePoint = z.infer<typeof LivePointSchema>;
export type LiveState = z.infer<typeof LiveStateSchema>;

/* -------------------------------------------------------------------------- */
/*                                     API                                     */
/* -------------------------------------------------------------------------- */

export const api = {
  /* ------------------------------------------------------------------ auth */
  auth: {
    login: (email: string, password: string): Promise<User> =>
      request("/api/auth/login", UserSchema, {
        method: "POST",
        body: { email, password },
      }),
    logout: (): Promise<unknown> =>
      request("/api/auth/logout", Empty, { method: "POST" }),
    refresh: (): Promise<unknown> =>
      request("/api/auth/refresh", Empty, { method: "POST" }),
    me: (): Promise<User> => request("/api/auth/me", UserSchema),
  },

  /* ---------------------------------------------------------------- health */
  health: (): Promise<Health> => request("/api/health", HealthSchema),

  /* ------------------------------------------------------------- dashboard */
  dashboard: {
    kpis: (): Promise<DashboardKpis> =>
      request("/api/dashboard/kpis", DashboardKpisSchema),
  },

  /* ------------------------------------------------------------------ live */
  live: {
    get: (history = 48): Promise<LiveState> =>
      request(`/api/live?history=${history}`, LiveStateSchema),
    control: (payload: { speed?: number; paused?: boolean }): Promise<LiveState> =>
      request("/api/live/control", LiveStateSchema, { method: "POST", body: payload }),
  },

  /* ------------------------------------------------------------------ runs */
  runs: {
    list: (limit = 20): Promise<Run[]> =>
      request(`/api/runs?limit=${limit}`, z.array(RunSchema)),
    get: (cid: string): Promise<Run> =>
      request(`/api/runs/${cid}`, RunSchema, { correlationId: cid }),
    create: (payload: CreateRunRequest): Promise<{ correlation_id: string }> =>
      request("/api/runs", CreateRunResponseSchema, {
        method: "POST",
        body: payload,
      }),
    /** Declenche WF-3 (generation des 3 plans candidats sources par RAG). */
    generatePlans: (cid: string): Promise<Run> =>
      request(`/api/runs/${cid}/plans`, RunSchema, {
        method: "POST",
        correlationId: cid,
      }),
    /** Role operator : propose un plan a la validation humaine. */
    propose: (cid: string, planId: PlanId): Promise<Run> =>
      request(`/api/runs/${cid}/propose`, RunSchema, {
        method: "POST",
        body: { plan_id: planId },
        correlationId: cid,
      }),
    /** Role supervisor : valide ou rejette (commentaire OBLIGATOIRE). */
    validate: (cid: string, payload: ValidateRequest): Promise<Run> =>
      request(`/api/runs/${cid}/validate`, RunSchema, {
        method: "POST",
        body: payload,
        correlationId: cid,
      }),
  },

  /* ----------------------------------------------------------- validations */
  validations: {
    list: (): Promise<Run[]> => request("/api/validations", z.array(RunSchema)),
  },

  /* ------------------------------------------------------------- decisions */
  decisions: {
    list: (): Promise<Decision[]> =>
      request("/api/decisions", z.array(DecisionSchema)),
    get: (id: string): Promise<Decision> =>
      request(`/api/decisions/${id}`, DecisionSchema),
    verify: (id: string): Promise<VerifyResult> =>
      request(`/api/decisions/${id}/verify`, VerifyResultSchema),
    downloadPdf: (id: string, cid: string) =>
      download(`/api/decisions/${id}/pdf`, `decision-${cid}.pdf`),
    downloadJson: (id: string, cid: string) =>
      download(`/api/decisions/${id}/json`, `decision-${cid}.json`),
  },

  /* ---------------------------------------------------------------- alerts */
  alerts: {
    list: (): Promise<Alert[]> => request("/api/alerts", z.array(AlertSchema)),
    ack: (id: string): Promise<Alert> =>
      request(`/api/alerts/${id}/ack`, AlertSchema, { method: "POST" }),
  },

  /* --------------------------------------------------------------- reports */
  reports: {
    list: (): Promise<Report[]> => request("/api/reports", z.array(ReportSchema)),
    send: (correlationId: string, recipients: string[]): Promise<Report> =>
      request("/api/reports/send", ReportSchema, {
        method: "POST",
        body: { correlation_id: correlationId, recipients },
        correlationId,
      }),
    schedule: (frequency: ReportFrequency, recipients: string[]): Promise<Report> =>
      request("/api/reports/schedule", ReportSchema, {
        method: "POST",
        body: { frequency, recipients },
      }),
  },

  /* ----------------------------------------------------------------- audit */
  audit: {
    list: (): Promise<AuditEntry[]> =>
      request("/api/audit", z.array(AuditEntrySchema)),
    exportCsv: () => download("/api/audit/export.csv", "journal-audit.csv"),
  },

  /* ----------------------------------------------------------------- admin */
  admin: {
    users: {
      list: (): Promise<AdminUser[]> =>
        request("/api/admin/users", z.array(AdminUserSchema)),
      create: (payload: AdminUserInput): Promise<AdminUser> =>
        request("/api/admin/users", AdminUserSchema, {
          method: "POST",
          body: payload,
        }),
      update: (id: string, payload: AdminUserInput): Promise<AdminUser> =>
        request(`/api/admin/users/${id}`, AdminUserSchema, {
          method: "PUT",
          body: payload,
        }),
      remove: (id: string): Promise<unknown> =>
        request(`/api/admin/users/${id}`, Empty, { method: "DELETE" }),
    },
    config: {
      get: (): Promise<AdminConfig> =>
        request("/api/admin/config", AdminConfigSchema),
      update: (payload: AdminConfig): Promise<AdminConfig> =>
        request("/api/admin/config", AdminConfigSchema, {
          method: "PUT",
          body: payload,
        }),
    },
    test: (service: string): Promise<TestServiceResult> =>
      request(`/api/admin/test/${service}`, TestServiceResultSchema, {
        method: "POST",
      }),
  },
};

/** Fetcher SWR generique : `useSWR("/api/alerts", ...)` n'est pas utilise ici,
 *  on passe directement les fonctions `api.*` en fetcher pour rester type. */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/** Message utilisateur + correlation_id, pret a afficher. */
export function errorMessage(err: unknown): string {
  if (isApiError(err)) return err.message;
  return MESSAGES.server;
}

export function errorCorrelationId(err: unknown): string | null {
  return isApiError(err) ? err.correlationId : null;
}
