"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Affiche le correlation_id (UUID v4) d'un run ou d'une erreur, avec copie.
 * Il DOIT etre visible partout : c'est la cle de tracabilite pour le support.
 */
export function CorrelationId({
  value,
  label = "ID de correlation",
  truncate = true,
  className,
}: {
  value: string | null | undefined;
  label?: string;
  truncate?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  if (!value) return null;

  const shown = truncate ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {label}
      </span>
      <button
        type="button"
        onClick={copy}
        title={value}
        aria-label={`${label} ${value}. Cliquer pour copier.`}
        className={cn(
          "group inline-flex items-center gap-1.5 rounded border border-hairline/10 bg-hairline/[0.03] px-1.5 py-0.5",
          "font-mono text-[11px] text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-emerald-300",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        {shown}
        {copied ? (
          <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
        ) : (
          <Copy className="h-3 w-3 opacity-50 group-hover:opacity-100" aria-hidden="true" />
        )}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Identifiant copie dans le presse-papiers." : ""}
      </span>
    </span>
  );
}
