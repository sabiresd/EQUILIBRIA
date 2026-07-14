"use client";

import * as React from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * Tuile KPI. Le chiffre est le graphique : pas de mini-barre inutile.
 * Chiffres proportionnels (pas de tabular-nums sur les grands nombres isoles).
 */
export function KpiCard({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  tone = "neutral",
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: "neutral" | "good" | "warning" | "critical";
  className?: string;
}) {
  const toneRing = {
    neutral: "",
    good: "ring-1 ring-inset ring-ok/25",
    warning: "ring-1 ring-inset ring-warn/30",
    critical: "ring-1 ring-inset ring-danger/35",
  }[tone];

  const toneText = {
    neutral: "text-foreground",
    good: "text-emerald-300",
    warning: "text-amber-300",
    critical: "text-red-300",
  }[tone];

  return (
    <Card className={cn(toneRing, className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {Icon ? (
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
          ) : null}
        </div>

        <p className="mt-3 flex items-baseline gap-1.5">
          {/* Figures proportionnelles : un grand nombre isole ne s'aligne sur rien. */}
          <span className={cn("text-3xl font-semibold tracking-tight", toneText)}>{value}</span>
          {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
        </p>

        {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/**
 * KPI dedie aux CHARGES PROTEGEES : la cible ZERO est mise en avant.
 * Le statut n'est jamais porte par la couleur seule (icone + libelle).
 */
export function ProtectedLoadsKpi({ violations }: { violations: number }) {
  const compliant = violations === 0;
  const Icon = compliant ? ShieldCheck : ShieldAlert;

  return (
    <Card
      className={cn(
        "ring-1 ring-inset",
        compliant ? "ring-ok/30 bg-ok/[0.04]" : "ring-danger/40 bg-danger/[0.06]",
      )}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Violations de charges protegees
          </p>
          <Icon
            className={cn("h-4 w-4 shrink-0", compliant ? "text-ok" : "text-danger")}
            aria-hidden="true"
          />
        </div>

        <p className="mt-3 flex items-baseline gap-2">
          <span
            className={cn(
              "text-3xl font-semibold tracking-tight",
              compliant ? "text-emerald-300" : "text-red-300",
            )}
          >
            {violations}
          </span>
          <span className="text-sm text-muted-foreground">/ cible 0</span>
        </p>

        <p
          className={cn(
            "mt-1.5 flex items-center gap-1.5 text-xs font-medium",
            compliant ? "text-emerald-300/90" : "text-red-300/90",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {compliant
            ? "Cible atteinte — aucune charge protegee touchee."
            : "Cible manquee — un plan touche une charge protegee."}
        </p>
      </CardContent>
    </Card>
  );
}
