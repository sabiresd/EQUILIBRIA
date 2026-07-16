"use client";

import { AlertCircle, Check, Clock, Loader2 } from "lucide-react";
import { cn, fmtMs } from "@/lib/utils";
import { WORKFLOW_IDS, WORKFLOW_LABELS, type WorkflowStep } from "@/lib/types";
import type { Run } from "@/lib/contracts";

const STATUS_TEXT = {
  pending: "En attente",
  running: "En cours",
  done: "Termine",
  error: "Erreur",
} as const;

function StepIcon({ status }: { status: WorkflowStep["status"] }) {
  if (status === "done") {
    return <Check className="h-4 w-4 text-ink" aria-hidden="true" />;
  }
  if (status === "running") {
    return (
      <Loader2
        className="h-4 w-4 animate-spin text-ink motion-reduce:animate-none"
        aria-hidden="true"
      />
    );
  }
  if (status === "error") {
    return <AlertCircle className="h-4 w-4 text-white" aria-hidden="true" />;
  }
  return <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
}

/**
 * STEPPER de progression par workflow.
 * Etats : en attente / en cours / terminé / erreur, avec la duree en ms.
 */
export function RunStepper({ run }: { run: Run | undefined }) {
  // On garantit les 4 etapes meme si le backend n'en a encore renvoye aucune.
  const steps: WorkflowStep[] = WORKFLOW_IDS.map((wf) => {
    const found = run?.steps.find((s) => s.workflow === wf);
    return found ?? { workflow: wf, status: "pending", duration_ms: null, error: null };
  });

  return (
    <ol
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      aria-label="Progression des workflows"
    >
      {steps.map((step, i) => {
        const { status } = step;
        return (
          <li
            key={step.workflow}
            aria-current={status === "running" ? "step" : undefined}
            className={cn(
              "relative rounded-lg border px-4 py-3 transition-colors",
              status === "done" && "border-emerald-500/30 bg-emerald-500/[0.07]",
              status === "running" && "border-emerald-500/50 bg-emerald-500/[0.12] shadow-glow",
              status === "error" && "border-danger/40 bg-danger/[0.08]",
              status === "pending" && "border-hairline/[0.07] bg-hairline/[0.02]",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                  status === "done" && "bg-emerald-500",
                  status === "running" && "bg-emerald-400",
                  status === "error" && "bg-danger",
                  status === "pending" && "border border-hairline/12 bg-hairline/[0.04]",
                )}
              >
                <StepIcon status={status} />
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-1.5 text-sm font-semibold text-foreground">
                  <span className="text-xs text-muted-foreground">{i + 1}.</span>
                  {step.workflow}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {WORKFLOW_LABELS[step.workflow]}
                </p>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "text-xs font-medium",
                      status === "done" && "text-emerald-300",
                      status === "running" && "text-emerald-200",
                      status === "error" && "text-red-300",
                      status === "pending" && "text-muted-foreground",
                    )}
                  >
                    {STATUS_TEXT[status]}
                  </span>
                  {step.duration_ms != null ? (
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {fmtMs(step.duration_ms)}
                    </span>
                  ) : null}
                </div>

                {status === "error" && step.error ? (
                  <p className="mt-2 rounded border border-danger/30 bg-danger/10 px-2 py-1 text-[11px] leading-snug text-red-200">
                    {/* Message court, jamais de stack trace. */}
                    {step.error.slice(0, 160)}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
