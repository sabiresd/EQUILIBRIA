"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useHealth } from "@/lib/hooks";
import { fmtMs, cn } from "@/lib/utils";
import {
  WORKFLOW_IDS,
  WORKFLOW_LABELS,
  WORKFLOW_SHORT,
  type ServiceStatus,
} from "@/lib/types";

/** Pastille de sante : vert (up) / orange (degraded) / rouge (down). */
export function StatusDot({
  status,
  className,
  pulse = false,
}: {
  status: ServiceStatus;
  className?: string;
  pulse?: boolean;
}) {
  const color =
    status === "up" ? "bg-ok" : status === "degraded" ? "bg-warn" : "bg-danger";
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        color,
        pulse && status !== "down" && "motion-safe:animate-pulse-dot",
        className,
      )}
      aria-hidden="true"
    />
  );
}

const STATUS_LABEL: Record<ServiceStatus, string> = {
  up: "Operationnel",
  degraded: "Degrade",
  down: "Injoignable",
};

/**
 * Statut des 4 workflows en pastilles + Mongo/SMTP (ping de sante, poll 2 s).
 */
export function WorkflowHealthPanel() {
  const { health, error, isLoading } = useHealth();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Sante des workflows</CardTitle>
        {health ? (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <StatusDot status={health.mongo === "up" ? "up" : "down"} />
              MongoDB
            </span>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot status={health.smtp === "up" ? "up" : "down"} />
              SMTP
            </span>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {isLoading && !health ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {WORKFLOW_IDS.map((id) => (
              <Skeleton key={id} className="h-14 w-full" />
            ))}
          </div>
        ) : error || !health ? (
          // Mode degrade : on le dit clairement plutot que d'afficher du vert a tort.
          <div
            role="status"
            className="rounded-lg border border-warn/30 bg-warn/[0.06] px-4 py-3 text-sm text-amber-100/90"
          >
            Ping de sante indisponible : l&apos;etat des workflows ne peut pas etre confirme.
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {WORKFLOW_IDS.map((id) => {
              const wf = health.workflows[id];
              const status: ServiceStatus = wf?.status ?? "down";
              return (
                <li
                  key={id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <StatusDot status={status} pulse />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {id} · {WORKFLOW_SHORT[id]}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {WORKFLOW_LABELS[id]}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={cn(
                        "text-xs font-medium",
                        status === "up"
                          ? "text-emerald-300"
                          : status === "degraded"
                            ? "text-amber-300"
                            : "text-red-300",
                      )}
                    >
                      <span className="sr-only">{WORKFLOW_LABELS[id]} : </span>
                      {STATUS_LABEL[status]}
                    </span>
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      {wf?.mode === "stub" ? (
                        <Badge variant="neutral" className="px-1.5 py-0 text-[10px]">
                          stub
                        </Badge>
                      ) : null}
                      {fmtMs(wf?.latency_ms ?? null)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
