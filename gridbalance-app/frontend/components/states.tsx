"use client";

import * as React from "react";
import { AlertTriangle, Inbox, RefreshCw, WifiOff, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CorrelationId } from "@/components/correlation-id";
import { errorCorrelationId, errorMessage, isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Etat d'ERREUR : message en francais, JAMAIS de stack trace,
 * toujours accompagne du correlation_id pour le support.
 */
export function ErrorState({
  error,
  onRetry,
  className,
  compact = false,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const message = errorMessage(error);
  const cid = errorCorrelationId(error);
  const degraded = isApiError(error) && (error.kind === "upstream" || error.kind === "network");
  const retryable = isApiError(error) ? error.retryable : true;

  const Icon = degraded ? WifiOff : AlertTriangle;

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg border px-4 py-4",
        degraded
          ? "border-warn/30 bg-warn/[0.06]"
          : "border-danger/30 bg-danger/[0.06]",
        compact ? "text-sm" : "",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Icon
          className={cn("mt-0.5 h-5 w-5 shrink-0", degraded ? "text-warn" : "text-danger")}
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {degraded ? "Mode degrade" : "Une erreur est survenue"}
          </p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </div>

      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        {cid ? (
          <CorrelationId value={cid} label="Reference support" />
        ) : (
          <span className="text-xs text-muted-foreground/60">
            Communiquez cette page au support si le probleme persiste.
          </span>
        )}
        {onRetry && retryable ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Relancer
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Etat VIDE soigne. */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline/10 bg-hairline/[0.015] px-6 py-14 text-center",
        className,
      )}
    >
      <div className="rounded-full border border-hairline/10 bg-hairline/[0.03] p-3">
        <Icon className="h-6 w-6 text-muted-foreground/70" aria-hidden={true} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------- squelettes */

export function KpiSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-3 w-20" />
      </CardContent>
    </Card>
  );
}

export function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="space-y-3">
      <Skeleton className="h-3 w-40" />
      <Skeleton style={{ height }} className="w-full" />
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-2">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-11 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Indicateur de chargement accessible pour les zones en polling. */
export function LoadingRegion({ label }: { label: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {label}
    </span>
  );
}
