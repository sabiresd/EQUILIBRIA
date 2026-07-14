"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAlerts } from "@/lib/hooks";
import { toast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { ALERT_RULE_LABELS } from "@/lib/types";
import type { Alert } from "@/lib/contracts";

const SEVERITY_VARIANT = {
  info: "default",
  warning: "warning",
  critical: "destructive",
} as const;

const SEVERITY_LABEL = {
  info: "Information",
  warning: "Avertissement",
  critical: "Critique",
} as const;

/**
 * Surveille le flux d'alertes (poll 2 s) et emet un TOAST a chaque NOUVELLE
 * alerte. Monte une seule fois dans la coquille applicative.
 */
export function AlertWatcher() {
  const { alerts } = useAlerts();
  const router = useRouter();
  const seen = React.useRef<Set<string>>(new Set());
  const primed = React.useRef(false);

  React.useEffect(() => {
    if (!alerts) return;

    // Au premier chargement on enregistre l'existant SANS notifier :
    // sinon l'utilisateur recevrait un toast par alerte historique.
    if (!primed.current) {
      alerts.forEach((a) => seen.current.add(a.id));
      primed.current = true;
      return;
    }

    const fresh: Alert[] = alerts.filter((a) => !seen.current.has(a.id));
    fresh.forEach((a) => {
      seen.current.add(a.id);
      toast({
        variant: SEVERITY_VARIANT[a.severity],
        title: `${SEVERITY_LABEL[a.severity]} — ${ALERT_RULE_LABELS[a.rule]}`,
        description: a.message,
        action: (
          <ToastAction altText="Ouvrir les alertes" onClick={() => router.push("/alertes")}>
            Voir
          </ToastAction>
        ),
      });
    });
  }, [alerts, router]);

  return null;
}
