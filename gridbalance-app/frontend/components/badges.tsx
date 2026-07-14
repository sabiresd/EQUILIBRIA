"use client";

import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RUN_STATUS_LABELS, SCENARIO_LABELS, type AlertSeverity, type RunStatus } from "@/lib/types";
import type { Scenario } from "@/lib/contracts";

/** Statut d'un run — icone + libelle, jamais la couleur seule. */
export function RunStatusBadge({ status }: { status: RunStatus }) {
  const map = {
    pending: { variant: "neutral", Icon: Clock },
    running: { variant: "info", Icon: Loader2 },
    done: { variant: "success", Icon: CheckCircle2 },
    error: { variant: "danger", Icon: XCircle },
  } as const;

  const { variant, Icon } = map[status];

  return (
    <Badge variant={variant}>
      <Icon
        className={`h-3 w-3 ${status === "running" ? "animate-spin motion-reduce:animate-none" : ""}`}
        aria-hidden="true"
      />
      {RUN_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Severite d'alerte — icone + libelle. */
export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const map = {
    info: { variant: "info", Icon: Info, label: "Information" },
    warning: { variant: "warning", Icon: AlertTriangle, label: "Avertissement" },
    critical: { variant: "danger", Icon: XCircle, label: "Critique" },
  } as const;

  const { variant, Icon, label } = map[severity];

  return (
    <Badge variant={variant}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}

export function ScenarioBadge({ scenario }: { scenario: Scenario }) {
  return (
    <Badge variant={scenario === "windless" ? "warning" : "neutral"}>
      {SCENARIO_LABELS[scenario]}
    </Badge>
  );
}
