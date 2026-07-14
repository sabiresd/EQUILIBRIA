"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DisclaimerBanner, DisclaimerFooter } from "@/components/disclaimer";
import { ErrorState } from "@/components/states";
import { api } from "@/lib/api";
import { LoginRequestSchema } from "@/lib/schemas";
import { ROLE_LABELS } from "@/lib/types";
import type { Role } from "@/lib/contracts";
import { cn } from "@/lib/utils";

/** Comptes de DEMONSTRATION — cliquables, ils pre-remplissent le formulaire. */
const DEMO_ACCOUNTS: { email: string; role: Role; hint: string }[] = [
  {
    email: "operator@demo.ma",
    role: "operator",
    hint: "Lance les simulations, consulte les tableaux de bord, propose un plan.",
  },
  {
    email: "supervisor@demo.ma",
    role: "supervisor",
    hint: "Valide ou rejette les plans (HITL), acquitte les alertes.",
  },
  {
    email: "admin@demo.ma",
    role: "admin",
    hint: "Gere les utilisateurs, la configuration et le journal d'audit.",
  },
];

const DEMO_PASSWORD = "demo1234";

/**
 * Destination post-connexion, deposee par le middleware (`/login?from=…`).
 *
 * On la lit a la SOUMISSION via `window.location`, et non avec `useSearchParams()` :
 * ce hook forcerait toute la page en rendu client (bailout CSR) et le formulaire
 * ne serait plus prerendu. On n'accepte qu'un chemin interne, pour ne pas se faire
 * rediriger vers un domaine tiers (open redirect).
 */
function safeRedirectTarget(): string {
  if (typeof window === "undefined") return "/dashboard";
  const from = new URLSearchParams(window.location.search).get("from");
  if (from && from.startsWith("/") && !from.startsWith("//")) return from;
  return "/dashboard";
}

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<{ email?: string; password?: string }>({});
  const [error, setError] = React.useState<unknown>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const emailRef = React.useRef<HTMLInputElement>(null);

  const fillDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setFieldErrors({});
    setError(null);
    emailRef.current?.focus();
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = LoginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        email: flat.email?.[0],
        password: flat.password?.[0],
      });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      await api.auth.login(parsed.data.email, parsed.data.password);
      // Le backend a pose les cookies httpOnly : le middleware laissera passer.
      router.push(safeRedirectTarget());
      router.refresh();
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-5xl">
          {/* BANNIERE DISCLAIMER — obligatoire sur /login. */}
          <DisclaimerBanner className="mb-8" />

          <div className="grid gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
            {/* ------------------------------------------------ presentation */}
            <div className="flex flex-col justify-center">
              <div className="mb-6 flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
                  <Activity className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-lg font-semibold tracking-tight text-foreground">
                    GridBalance AI Morocco
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Orchestrateur de flexibilite du reseau electrique
                  </p>
                </div>
              </div>

              <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
                Anticiper les journees{" "}
                <span className="text-emerald-400">sans vent</span>, decider en confiance.
              </h1>
              <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">
                Prevision de la production et de la consommation sur 360 heures, calcul du
                deficit, puis trois plans de reequilibrage candidats sources par recherche
                documentaire. Chaque plan reste soumis a une validation humaine avant
                execution.
              </p>

              <ul className="mt-8 space-y-2.5 text-sm text-muted-foreground">
                {[
                  "Horizon de prevision de 15 jours (360 h)",
                  "Trois plans candidats avec citations verifiables",
                  "Validation humaine obligatoire (HITL) et journal d'audit",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                      aria-hidden="true"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* --------------------------------------------------- formulaire */}
            <Card className="shadow-glow">
              <CardContent className="p-6 sm:p-7">
                <div className="mb-6 space-y-1">
                  <h2 className="text-lg font-semibold text-foreground">Connexion</h2>
                  <p className="text-sm text-muted-foreground">
                    Identifiez-vous pour acceder a la console.
                  </p>
                </div>

                <form onSubmit={onSubmit} noValidate className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Adresse e-mail</Label>
                    <Input
                      ref={emailRef}
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="username"
                      placeholder="operator@demo.ma"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-invalid={!!fieldErrors.email}
                      aria-describedby={fieldErrors.email ? "email-error" : undefined}
                      required
                    />
                    {fieldErrors.email ? (
                      <p id="email-error" role="alert" className="text-xs text-red-300">
                        {fieldErrors.email}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Mot de passe</Label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={!!fieldErrors.password}
                      aria-describedby={fieldErrors.password ? "password-error" : undefined}
                      required
                    />
                    {fieldErrors.password ? (
                      <p id="password-error" role="alert" className="text-xs text-red-300">
                        {fieldErrors.password}
                      </p>
                    ) : null}
                  </div>

                  {error ? <ErrorState error={error} compact /> : null}

                  <Button type="submit" className="w-full" size="lg" loading={submitting}>
                    {!submitting ? <LogIn className="h-4 w-4" aria-hidden="true" /> : null}
                    Se connecter
                  </Button>
                </form>

                {/* -------------------------------------- comptes de demo */}
                <div className="mt-7 border-t border-white/[0.07] pt-5">
                  <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Comptes de demonstration
                  </p>
                  <ul className="space-y-2">
                    {DEMO_ACCOUNTS.map((acc) => (
                      <li key={acc.email}>
                        <button
                          type="button"
                          onClick={() => fillDemo(acc.email)}
                          aria-label={`Pre-remplir le formulaire avec le compte ${ROLE_LABELS[acc.role]} ${acc.email}`}
                          className={cn(
                            "group flex w-full items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-left transition-colors",
                            "hover:border-emerald-500/40 hover:bg-emerald-500/[0.06]",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-base-800",
                            email === acc.email && "border-emerald-500/50 bg-emerald-500/[0.08]",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="truncate font-mono text-xs text-foreground">
                                {acc.email}
                              </span>
                              <Badge variant="neutral" className="shrink-0 px-1.5 py-0 text-[10px]">
                                {ROLE_LABELS[acc.role]}
                              </Badge>
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {acc.hint}
                            </span>
                          </span>
                          <ArrowRight
                            className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-emerald-400"
                            aria-hidden="true"
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[11px] text-muted-foreground/70">
                    Mot de passe commun :{" "}
                    <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-foreground">
                      {DEMO_PASSWORD}
                    </code>
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <DisclaimerFooter />
    </div>
  );
}

