"use client";

import * as React from "react";
import Link from "next/link";
import { BellRing, CheckCheck, Settings2, SlidersHorizontal } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SeverityBadge } from "@/components/badges";
import { CorrelationId } from "@/components/correlation-id";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { toast } from "@/components/ui/use-toast";
import { api, errorMessage } from "@/lib/api";
import { useAdminConfig, useAlerts, usePermissions } from "@/lib/hooks";
import { ALERT_RULE_DESCRIPTIONS, ALERT_RULE_LABELS, type AlertRule } from "@/lib/types";
import { fmtDateTime, fmtRelative } from "@/lib/utils";
import type { AdminConfig } from "@/lib/schemas";

const RULES: AlertRule[] = [
  "deficit_threshold",
  "soc_threshold",
  "protected_load_violation",
  "workflow_failure",
  "rag_fallback",
];

/* -------------------------------------------------------------------------- */
/*                             Regles configurables                            */
/* -------------------------------------------------------------------------- */

function AlertRules() {
  const { canAdmin } = usePermissions();
  const { config, error, isLoading, mutate } = useAdminConfig();

  const [draft, setDraft] = React.useState<AdminConfig | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (config) setDraft(config);
  }, [config]);

  const dirty =
    !!draft && !!config && JSON.stringify(draft) !== JSON.stringify(config);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await api.admin.config.update(draft);
      await mutate(saved, { revalidate: false });
      toast({
        variant: "success",
        title: "Regles enregistrees",
        description: "Les seuils et regles d'alerte ont ete mis a jour.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Enregistrement impossible",
        description: errorMessage(err),
      });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading && !config) return <TableSkeleton rows={5} cols={2} />;

  // Un operateur n'a pas acces a /api/admin/config : on l'annonce sans crier a l'erreur.
  if (error && !canAdmin) {
    return (
      <Card>
        <CardContent className="p-5">
          <EmptyState
            title="Configuration reservee a l'administrateur"
            description="Les regles d'alerte sont consultables et modifiables par un administrateur. Les alertes declenchees restent visibles dans l'onglet precedent."
            icon={SlidersHorizontal}
          />
        </CardContent>
      </Card>
    );
  }

  if (error || !draft) {
    return <ErrorState error={error} onRetry={() => mutate()} />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Seuils de declenchement</CardTitle>
          <CardDescription>
            Ces valeurs conditionnent les regles « deficit » et « SoC ».
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="th-deficit">Seuil de deficit (MW)</Label>
            <Input
              id="th-deficit"
              type="number"
              step="1"
              min="0"
              disabled={!canAdmin}
              value={draft.thresholds.deficit_mw}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  thresholds: { ...draft.thresholds, deficit_mw: Number(e.target.value) },
                })
              }
            />
            <p className="text-xs text-muted-foreground">
              Une alerte est levee au-dela de ce deficit instantane.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="th-soc">Seuil de SoC (0–1)</Label>
            <Input
              id="th-soc"
              type="number"
              step="0.01"
              min="0"
              max="1"
              disabled={!canAdmin}
              value={draft.thresholds.soc_min}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  thresholds: { ...draft.thresholds, soc_min: Number(e.target.value) },
                })
              }
            />
            <p className="text-xs text-muted-foreground">
              Une alerte est levee lorsque l&apos;etat de charge passe sous ce seuil.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Regles actives</CardTitle>
          <CardDescription>
            {canAdmin
              ? "Activez ou desactivez chaque regle de surveillance."
              : "Consultation seule — seul un administrateur peut modifier les regles."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-white/[0.05]">
            {RULES.map((rule) => (
              <li key={rule} className="flex items-start justify-between gap-4 py-3.5">
                <div className="min-w-0">
                  <Label
                    htmlFor={`rule-${rule}`}
                    className="text-sm font-medium text-foreground"
                  >
                    {ALERT_RULE_LABELS[rule]}
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {ALERT_RULE_DESCRIPTIONS[rule]}
                  </p>
                </div>
                <Switch
                  id={`rule-${rule}`}
                  disabled={!canAdmin}
                  checked={draft.rules_enabled[rule]}
                  onCheckedChange={(checked) =>
                    setDraft({
                      ...draft,
                      rules_enabled: { ...draft.rules_enabled, [rule]: checked },
                    })
                  }
                  aria-label={`Activer la regle : ${ALERT_RULE_LABELS[rule]}`}
                />
              </li>
            ))}
          </ul>

          {canAdmin ? (
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => config && setDraft(config)}
                disabled={!dirty || saving}
              >
                Annuler
              </Button>
              <Button onClick={save} loading={saving} disabled={!dirty}>
                Enregistrer les regles
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Liste d'alertes                              */
/* -------------------------------------------------------------------------- */

function AlertList() {
  const { alerts, error, isLoading, mutate } = useAlerts();
  const { canAcknowledge } = usePermissions();
  const [acking, setAcking] = React.useState<string | null>(null);
  const [showAcked, setShowAcked] = React.useState(true);

  const acknowledge = async (id: string) => {
    setAcking(id);
    try {
      await api.alerts.ack(id);
      await mutate();
      toast({
        variant: "success",
        title: "Alerte acquittee",
        description: "L'acquittement est trace (auteur et horodatage).",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Acquittement impossible",
        description: errorMessage(err),
      });
    } finally {
      setAcking(null);
    }
  };

  const visible = React.useMemo(() => {
    if (!alerts) return [];
    return showAcked ? alerts : alerts.filter((a) => !a.acknowledged_at);
  }, [alerts, showAcked]);

  const openCount = alerts?.filter((a) => !a.acknowledged_at).length ?? 0;

  if (isLoading && !alerts) return <TableSkeleton rows={5} cols={4} />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            Alertes
            {openCount > 0 ? <Badge variant="warning">{openCount} non acquittee(s)</Badge> : null}
          </CardTitle>
          <CardDescription>
            Flux mis a jour toutes les 2 secondes. Chaque nouvelle alerte declenche une
            notification.
          </CardDescription>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={showAcked}
            onCheckedChange={setShowAcked}
            aria-label="Afficher les alertes acquittees"
          />
          Afficher les acquittees
        </label>
      </CardHeader>

      <CardContent>
        {visible.length ? (
          <ul className="space-y-2">
            {visible.map((alert) => {
              const acked = !!alert.acknowledged_at;
              return (
                <li
                  key={alert.id}
                  className={`rounded-lg border px-4 py-3 ${
                    acked
                      ? "border-white/[0.06] bg-white/[0.015] opacity-75"
                      : alert.severity === "critical"
                        ? "border-danger/30 bg-danger/[0.05]"
                        : alert.severity === "warning"
                          ? "border-warn/25 bg-warn/[0.04]"
                          : "border-white/[0.07] bg-white/[0.02]"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={alert.severity} />
                        <Badge variant="neutral">{ALERT_RULE_LABELS[alert.rule]}</Badge>
                        {acked ? (
                          <Badge variant="success">
                            <CheckCheck className="h-3 w-3" aria-hidden="true" />
                            Acquittee
                          </Badge>
                        ) : null}
                      </div>

                      <p className="text-sm text-foreground">{alert.message}</p>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span title={fmtDateTime(alert.created_at)}>
                          {fmtRelative(alert.created_at)}
                        </span>
                        {alert.correlation_id ? (
                          <CorrelationId value={alert.correlation_id} />
                        ) : null}
                      </div>

                      {/* Tracabilite de l'acquittement : QUI et QUAND. */}
                      {acked ? (
                        <p className="flex items-center gap-1.5 text-xs text-emerald-300/90">
                          <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          Acquittee par{" "}
                          <strong className="font-medium">
                            {alert.acknowledged_by ?? "—"}
                          </strong>{" "}
                          le {fmtDateTime(alert.acknowledged_at)}
                        </p>
                      ) : null}
                    </div>

                    {!acked && canAcknowledge ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => acknowledge(alert.id)}
                        loading={acking === alert.id}
                      >
                        <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        Acquitter
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : alerts?.length ? (
          <EmptyState
            title="Aucune alerte non acquittee"
            description="Toutes les alertes ont ete traitees."
            icon={CheckCheck}
            action={
              <Button size="sm" variant="outline" onClick={() => setShowAcked(true)}>
                Afficher l&apos;historique
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="Aucune alerte"
            description="Le systeme n'a declenche aucune alerte. Les regles de surveillance sont actives."
            icon={BellRing}
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/simulation">Lancer une simulation</Link>
              </Button>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

export default function AlertesPage() {
  return (
    <>
      <PageHeader
        title="Alertes"
        description="Surveillance du deficit, de la batterie, des charges protegees et des workflows."
      />

      <Tabs defaultValue="flux">
        <TabsList>
          <TabsTrigger value="flux">
            <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
            Flux d&apos;alertes
          </TabsTrigger>
          <TabsTrigger value="regles">
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
            Regles
          </TabsTrigger>
        </TabsList>

        <TabsContent value="flux">
          <AlertList />
        </TabsContent>

        <TabsContent value="regles">
          <AlertRules />
        </TabsContent>
      </Tabs>
    </>
  );
}
