import { cn } from "@/lib/utils";

/**
 * Squelette de chargement. Le scintillement est desactive si l'utilisateur
 * a demande une reduction des animations (prefers-reduced-motion).
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden rounded-md bg-white/[0.06]",
        "after:absolute after:inset-0 after:-translate-x-full after:bg-gradient-to-r after:from-transparent after:via-white/[0.07] after:to-transparent",
        "motion-safe:after:animate-shimmer",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
