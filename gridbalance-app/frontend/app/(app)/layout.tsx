import { AppShell } from "@/components/app-shell";

/**
 * Coquille des routes AUTHENTIFIEES.
 * L'acces est deja filtre par middleware.ts ; le backend revalide chaque appel.
 */
export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
