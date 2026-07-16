import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DisclaimerFooter } from "@/components/disclaimer";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-hairline/10 bg-hairline/[0.03]">
            <Compass className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          </div>

          <p className="font-mono text-sm text-emerald-400">404</p>
          <h1 className="mt-1 text-lg font-semibold text-foreground">Page introuvable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Cette page n&apos;existe pas ou a ete deplacee.
          </p>

          <Button asChild className="mt-6">
            <Link href="/dashboard">Retour au tableau de bord</Link>
          </Button>
        </div>
      </main>

      <DisclaimerFooter />
    </div>
  );
}
