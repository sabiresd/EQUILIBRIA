"use client";

import { Moon, Sun } from "lucide-react";

/** Cle de persistance — partagee avec le script anti-flash de app/layout.tsx. */
export const THEME_STORAGE_KEY = "gridbalance-theme";

/**
 * Bascule clair / sombre.
 *
 * Le theme vit dans la classe `dark` de <html> : la source de verite est le DOM,
 * pas un etat React. On evite ainsi tout desaccord d'hydratation — les deux
 * icones sont rendues et c'est le CSS (`dark:`) qui montre la bonne. Le choix
 * est persiste ; le script inline du layout le rejoue avant le premier pixel.
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.classList.contains("dark") ? "light" : "dark";
    root.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* mode prive : on bascule quand meme, sans memoriser */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Changer de theme (clair / sombre)"
      title="Changer de theme"
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline/[0.07] bg-hairline/[0.03] text-muted-foreground transition-colors hover:bg-hairline/[0.06] hover:text-foreground"
    >
      <Sun className="h-4 w-4 dark:hidden" aria-hidden="true" />
      <Moon className="hidden h-4 w-4 dark:block" aria-hidden="true" />
    </button>
  );
}
