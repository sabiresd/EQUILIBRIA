"use client";

import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CorrelationId } from "@/components/correlation-id";
import { DisclaimerFooter } from "@/components/disclaimer";

/**
 * Frontiere d'erreur globale.
 * On n'affiche JAMAIS la stack : seulement un message clair et le `digest`
 * (identifiant que Next associe a l'erreur cote serveur) pour le support.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-md rounded-xl border border-danger/30 bg-danger/[0.05] p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/15">
            <AlertTriangle className="h-6 w-6 text-danger" aria-hidden="true" />
          </div>

          <h1 className="text-lg font-semibold text-foreground">
            Une erreur inattendue est survenue
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            L&apos;interface n&apos;a pas pu afficher cette page. Vous pouvez reessayer. Si le
            probleme persiste, transmettez la reference ci-dessous au support.
          </p>

          {error.digest ? (
            <div className="mt-4 flex justify-center">
              <CorrelationId value={error.digest} label="Reference support" truncate={false} />
            </div>
          ) : null}

          <Button className="mt-6 w-full" onClick={() => reset()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Reessayer
          </Button>
        </div>
      </main>

      <DisclaimerFooter />
    </div>
  );
}
