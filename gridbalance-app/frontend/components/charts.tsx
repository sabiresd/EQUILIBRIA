"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Table2, LineChart as LineChartIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CHART, CHART_LIGHT, axisProps, dayTicks } from "@/lib/chart-theme";
import { cn, fmtHorizonHour, fmtNumber } from "@/lib/utils";

/**
 * Chrome du graphique accorde au theme.
 *
 * La source de verite est la classe `dark` de <html> (posee par le bouton de
 * bascule) : on l'observe pour repeindre grille, axes et curseur au clic. Les
 * couleurs de SERIES, elles, ne bougent jamais — la couleur suit l'entite.
 */
function useChartChrome() {
  const [dark, setDark] = React.useState(true);

  React.useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark ? CHART : CHART_LIGHT;
}

/* -------------------------------------------------------------------------- */
/*                                  Ossature                                   */
/* -------------------------------------------------------------------------- */

export type TableColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
};

/**
 * Carte de graphique avec sa JUMELLE TABLEAU (accessibilite : aucune valeur
 * n'est accessible uniquement par la couleur ou uniquement par l'infobulle).
 */
export function ChartCard<T>({
  title,
  description,
  children,
  tableRows,
  tableColumns,
  tableSample = 6,
  className,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  tableRows?: T[];
  tableColumns?: TableColumn<T>[];
  /** N'affiche qu'une ligne sur N dans la vue tableau (360 h => 60 lignes). */
  tableSample?: number;
  className?: string;
  action?: React.ReactNode;
}) {
  const [view, setView] = React.useState<"chart" | "table">("chart");
  const hasTable = !!tableRows && !!tableColumns && tableColumns.length > 0;

  const sampled = React.useMemo(() => {
    if (!tableRows) return [];
    return tableRows.filter((_, i) => i % tableSample === 0);
  }, [tableRows, tableSample]);

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {hasTable ? (
            <button
              type="button"
              onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
              aria-pressed={view === "table"}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline/12 px-2.5 text-xs text-muted-foreground",
                "transition-colors hover:bg-hairline/[0.06] hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              {view === "chart" ? (
                <>
                  <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Donnees
                </>
              ) : (
                <>
                  <LineChartIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  Graphique
                </>
              )}
            </button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent>
        {view === "chart" || !hasTable ? (
          children
        ) : (
          <div className="max-h-[340px] overflow-y-auto rounded-lg border border-hairline/[0.06]">
            <Table>
              <TableHeader className="sticky top-0 bg-base-800">
                <TableRow>
                  {tableColumns!.map((c) => (
                    <TableHead key={c.key}>{c.header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sampled.map((row, i) => (
                  <TableRow key={i}>
                    {tableColumns!.map((c) => (
                      <TableCell key={c.key} className="font-mono text-xs tabular-nums">
                        {c.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="border-t border-hairline/[0.06] px-4 py-2 text-xs text-muted-foreground">
              Echantillonnage : une ligne toutes les {tableSample} heures.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Infobulle                                  */
/* -------------------------------------------------------------------------- */

type TooltipEntry = {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
};

function GridTooltip({
  active,
  payload,
  label,
  unit,
  digits = 1,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: number | string;
  unit?: string;
  digits?: number;
}) {
  if (!active || !payload?.length) return null;
  const h = typeof label === "number" ? label : Number(label);

  return (
    <div className="rounded-lg border border-hairline/12 bg-base-900/95 px-3 py-2 shadow-panel backdrop-blur">
      <p className="mb-1.5 text-xs font-semibold text-foreground">
        H+{h} <span className="font-normal text-muted-foreground">· {fmtHorizonHour(h)}</span>
      </p>
      <ul className="space-y-1">
        {payload.map((entry, i) => (
          <li key={i} className="flex items-center justify-between gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
                aria-hidden="true"
              />
              {entry.name}
            </span>
            <span className="font-mono tabular-nums text-foreground">
              {typeof entry.value === "number" ? fmtNumber(entry.value, digits) : entry.value}
              {unit ? ` ${unit}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                            Graphe principal (360 h)                         */
/* -------------------------------------------------------------------------- */

export type MainPoint = {
  h: number;
  prod_total_mw: number;
  prod_wind_mw: number;
  prod_solar_mw: number;
  demand_mw: number;
};

/**
 * Production vs demande sur 360 h, avec la FENETRE SANS VENT surlignee
 * (ReferenceArea). Une seule echelle Y — jamais de double axe.
 */
export function ProductionDemandChart({
  data,
  windlessWindow,
  height = 320,
  onSelectHour,
}: {
  data: MainPoint[];
  windlessWindow?: { start_h: number; end_h: number } | null;
  height?: number;
  onSelectHour?: (h: number) => void;
}) {
  // Chrome accorde au theme (grille, axes, curseur). Masque volontairement
  // l'import du meme nom : les usages `CHART.*` ci-dessous suivent le theme.
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const CHART = useChartChrome();
  const maxH = data.length ? data[data.length - 1].h : 359;

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <AreaChart
          data={data}
          margin={{ top: 8, right: 12, left: 4, bottom: 28 }}
          onClick={(state: { activeLabel?: string | number }) => {
            if (!onSelectHour || state?.activeLabel === undefined) return;
            onSelectHour(Number(state.activeLabel));
          }}
        >
          <defs>
            <linearGradient id="gradWind" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3987e5" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#3987e5" stopOpacity={0.06} />
            </linearGradient>
            <linearGradient id="gradSolar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c98500" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#c98500" stopOpacity={0.06} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke={CHART.grid} vertical={false} />

          <XAxis
            dataKey="h"
            type="number"
            domain={[0, maxH]}
            ticks={dayTicks(maxH)}
            tickFormatter={(h: number) => `J+${Math.floor(h / 24)}`}
            {...axisProps(CHART)}
            label={{
              value: "Horizon — 360 h (15 jours)",
              position: "insideBottom",
              offset: -18,
              fill: CHART.muted,
              fontSize: 11,
            }}
          />
          <YAxis
            {...axisProps(CHART)}
            width={54}
            label={{
              value: "MW",
              angle: -90,
              position: "insideLeft",
              fill: CHART.muted,
              fontSize: 11,
            }}
          />

          {/* FENETRE SANS VENT — le coeur du produit. */}
          {windlessWindow ? (
            <ReferenceArea
              x1={windlessWindow.start_h}
              x2={windlessWindow.end_h}
              fill={CHART.windlessFill}
              stroke={CHART.windlessStroke}
              strokeDasharray="0"
              ifOverflow="extendDomain"
              label={{
                value: "Fenetre sans vent",
                position: "insideTop",
                fill: "#fab219",
                fontSize: 11,
                offset: 10,
              }}
            />
          ) : null}

          <Tooltip
            content={<GridTooltip unit="MW" />}
            cursor={{ stroke: CHART.cursor, strokeWidth: 1 }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="plainline"
            wrapperStyle={{ paddingBottom: 8, fontSize: 12, color: CHART.muted }}
          />

          {/* Production empilee : eolien + solaire. Filets de 2 px. */}
          <Area
            type="monotone"
            dataKey="prod_wind_mw"
            name="Production eolienne"
            stackId="prod"
            stroke="#3987e5"
            strokeWidth={2}
            fill="url(#gradWind)"
            isAnimationActive={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }}
          />
          <Area
            type="monotone"
            dataKey="prod_solar_mw"
            name="Production solaire"
            stackId="prod"
            stroke="#c98500"
            strokeWidth={2}
            fill="url(#gradSolar)"
            isAnimationActive={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }}
          />
          {/* Demande : ligne, jamais empilee. */}
          <Area
            type="monotone"
            dataKey="demand_mw"
            name="Demande"
            stroke="#9085e9"
            strokeWidth={2}
            fill="none"
            isAnimationActive={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                          Graphe a serie unique                              */
/* -------------------------------------------------------------------------- */

/**
 * Une serie, une couleur. Pas de legende (le titre nomme la serie).
 * Le clic sur un point remonte l'heure (inspecteur d'heure).
 */
export function SingleSeriesChart<T extends { h: number }>({
  data,
  dataKey,
  name,
  color,
  unit,
  digits = 1,
  height = 200,
  area = true,
  domain,
  onSelectHour,
  selectedHour,
  windlessWindow,
  referenceLine,
}: {
  data: T[];
  dataKey: keyof T & string;
  name: string;
  color: string;
  unit?: string;
  digits?: number;
  height?: number;
  area?: boolean;
  domain?: [number | "auto", number | "auto"];
  onSelectHour?: (h: number) => void;
  selectedHour?: number | null;
  windlessWindow?: { start_h: number; end_h: number } | null;
  referenceLine?: { y: number; label: string; color?: string };
}) {
  // eslint-disable-next-line @typescript-eslint/no-shadow -- chrome du theme
  const CHART = useChartChrome();
  const maxH = data.length ? data[data.length - 1].h : 359;
  const gradId = `grad-${dataKey}-${color.replace("#", "")}`;

  const common = (
    <>
      <CartesianGrid stroke={CHART.grid} vertical={false} />
      <XAxis
        dataKey="h"
        type="number"
        domain={[0, maxH]}
        ticks={dayTicks(maxH, 48)}
        tickFormatter={(h: number) => `J+${Math.floor(h / 24)}`}
        {...axisProps(CHART)}
      />
      <YAxis {...axisProps(CHART)} width={48} domain={domain ?? ["auto", "auto"]} />
      {windlessWindow ? (
        <ReferenceArea
          x1={windlessWindow.start_h}
          x2={windlessWindow.end_h}
          fill={CHART.windlessFill}
          stroke={CHART.windlessStroke}
          ifOverflow="extendDomain"
        />
      ) : null}
      {referenceLine ? (
        <ReferenceLine
          y={referenceLine.y}
          stroke={referenceLine.color ?? CHART.windlessStroke}
          strokeWidth={1}
          label={{
            value: referenceLine.label,
            position: "insideTopRight",
            fill: referenceLine.color ?? "#fab219",
            fontSize: 10,
          }}
        />
      ) : null}
      {selectedHour != null ? (
        <ReferenceLine x={selectedHour} stroke={CHART.cursor} strokeWidth={1} />
      ) : null}
      <Tooltip
        content={<GridTooltip unit={unit} digits={digits} />}
        cursor={{ stroke: CHART.cursor, strokeWidth: 1 }}
      />
    </>
  );

  const handleClick = (state: { activeLabel?: string | number }) => {
    if (!onSelectHour || state?.activeLabel === undefined) return;
    onSelectHour(Number(state.activeLabel));
  };

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        {area ? (
          <AreaChart
            data={data}
            margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
            onClick={handleClick}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                <stop offset="100%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            {common}
            <Area
              type="monotone"
              dataKey={dataKey}
              name={name}
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradId})`}
              isAnimationActive={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }}
            />
          </AreaChart>
        ) : (
          <LineChart
            data={data}
            margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
            onClick={handleClick}
          >
            {common}
            <Line
              type="monotone"
              dataKey={dataKey}
              name={name}
              stroke={color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                      Comparaison naif vs look-ahead                         */
/* -------------------------------------------------------------------------- */

export type ComparisonPoint = {
  h: number;
  naive_cost: number;
  lookahead_cost: number;
};

/**
 * Cout cumule : strategie naive (decharge gloutonne) vs look-ahead (WF-2).
 * Deux series de MEME unite (MAD) => un seul axe Y. Jamais de double axe.
 */
export function NaiveVsLookaheadChart({
  data,
  height = 240,
}: {
  data: ComparisonPoint[];
  height?: number;
}) {
  // eslint-disable-next-line @typescript-eslint/no-shadow -- chrome du theme
  const CHART = useChartChrome();
  const maxH = data.length ? data[data.length - 1].h : 359;

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey="h"
            type="number"
            domain={[0, maxH]}
            ticks={dayTicks(maxH, 48)}
            tickFormatter={(h: number) => `J+${Math.floor(h / 24)}`}
            {...axisProps(CHART)}
          />
          <YAxis
            {...axisProps(CHART)}
            width={70}
            tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
            label={{
              value: "MAD cumules",
              angle: -90,
              position: "insideLeft",
              fill: CHART.muted,
              fontSize: 11,
            }}
          />
          <Tooltip
            content={<GridTooltip unit="MAD" digits={0} />}
            cursor={{ stroke: CHART.cursor, strokeWidth: 1 }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="plainline"
            wrapperStyle={{ paddingBottom: 8, fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey="naive_cost"
            name="Strategie naive"
            stroke="#3987e5"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="lookahead_cost"
            name="Look-ahead (WF-2)"
            stroke="#12a56c"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
