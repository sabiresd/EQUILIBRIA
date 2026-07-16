"use client";

import * as React from "react";
import Link from "next/link";
import {
  BatteryCharging,
  BellRing,
  Coins,
  PlayCircle,
  TrendingDown,
} from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard, ProtectedLoadsKpi } from "@/components/kpi-card";
import { WorkflowHealthPanel } from "@/components/workflow-status";
import { ChartCard, ProductionDemandChart, type MainPoint } from "@/components/charts";
import { RunStatusBadge, ScenarioBadge, SeverityBadge } from "@/components/badges";
import { CorrelationId } from "@/components/correlation-id";
import { ChartSkeleton, EmptyState, ErrorState, KpiSkeleton } from "@/components/states";
import { LiveTile } from "@/components/live-tile";
import { useDashboardKpis } from "@/lib/hooks";
import { ALERT_RULE_LABELS } from "@/lib/types";
import { fmtMAD, fmtNumber, fmtPercent, fmtRelative } from "@/lib/utils";

export default function DashboardPage() {
  const { kpis, error, isLoading, mutate } = useDashboardKpis();

  // La fenetre sans vent peut venir du KPI ou etre deduite du dernier run.
  const windlessWindow = React.useMemo(() => {
    if (kpis?.windless_window) return kpis.windless_window;
    const withWindow = kpis?.last_runs?.find((r) => r.deficit_summary?.windless_window);
    return withWindow?.deficit_summary?.windless_window ?? null;
  }, [kpis]);

  const mainData: MainPoint[] = React.useMemo(() => {
    if (!kpis?.main_series) return [];
    return kpis.main_series.map((p) => ({
      h: p.h,
      prod_wind_mw: p.prod_wind_mw,
      prod_solar_mw: p.prod_solar_mw,
      prod_total_mw: p.prod_wind_mw + p.prod_solar_mw,
      demand_mw: p.demand_mw,
    }));
  }, [kpis]);

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description="Etat instantane du reseau simule, sante des workflows d'orchestration et derniers evenements."
        actions={
          <Button asChild>
            <Link href="/simulation">
              <PlayCircle className="h-4 w-4" aria-hidden="true" />
              Nouvelle simulation
            </Link>
          </Button>
        }
      />

      {error && !kpis ? (
        <ErrorState error={error} onRetry={() => mutate()} className="mb-6" />
      ) : null}

      {/* ------------------------------------------------- reseau temps reel */}
      <LiveTile />

      {/* ------------------------------------------------------------- KPI */}
      <section aria-label="Indicateurs cles" className="mb-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {isLoading && !kpis ? (
            <>
              <KpiSkeleton />
              <KpiSkeleton />
              <KpiSkeleton />
              <KpiSkeleton />
            </>
          ) : kpis ? (
            <>
              <KpiCard
                label="Deficit courant"
                value={fmtNumber(kpis.deficit_mw, 1)}
                unit="MW"
                icon={TrendingDown}
                tone={kpis.deficit_mw > 0 ? "warning" : "good"}
                hint={
                  kpis.deficit_mw > 0
                    ? "Production insuffisante : reequilibrage necessaire."
                    : "Production suffisante sur l'heure courante."
                }
              />
              <KpiCard
                label="Etat de charge batterie"
                value={fmtPercent(kpis.soc, 0)}
                icon={BatteryCharging}
                tone={kpis.soc < 0.2 ? "critical" : kpis.soc < 0.4 ? "warning" : "good"}
                hint="SoC — part de la capacite encore disponible."
              />
              <KpiCard
                label="Cout cumule"
                value={fmtMAD(kpis.cumulative_cost)}
                icon={Coins}
                hint="Tarifs de demonstration, non officiels ANRE."
              />
              <ProtectedLoadsKpi violations={kpis.protected_violations} />
            </>
          ) : null}
        </div>
      </section>

      {/* -------------------------------------------- graphe principal 360 h */}
      <section aria-label="Production et demande" className="mb-6">
        {isLoading && !kpis ? (
          <Card>
            <CardContent className="p-5">
              <ChartSkeleton height={320} />
            </CardContent>
          </Card>
        ) : mainData.length ? (
          <ChartCard
            title="Production vs demande — horizon 360 h"
            description={
              windlessWindow
                ? `Fenetre sans vent detectee : H+${windlessWindow.start_h} a H+${windlessWindow.end_h}.`
                : "Aucune fenetre sans vent detectee sur l'horizon courant."
            }
            tableRows={mainData}
            tableColumns={[
              { key: "h", header: "Heure", cell: (r) => `H+${r.h}` },
              { key: "w", header: "Eolien (MW)", cell: (r) => fmtNumber(r.prod_wind_mw) },
              { key: "s", header: "Solaire (MW)", cell: (r) => fmtNumber(r.prod_solar_mw) },
              { key: "d", header: "Demande (MW)", cell: (r) => fmtNumber(r.demand_mw) },
              {
                key: "net",
                header: "Solde (MW)",
                cell: (r) => fmtNumber(r.prod_total_mw - r.demand_mw),
              },
            ]}
          >
            <ProductionDemandChart data={mainData} windlessWindow={windlessWindow} height={340} />
          </ChartCard>
        ) : (
          <Card>
            <CardContent className="p-5">
              <EmptyState
                title="Aucune serie a afficher"
                description="Lancez une simulation pour alimenter le tableau de bord en previsions de production et de demande."
                icon={PlayCircle}
                action={
                  <Button asChild size="sm">
                    <Link href="/simulation">Lancer une simulation</Link>
                  </Button>
                }
              />
            </CardContent>
          </Card>
        )}
      </section>

      {/* ------------------------------- sante des workflows + dernieres alertes */}
      <div className="grid gap-6 lg:grid-cols-2">
        <WorkflowHealthPanel />

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Dernieres alertes</CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link href="/alertes">Tout voir</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading && !kpis ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-lg bg-hairline/[0.04]" />
                ))}
              </div>
            ) : kpis?.last_alerts?.length ? (
              <ul className="space-y-2">
                {kpis.last_alerts.slice(0, 5).map((alert) => (
                  <li
                    key={alert.id}
                    className="rounded-lg border border-hairline/[0.06] bg-hairline/[0.02] px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="flex flex-wrap items-center gap-2">
                          <SeverityBadge severity={alert.severity} />
                          <span className="text-xs text-muted-foreground">
                            {ALERT_RULE_LABELS[alert.rule]}
                          </span>
                        </p>
                        <p className="truncate text-sm text-foreground">{alert.message}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {fmtRelative(alert.created_at)}
                      </span>
                    </div>
                    {alert.correlation_id ? (
                      <div className="mt-2">
                        <CorrelationId value={alert.correlation_id} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="Aucune alerte"
                description="Le systeme n'a declenche aucune alerte pour le moment."
                icon={BellRing}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ------------------------------------------------------ derniers runs */}
      <section aria-label="Derniers runs" className="mt-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Derniers runs</CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link href="/simulation">Nouvelle simulation</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading && !kpis ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-lg bg-hairline/[0.04]" />
                ))}
              </div>
            ) : kpis?.last_runs?.length ? (
              <ul className="divide-y divide-hairline/[0.05]">
                {kpis.last_runs.slice(0, 6).map((run) => (
                  <li key={run.correlation_id}>
                    <Link
                      href={`/simulation?cid=${run.correlation_id}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-hairline/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex flex-wrap items-center gap-2.5">
                        <RunStatusBadge status={run.status} />
                        <ScenarioBadge scenario={run.scenario} />
                        <CorrelationId value={run.correlation_id} />
                      </span>
                      <span className="flex items-center gap-4 text-xs text-muted-foreground">
                        {run.totals ? (
                          <span className="font-mono tabular-nums">
                            {fmtNumber(run.totals.total_deficit_mwh, 0)} MWh de deficit
                          </span>
                        ) : null}
                        <span>{fmtRelative(run.created_at)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="Aucun run enregistre"
                description="Les simulations que vous lancerez apparaitront ici avec leur identifiant de correlation."
                icon={PlayCircle}
                action={
                  <Button asChild size="sm">
                    <Link href="/simulation">Lancer une simulation</Link>
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
