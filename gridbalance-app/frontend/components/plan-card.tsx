"use client";

import * as React from "react";
import {
  BookOpen,
  ChevronDown,
  Clock,
  Coins,
  Lock,
  Scale,
  ShieldAlert,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ACTION_LABELS } from "@/lib/types";
import { cn, fmtMAD, fmtNumber, fmtPercent } from "@/lib/utils";
import type { Citation, Plan, PlanAction } from "@/lib/contracts";

/* ------------------------------------------------------------- citations */

/** Citations RAG depliables : document, page, extrait. */
export function CitationList({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();

  if (!citations.length) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-amber-300">
        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
        Aucune citation : ce plan n&apos;est pas source.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors",
          "hover:bg-white/[0.05] hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-base-800",
        )}
      >
        <span className="flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          {citations.length} citation{citations.length > 1 ? "s" : ""} RAG
        </span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <ul id={id} className="mt-2 space-y-2">
          {citations.map((c, i) => (
            <li
              key={`${c.doc}-${c.page}-${i}`}
              className="rounded-md border border-white/[0.07] bg-white/[0.02] p-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="truncate font-mono text-[11px] text-emerald-300">{c.doc}</span>
                <span className="flex items-center gap-2">
                  <Badge variant="neutral" className="px-1.5 py-0 text-[10px]">
                    p. {c.page}
                  </Badge>
                  {c.score != null ? (
                    <span className="text-[10px] text-muted-foreground">
                      score {fmtNumber(c.score, 2)}
                    </span>
                  ) : null}
                </span>
              </div>
              <blockquote className="mt-1.5 border-l-2 border-emerald-500/30 pl-2 text-xs leading-relaxed text-muted-foreground">
                {c.extrait}
              </blockquote>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- actions */

function ActionRow({ action }: { action: PlanAction }) {
  const hours = action.hours;
  const hoursLabel =
    hours.length === 0
      ? "—"
      : hours.length <= 3
        ? hours.map((h) => `H+${h}`).join(", ")
        : `H+${hours[0]} → H+${hours[hours.length - 1]} (${hours.length} h)`;

  return (
    <li className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Zap className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
          {ACTION_LABELS[action.action]}
        </span>
        <span className="font-mono text-xs tabular-nums text-foreground">
          {action.delta_mw > 0 ? "+" : ""}
          {fmtNumber(action.delta_mw)} MW
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="truncate">{action.site}</span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {hoursLabel}
        </span>
      </div>
      {action.justification ? (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground/90">
          {action.justification}
        </p>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------- carte plan */

export function PlanCard({
  plan,
  selected = false,
  proposed = false,
  /** Quand le RAG est en repli, AUCUN plan n'est selectionnable automatiquement. */
  selectable = true,
  onSelect,
  action,
  className,
}: {
  plan: Plan;
  selected?: boolean;
  proposed?: boolean;
  selectable?: boolean;
  onSelect?: (id: Plan["id"]) => void;
  action?: React.ReactNode;
  className?: string;
}) {
  const protectedOk = plan.protected_loads_respected;

  return (
    <Card
      className={cn(
        "flex flex-col transition-colors",
        selected && "ring-2 ring-inset ring-emerald-500/60",
        proposed && !selected && "ring-1 ring-inset ring-emerald-500/30",
        className,
      )}
    >
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg text-base font-bold",
                selected
                  ? "bg-emerald-500 text-base-900"
                  : "bg-emerald-500/12 text-emerald-300 ring-1 ring-emerald-500/25",
              )}
              aria-hidden="true"
            >
              {plan.id}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                Plan {plan.id}
              </p>
              {plan.label ? (
                <p className="truncate text-xs text-muted-foreground">{plan.label}</p>
              ) : null}
            </div>
          </div>
          {proposed ? <Badge variant="default">Propose</Badge> : null}
        </div>

        {/* CHARGES PROTEGEES — icone CADENAS verrouille. */}
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
            protectedOk
              ? "border-ok/30 bg-ok/[0.07] text-emerald-200"
              : "border-danger/40 bg-danger/[0.08] text-red-200",
          )}
        >
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="font-medium">
            {protectedOk
              ? "Charges protegees verrouillees — aucune n'est touchee."
              : "Alerte : ce plan touche une charge protegee."}
          </span>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {/* Metriques */}
        <dl className="grid grid-cols-3 gap-2">
          <div className="rounded-md bg-white/[0.03] p-2">
            <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Coins className="h-3 w-3" aria-hidden="true" />
              Cout
            </dt>
            <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
              {fmtMAD(plan.estimated_cost)}
            </dd>
          </div>
          <div className="rounded-md bg-white/[0.03] p-2">
            <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Scale className="h-3 w-3" aria-hidden="true" />
              Equite
            </dt>
            <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
              {fmtPercent(plan.fairness_score, 0)}
            </dd>
          </div>
          <div className="rounded-md bg-white/[0.03] p-2">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Couvert</dt>
            <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
              {fmtNumber(plan.covered_deficit_mwh, 0)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">MWh</span>
            </dd>
          </div>
        </dl>

        {/* Actions */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Actions ({plan.actions.length})
          </p>
          {plan.actions.length ? (
            <ul className="space-y-2">
              {plan.actions.map((a, i) => (
                <ActionRow key={`${a.site}-${a.action}-${i}`} action={a} />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Aucune action dans ce plan.</p>
          )}
        </div>

        {/* Citations */}
        <div className="mt-auto border-t border-white/[0.06] pt-3">
          <CitationList citations={plan.citations} />
        </div>

        {/* Selection / action */}
        {action ?? (
          onSelect ? (
            <Button
              variant={selected ? "default" : "outline"}
              className="w-full"
              disabled={!selectable}
              onClick={() => onSelect(plan.id)}
              aria-pressed={selected}
            >
              {selected ? "Plan selectionne" : `Selectionner le plan ${plan.id}`}
            </Button>
          ) : null
        )}
      </CardContent>
    </Card>
  );
}

/** BANDEAU AMBRE de repli RAG : preuve insuffisante => validation humaine. */
export function RagFallbackBanner() {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-warn/40 bg-warn/[0.09] px-4 py-3"
    >
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-amber-100">
          Preuve insuffisante — validation humaine requise
        </p>
        <p className="text-xs leading-relaxed text-amber-100/80">
          La recherche documentaire n&apos;a pas trouve de fondement suffisant pour ces plans.
          Aucun plan n&apos;est selectionnable automatiquement : un operateur doit en proposer un
          explicitement, et un superviseur doit le valider avec un commentaire.
        </p>
      </div>
    </div>
  );
}
