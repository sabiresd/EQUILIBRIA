"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  BatteryCharging,
  Coins,
  Gauge,
  MapPin,
  PlayCircle,
  RefreshCw,
  Wind,
  X,
} from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { RunStepper } from "@/components/run-stepper";
import { CorrelationId } from "@/components/correlation-id";
import { RunStatusBadge, ScenarioBadge } from "@/components/badges";
import { ChartCard, NaiveVsLookaheadChart, SingleSeriesChart } from "@/components/charts";
import { ChartSkeleton, EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { api, isApiError } from "@/lib/api";
import { useRun } from "@/lib/hooks";
import { CreateRunRequestSchema, type CreateRunRequest } from "@/lib/schemas";
import { computeNaiveComparison } from "@/lib/naive";
import { DEFICIT_COLOR, SERIES } from "@/lib/chart-theme";
import {
  RAG_MODE_LABELS,
  SCENARIO_LABELS,
  TARIFF_PERIOD_LABELS,
  type TariffPeriod,
} from "@/lib/types";
import type { Battery, RagMode, Scenario, Tariffs } from "@/lib/contracts";
import { fmtHorizonHour, fmtMAD, fmtNumber, fmtPercent } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*                      Persistance des parametres du run                      */
/* -------------------------------------------------------------------------- */

/**
 * Les parametres du run (batterie, tarifs) viennent du BACKEND, qui les persiste
 * avec le run et les renvoie dans GET /api/runs/{cid}.
 *
 * Ne PAS les stocker dans le navigateur : la reference naive doit etre calculee
 * avec exactement les memes parametres que le calcul reel de WF-2. Une copie
 * cote client pourrait diverger (autre onglet, autre poste, localStorage vide),
 * et la comparaison naif vs look-ahead deviendrait mensongere sans le dire.
 */
type RunParams = { battery: Battery; tariffs: Tariffs };

/* -------------------------------------------------------------------------- */
/*                              Valeurs par defaut                             */
/* -------------------------------------------------------------------------- */

/** Usine MT de demonstration (Kenitra) — dimensionnee sur la facture ONEE. */
const DEFAULT_FORM = {
  name: "Usine de demonstration - Kenitra",
  lat: "34.2610",
  lon: "-6.5802",
  scenario: "windless" as Scenario,
  // Batterie a l'echelle du site (~1.3 MW moyen) : ecrete les 4 h de pointe du
  // soir. Une batterie surdimensionnee couvrirait tout et masquerait le deficit.
  capacity_mwh: "8",
  p_max_mw: "2",
  soc_min: "0.10",
  efficiency: "0.92",
  degradation_cost_mwh: "120",
  // Tarifs indicatifs (MAD/MWh). Le backend les remplace par ceux de la facture.
  creuse: "650",
  normale: "900",
  pointe: "1400",
  rag_mode: "hybrid" as RagMode,
};

type FormState = typeof DEFAULT_FORM;

function SimulationView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cid = searchParams.get("cid");

  const [form, setForm] = React.useState<FormState>(DEFAULT_FORM);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [submitError, setSubmitError] = React.useState<unknown>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [selectedHour, setSelectedHour] = React.useState<number | null>(null);

  const { run, error: runError, isLoading: runLoading, mutate } = useRun(cid);

  const params = React.useMemo<RunParams | null>(
    () =>
      run?.battery && run?.tariffs
        ? { battery: run.battery, tariffs: run.tariffs }
        : null,
    [run?.battery, run?.tariffs],
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  /* ------------------------------------------------------------- soumission */
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setFieldErrors({});

    const payload = {
      site: {
        name: form.name.trim() || undefined,
        lat: Number(form.lat),
        lon: Number(form.lon),
      },
      scenario: form.scenario,
      battery: {
        capacity_mwh: Number(form.capacity_mwh),
        p_max_mw: Number(form.p_max_mw),
        soc_min: Number(form.soc_min),
        efficiency: Number(form.efficiency),
        degradation_cost_mwh: Number(form.degradation_cost_mwh),
      },
      tariffs: {
        creuse: Number(form.creuse),
        normale: Number(form.normale),
        pointe: Number(form.pointe),
      },
      rag_mode: form.rag_mode,
    };

    const parsed = CreateRunRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((issue) => {
        const key = issue.path.join(".");
        if (!errs[key]) errs[key] = issue.message;
      });
      setFieldErrors(errs);
      return;
    }

    setSubmitting(true);
    try {
      const { correlation_id } = await api.runs.create(parsed.data as CreateRunRequest);
      setSelectedHour(null);
      // On passe le cid dans l'URL : le run devient partageable et rechargeable.
      router.push(`/simulation?cid=${correlation_id}`);
    } catch (err) {
      setSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  };

  /* --------------------------------------------------------------- donnees */
  // Memoises : sans cela, le repli `?? []` cree un tableau neuf a chaque rendu
  // et invalide inutilement tous les useMemo qui en dependent (recalcul des 6 graphes
  // a chaque tick de polling).
  const series = React.useMemo(() => run?.series ?? [], [run?.series]);
  const hourly = React.useMemo(() => run?.hourly ?? [], [run?.hourly]);
  const windlessWindow = run?.deficit_summary?.windless_window ?? null;

  const hourlyByHour = React.useMemo(() => {
    const m = new Map<number, (typeof hourly)[number]>();
    hourly.forEach((p) => m.set(p.h, p));
    return m;
  }, [hourly]);

  /** Cout CUMULE : une serie croissante se lit mieux qu'un cout horaire bruite. */
  const costSeries = React.useMemo(() => {
    let cum = 0;
    return hourly.map((p) => {
      cum += p.cost;
      return { h: p.h, cumulative_cost: Math.round(cum) };
    });
  }, [hourly]);

  const comparison = React.useMemo(() => {
    if (!params || !series.length || !hourly.length) return null;
    return computeNaiveComparison(series, hourly, params.battery, params.tariffs);
  }, [params, series, hourly]);

  const hasResults = series.length > 0 && hourly.length > 0;
  const isRunning =
    run?.status === "running" ||
    run?.status === "pending" ||
    run?.steps.some((s) => s.status === "running");

  /* ----------------------------------------------- inspecteur d'heure */
  const inspected = React.useMemo(() => {
    if (selectedHour == null) return null;
    const s = series.find((p) => p.h === selectedHour);
    const h = hourlyByHour.get(selectedHour);
    if (!s && !h) return null;
    return { hour: selectedHour, s, h };
  }, [selectedHour, series, hourlyByHour]);

  return (
    <>
      <PageHeader
        title="Simulation"
        description="Prevoyez la production et la consommation sur 360 heures, puis calculez le deficit et le dispatch optimal."
        actions={
          cid ? (
            <>
              <Button variant="outline" onClick={() => mutate()} aria-label="Rafraichir le run">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Rafraichir
              </Button>
              <Button asChild>
                <Link href={`/plans?cid=${cid}`}>
                  Plans de reequilibrage
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        {/* ------------------------------------------------------ formulaire */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Parametres du run</CardTitle>
            <CardDescription>
              Horizon fixe a 360 h (15 jours), conformement au contrat.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} noValidate className="space-y-5">
              {/* ------------------------------------------------------ site */}
              <fieldset className="space-y-3">
                <legend className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  Site
                </legend>

                <div className="space-y-2">
                  <Label htmlFor="name">Nom du site</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="Parc de Tarfaya"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="lat">Latitude</Label>
                    <Input
                      id="lat"
                      type="number"
                      step="0.0001"
                      inputMode="decimal"
                      value={form.lat}
                      onChange={(e) => set("lat", e.target.value)}
                      aria-invalid={!!fieldErrors["site.lat"]}
                      aria-describedby={fieldErrors["site.lat"] ? "lat-error" : undefined}
                    />
                    {fieldErrors["site.lat"] ? (
                      <p id="lat-error" role="alert" className="text-xs text-red-300">
                        {fieldErrors["site.lat"]}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lon">Longitude</Label>
                    <Input
                      id="lon"
                      type="number"
                      step="0.0001"
                      inputMode="decimal"
                      value={form.lon}
                      onChange={(e) => set("lon", e.target.value)}
                      aria-invalid={!!fieldErrors["site.lon"]}
                      aria-describedby={fieldErrors["site.lon"] ? "lon-error" : undefined}
                    />
                    {fieldErrors["site.lon"] ? (
                      <p id="lon-error" role="alert" className="text-xs text-red-300">
                        {fieldErrors["site.lon"]}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="scenario">Scenario</Label>
                  <Select
                    value={form.scenario}
                    onValueChange={(v) => set("scenario", v as Scenario)}
                  >
                    <SelectTrigger id="scenario" aria-label="Scenario de simulation">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SCENARIO_LABELS) as Scenario[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {SCENARIO_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </fieldset>

              <Separator />

              {/* --------------------------------------------------- batterie */}
              <fieldset className="space-y-3">
                <legend className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <BatteryCharging className="h-3.5 w-3.5" aria-hidden="true" />
                  Batterie
                </legend>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="capacity">Capacite (MWh)</Label>
                    <Input
                      id="capacity"
                      type="number"
                      step="1"
                      min="1"
                      value={form.capacity_mwh}
                      onChange={(e) => set("capacity_mwh", e.target.value)}
                      aria-invalid={!!fieldErrors["battery.capacity_mwh"]}
                    />
                    {fieldErrors["battery.capacity_mwh"] ? (
                      <p role="alert" className="text-xs text-red-300">
                        {fieldErrors["battery.capacity_mwh"]}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pmax">P max (MW)</Label>
                    <Input
                      id="pmax"
                      type="number"
                      step="1"
                      min="1"
                      value={form.p_max_mw}
                      onChange={(e) => set("p_max_mw", e.target.value)}
                      aria-invalid={!!fieldErrors["battery.p_max_mw"]}
                    />
                    {fieldErrors["battery.p_max_mw"] ? (
                      <p role="alert" className="text-xs text-red-300">
                        {fieldErrors["battery.p_max_mw"]}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="socmin">SoC min (0–1)</Label>
                    <Input
                      id="socmin"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={form.soc_min}
                      onChange={(e) => set("soc_min", e.target.value)}
                      aria-invalid={!!fieldErrors["battery.soc_min"]}
                    />
                    {fieldErrors["battery.soc_min"] ? (
                      <p role="alert" className="text-xs text-red-300">
                        {fieldErrors["battery.soc_min"]}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="eff">Rendement (0–1)</Label>
                    <Input
                      id="eff"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="1"
                      value={form.efficiency}
                      onChange={(e) => set("efficiency", e.target.value)}
                      aria-invalid={!!fieldErrors["battery.efficiency"]}
                    />
                    {fieldErrors["battery.efficiency"] ? (
                      <p role="alert" className="text-xs text-red-300">
                        {fieldErrors["battery.efficiency"]}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="degradation">Cout de degradation (MAD/MWh)</Label>
                  <Input
                    id="degradation"
                    type="number"
                    step="1"
                    min="0"
                    value={form.degradation_cost_mwh}
                    onChange={(e) => set("degradation_cost_mwh", e.target.value)}
                  />
                </div>
              </fieldset>

              <Separator />

              {/* ---------------------------------------------------- tarifs */}
              <fieldset className="space-y-3">
                <legend className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Coins className="h-3.5 w-3.5" aria-hidden="true" />
                  Tarifs (MAD/MWh)
                </legend>

                <div className="grid grid-cols-3 gap-3">
                  {(["creuse", "normale", "pointe"] as TariffPeriod[]).map((period) => (
                    <div key={period} className="space-y-2">
                      <Label htmlFor={`tarif-${period}`} className="capitalize">
                        {period}
                      </Label>
                      <Input
                        id={`tarif-${period}`}
                        type="number"
                        step="10"
                        min="0"
                        value={form[period]}
                        onChange={(e) => set(period, e.target.value)}
                        aria-invalid={!!fieldErrors[`tariffs.${period}`]}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground/70">
                  Valeurs de demonstration, non officielles ANRE.
                </p>
              </fieldset>

              <Separator />

              {/* ------------------------------------------------- mode RAG */}
              <div className="space-y-2">
                <Label htmlFor="rag">Mode RAG</Label>
                <Select value={form.rag_mode} onValueChange={(v) => set("rag_mode", v as RagMode)}>
                  <SelectTrigger id="rag" aria-label="Mode de recherche documentaire">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(RAG_MODE_LABELS) as RagMode[]).map((m) => (
                      <SelectItem key={m} value={m}>
                        {RAG_MODE_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground/70">
                  En mode strict, un plan sans preuve suffisante declenche un repli et exige
                  une validation humaine.
                </p>
              </div>

              {submitError ? <ErrorState error={submitError} compact /> : null}

              <Button type="submit" className="w-full" size="lg" loading={submitting}>
                {!submitting ? <PlayCircle className="h-4 w-4" aria-hidden="true" /> : null}
                Lancer la simulation
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* --------------------------------------------------------- resultats */}
        <div className="min-w-0 space-y-6">
          {!cid ? (
            <Card>
              <CardContent className="p-6">
                <EmptyState
                  title="Aucun run en cours"
                  description="Renseignez les parametres a gauche puis lancez une simulation. La progression des 4 workflows s'affichera ici en temps reel."
                  icon={PlayCircle}
                />
              </CardContent>
            </Card>
          ) : (
            <>
              {/* -------------------------------------------------- stepper */}
              <Card>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
                  <div className="space-y-1">
                    <CardTitle>Progression de l&apos;orchestration</CardTitle>
                    <CardDescription>
                      Suivi en temps reel des 4 workflows (mise a jour toutes les 2 s).
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {run ? <RunStatusBadge status={run.status} /> : null}
                    {run ? <ScenarioBadge scenario={run.scenario} /> : null}
                    <CorrelationId value={cid} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <RunStepper run={run} />

                  {runError ? (
                    <ErrorState error={runError} onRetry={() => mutate()} />
                  ) : run?.status === "error" ? (
                    <div
                      role="alert"
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/[0.06] px-4 py-3"
                    >
                      <p className="text-sm text-red-200">
                        Le run s&apos;est interrompu. Consultez l&apos;etape en erreur ci-dessus,
                        puis relancez la simulation.
                      </p>
                      <Button size="sm" variant="outline" onClick={() => mutate()}>
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        Reessayer
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {/* ------------------------------------------------- synthese */}
              {run?.totals && run?.deficit_summary ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Synthese du deficit</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {[
                        {
                          label: "Deficit total",
                          value: `${fmtNumber(run.deficit_summary.total_deficit_mwh, 0)} MWh`,
                        },
                        {
                          label: "Heures en deficit",
                          value: `${run.deficit_summary.hours_in_deficit} h`,
                        },
                        {
                          label: "Pic de deficit",
                          value: `${fmtNumber(run.deficit_summary.peak_deficit_mw, 1)} MW`,
                        },
                        { label: "Cout total", value: fmtMAD(run.totals.total_cost) },
                      ].map((item) => (
                        <div key={item.label}>
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                            {item.label}
                          </dt>
                          <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                            {item.value}
                          </dd>
                        </div>
                      ))}
                    </dl>

                    <Separator className="my-4" />

                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
                      <span>
                        Part batterie :{" "}
                        <strong className="text-foreground">
                          {fmtPercent(run.totals.share_battery)}
                        </strong>
                      </span>
                      <span>
                        Part reseau :{" "}
                        <strong className="text-foreground">
                          {fmtPercent(run.totals.share_grid)}
                        </strong>
                      </span>
                      <span>
                        Part production :{" "}
                        <strong className="text-foreground">
                          {fmtPercent(run.totals.share_production)}
                        </strong>
                      </span>
                      <Badge
                        variant={
                          run.totals.protected_load_violations === 0 ? "success" : "danger"
                        }
                      >
                        {run.totals.protected_load_violations} violation(s) de charge protegee
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {/* ------------------------------------ inspecteur d'heure */}
              {inspected ? (
                <Card className="ring-1 ring-inset ring-emerald-500/25">
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <div className="space-y-1">
                      <CardTitle>
                        Inspecteur — H+{inspected.hour}{" "}
                        <span className="font-normal text-muted-foreground">
                          ({fmtHorizonHour(inspected.hour)})
                        </span>
                      </CardTitle>
                      <CardDescription>
                        Valeurs exactes a l&apos;heure selectionnee.
                      </CardDescription>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setSelectedHour(null)}
                      aria-label="Fermer l'inspecteur d'heure"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
                      {[
                        {
                          label: "Vent",
                          value: inspected.s ? `${fmtNumber(inspected.s.wind_ms)} m/s` : "—",
                        },
                        {
                          label: "Irradiance (GHI)",
                          value: inspected.s ? `${fmtNumber(inspected.s.ghi, 0)} W/m²` : "—",
                        },
                        {
                          label: "Production eolienne",
                          value: inspected.s ? `${fmtNumber(inspected.s.prod_wind_mw)} MW` : "—",
                        },
                        {
                          label: "Production solaire",
                          value: inspected.s ? `${fmtNumber(inspected.s.prod_solar_mw)} MW` : "—",
                        },
                        {
                          label: "Demande",
                          value: inspected.s ? `${fmtNumber(inspected.s.demand_mw)} MW` : "—",
                        },
                        {
                          label: "Deficit",
                          value: inspected.h ? `${fmtNumber(inspected.h.deficit_mw)} MW` : "—",
                        },
                        {
                          label: "SoC",
                          value: inspected.h ? fmtPercent(inspected.h.soc, 1) : "—",
                        },
                        {
                          label: "Dispatch batterie",
                          value: inspected.h
                            ? `${fmtNumber(inspected.h.dispatch_mw)} MW ${
                                inspected.h.dispatch_mw > 0
                                  ? "(decharge)"
                                  : inspected.h.dispatch_mw < 0
                                    ? "(charge)"
                                    : ""
                              }`
                            : "—",
                        },
                        {
                          label: "Achat reseau",
                          value: inspected.h ? `${fmtNumber(inspected.h.grid_mw)} MW` : "—",
                        },
                        {
                          label: "Cout horaire",
                          value: inspected.h ? fmtMAD(inspected.h.cost) : "—",
                        },
                        {
                          label: "Periode tarifaire",
                          value: inspected.h
                            ? TARIFF_PERIOD_LABELS[inspected.h.tariff_period]
                            : "—",
                        },
                      ].map((item) => (
                        <div key={item.label}>
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                            {item.label}
                          </dt>
                          <dd className="mt-1 font-mono text-sm tabular-nums text-foreground">
                            {item.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </CardContent>
                </Card>
              ) : null}

              {/* -------------------------------------------- les 6 graphes */}
              {runLoading && !hasResults ? (
                <div className="grid gap-6 lg:grid-cols-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Card key={i}>
                      <CardContent className="p-5">
                        <ChartSkeleton height={200} />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : hasResults ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Astuce : cliquez sur un point d&apos;un graphe pour inspecter l&apos;heure
                    correspondante.
                  </p>

                  <div className="grid gap-6 lg:grid-cols-2">
                    {/* 1. Vent */}
                    <ChartCard
                      title="Vitesse du vent"
                      description="Entree meteo de la prevision eolienne."
                      tableRows={series}
                      tableColumns={[
                        { key: "h", header: "Heure", cell: (r) => `H+${r.h}` },
                        { key: "v", header: "Vent (m/s)", cell: (r) => fmtNumber(r.wind_ms) },
                      ]}
                    >
                      <SingleSeriesChart
                        data={series}
                        dataKey="wind_ms"
                        name="Vent"
                        color={SERIES.vent}
                        unit="m/s"
                        windlessWindow={windlessWindow}
                        selectedHour={selectedHour}
                        onSelectHour={setSelectedHour}
                      />
                    </ChartCard>

                    {/* 2. Solaire */}
                    <ChartCard
                      title="Irradiance solaire (GHI)"
                      description="Entree meteo de la prevision photovoltaique."
                      tableRows={series}
                      tableColumns={[
                        { key: "h", header: "Heure", cell: (r) => `H+${r.h}` },
                        { key: "g", header: "GHI (W/m²)", cell: (r) => fmtNumber(r.ghi, 0) },
                      ]}
                    >
                      <SingleSeriesChart
                        data={series}
                        dataKey="ghi"
                        name="Irradiance"
                        color={SERIES.solaire}
                        unit="W/m²"
                        digits={0}
                        windlessWindow={windlessWindow}
                        selectedHour={selectedHour}
                        onSelectHour={setSelectedHour}
                      />
                    </ChartCard>

                    {/* 3. Demande */}
                    <ChartCard
                      title="Demande"
                      description="Consommation prevue sur l'horizon."
                      tableRows={series}
                      tableColumns={[
                        { key: "h", header: "Heure", cell: (r) => `H+${r.h}` },
                        { key: "d", header: "Demande (MW)", cell: (r) => fmtNumber(r.demand_mw) },
                      ]}
                    >
                      <SingleSeriesChart
                        data={series}
                        dataKey="demand_mw"
                        name="Demande"
                        color={SERIES.demande}
                        unit="MW"
                        windlessWindow={windlessWindow}
                        selectedHour={selectedHour}
                        onSelectHour={setSelectedHour}
                      />
                    </ChartCard>

                    {/* 4. Deficit — grandeur "mauvaise" => couleur de statut. */}
                    <ChartCard
                      title="Deficit"
                      description="Puissance manquante apres production disponible."
                      tableRows={hourly}
                      tableColumns={[
                        { key: "h", header: "Heure", cell: (r) => `H+${r.h}` },
                        {
                          key: "d",
                          header: "Deficit (MW)",
                          cell: (r) => fmtNumber(r.deficit_mw),
                        },
                      ]}
                    >
                      <SingleSeriesChart
                        data={hourly}
                        dataKey="deficit_mw"
                        name="Deficit"
                        color={DEFICIT_COLOR}
                        unit="MW"
                        windlessWindow={windlessWindow}
                        selectedHour={selectedHour}
                        onSelectHour={setSelectedHour}
                      />
                    </ChartCard>

                    {/* 5. SoC */}
                    <ChartCard
                      title="Etat de charge de la batterie (SoC)"
                      description="Le seuil SoC min est materialise par une ligne de reference."
                      tableRows={hourly}
                      tableColumns={[
                        { key: "h", header: "Heure", cell: (r) => `H+${r.h}` },
                        { key: "s", header: "SoC", cell: (r) => fmtPercent(r.soc, 1) },
                        {
                          key: "disp",
                          header: "Dispatch (MW)",
                          cell: (r) => fmtNumber(r.dispatch_mw),
                        },
                      ]}
                    >
                      <SingleSeriesChart
                        data={hourly}
                        dataKey="soc"
                        name="SoC"
                        color={SERIES.batterie}
                        digits={2}
                        domain={[0, 1]}
                        windlessWindow={windlessWindow}
                        selectedHour={selectedHour}
                        onSelectHour={setSelectedHour}
                        referenceLine={
                          params
                            ? {
                                y: params.battery.soc_min,
                                label: `SoC min ${fmtPercent(params.battery.soc_min, 0)}`,
                              }
                            : undefined
                        }
                      />
                    </ChartCard>

                    {/* 6. Cout cumule */}
                    <ChartCard
                      title="Cout cumule"
                      description="Tarifs de demonstration, non officiels ANRE."
                      tableRows={costSeries}
                      tableColumns={[
                        { key: "h", header: "Heure", cell: (r) => `H+${r.h}` },
                        {
                          key: "c",
                          header: "Cout cumule (MAD)",
                          cell: (r) => fmtNumber(r.cumulative_cost, 0),
                        },
                      ]}
                    >
                      <SingleSeriesChart
                        data={costSeries}
                        dataKey="cumulative_cost"
                        name="Cout cumule"
                        color={SERIES.cout}
                        unit="MAD"
                        digits={0}
                        area={false}
                        selectedHour={selectedHour}
                        onSelectHour={setSelectedHour}
                      />
                    </ChartCard>
                  </div>

                  {/* ------------------------ comparaison naif vs look-ahead */}
                  {comparison ? (
                    <ChartCard
                      title="Comparaison — strategie naive vs look-ahead"
                      description="La strategie naive decharge la batterie des le premier deficit, sans anticiper les heures de pointe. Le look-ahead (WF-2) arbitre dans le temps."
                      tableRows={comparison.points}
                      tableColumns={[
                        { key: "h", header: "Heure", cell: (r) => `H+${r.h}` },
                        {
                          key: "n",
                          header: "Naif (MAD)",
                          cell: (r) => fmtNumber(r.naive_cost, 0),
                        },
                        {
                          key: "l",
                          header: "Look-ahead (MAD)",
                          cell: (r) => fmtNumber(r.lookahead_cost, 0),
                        },
                      ]}
                    >
                      <div className="space-y-4">
                        <dl className="grid gap-4 sm:grid-cols-3">
                          <div>
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                              Cout — strategie naive
                            </dt>
                            <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                              {fmtMAD(comparison.naive_total)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                              Cout — look-ahead
                            </dt>
                            <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-300">
                              {fmtMAD(comparison.lookahead_total)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                              Economie
                            </dt>
                            <dd
                              className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
                                comparison.savings >= 0 ? "text-emerald-300" : "text-red-300"
                              }`}
                            >
                              {fmtMAD(comparison.savings)}{" "}
                              <span className="text-sm font-normal text-muted-foreground">
                                ({fmtPercent(comparison.savings_ratio, 1)})
                              </span>
                            </dd>
                          </div>
                        </dl>
                        <NaiveVsLookaheadChart data={comparison.points} />
                      </div>
                    </ChartCard>
                  ) : hasResults ? (
                    <Card>
                      <CardContent className="p-5">
                        <p className="text-sm text-muted-foreground">
                          La comparaison naif vs look-ahead necessite les parametres de batterie
                          et de tarifs du run. Ils ne sont pas disponibles pour ce run (lance
                          depuis un autre navigateur ou stockage local vide). Relancez une
                          simulation depuis ce poste pour l&apos;afficher.
                        </p>
                      </CardContent>
                    </Card>
                  ) : null}
                </>
              ) : isRunning ? (
                <Card>
                  <CardContent className="p-6">
                    <EmptyState
                      title="Simulation en cours"
                      description="Les previsions et le dispatch s'afficheront des que les workflows WF-1 et WF-2 auront termine."
                      icon={Gauge}
                    />
                  </CardContent>
                </Card>
              ) : run && !isApiError(runError) ? (
                <Card>
                  <CardContent className="p-6">
                    <EmptyState
                      title="Aucun resultat pour ce run"
                      description="Le run ne contient ni serie ni dispatch horaire."
                      icon={Wind}
                    />
                  </CardContent>
                </Card>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * `useSearchParams()` (parametre `?cid=`) impose une frontiere Suspense.
 */
export default function SimulationPage() {
  return (
    <React.Suspense fallback={<TableSkeleton rows={6} cols={3} />}>
      <SimulationView />
    </React.Suspense>
  );
}
