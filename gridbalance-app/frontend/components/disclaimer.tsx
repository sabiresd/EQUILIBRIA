import { ShieldAlert } from "lucide-react";
import { DISCLAIMER } from "@/lib/contracts";
import { cn } from "@/lib/utils";

/**
 * DISCLAIMER OBLIGATOIRE — texte exact issu du contrat (contracts.ts).
 * Present dans le pied de page de CHAQUE page + en banniere sur /login.
 */

export function DisclaimerFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "border-t border-hairline/[0.07] bg-base-900/60 px-6 py-5 backdrop-blur-sm",
        className,
      )}
    >
      <div className="mx-auto flex max-w-7xl items-start gap-3">
        <ShieldAlert
          className="mt-0.5 h-4 w-4 shrink-0 text-warn"
          aria-hidden="true"
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="sr-only">Avertissement : </span>
          {DISCLAIMER}
        </p>
      </div>
    </footer>
  );
}

export function DisclaimerBanner({ className }: { className?: string }) {
  return (
    <div
      role="note"
      aria-label="Avertissement produit"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-warn/30 bg-warn/[0.08] px-4 py-3",
        className,
      )}
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
      <p className="text-xs leading-relaxed text-amber-100/90">{DISCLAIMER}</p>
    </div>
  );
}
