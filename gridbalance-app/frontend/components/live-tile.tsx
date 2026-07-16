"use client";

/**
 * Tuile temps reel : rejeu accelere de Data2023 (1 h simulee = 1 s reelle).
 * L'heure courante et la fenetre recente viennent de /api/live ; le point pulse
 * a chaque tick. C'est ce qui rend le dashboard vivant au lieu de statique.
 */
import * as React from "react";
import { Wind, Sun, Gauge, Zap } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { useLive } from "@/lib/hooks";
import { cn, fmtNumber } from "@/lib/utils";

const PERIOD_LABEL: Record<string, string> = {
  creuse: "Heures creuses",
  normale: "Heures normales",
  pointe: "Heures de pointe",
};
const PERIOD_COLOR: Record<string, string> = {
  creuse: "text-sky-400",
  normale: "text-emerald-400",
  pointe: "text-amber-400",
};

function Sparkline({
  prod,
  demand,
}: {
  prod: number[];
  demand: number[];
}) {
  const all = [...prod, ...demand];
  if (all.length < 2) return null;
  const max = Math.max(...all, 0.1);
  const W = 260;
  const H = 48;
  const line = (arr: number[]) =>
    arr
      .map((v, i) => {
        const x = (i / (arr.length - 1)) * W;
        const y = H - (v / max) * (H - 4) - 2;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-full" preserveAspectRatio="none">
      <path d={line(demand)} fill="none" stroke="#a78bfa" strokeWidth="1.5" opacity="0.9" />
      <path d={line(prod)} fill="none" stroke="#34d399" strokeWidth="1.5" />
    </svg>
  );
}

export function LiveTile() {
  const { live, error } = useLive(48);
  const c = live?.current;

  if (error && !live) return null; // discret : la tuile n'empeche pas le reste

  const net = c?.net_balance_mw ?? 0;
  const deficit = net < 0;
  // Affichage "comme maintenant" : on utilise display_ts (temps projete sur l'instant
  // present) plutot que ts_utc (la date 2023 d'origine des donnees).
  const stamp = c?.display_ts ?? c?.ts_utc ?? null;
  const simDate = stamp ? new Date(stamp) : null;
  const dateLabel = simDate
    ? simDate.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })
    : "—";
  const hourLabel = simDate
    ? simDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "--:--";

  return (
    <Card className="mb-6 overflow-hidden border-emerald-500/20">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Etat live + horloge simulee */}
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span
                className={cn(
                  "absolute inline-flex h-full w-full rounded-full opacity-75",
                  live?.paused ? "bg-slate-400" : "animate-ping bg-emerald-400",
                )}
              />
              <span
                className={cn(
                  "relative inline-flex h-2.5 w-2.5 rounded-full",
                  live?.paused ? "bg-slate-400" : "bg-emerald-400",
                )}
              />
            </span>
            <div>
              <p className="text-xs uppercase tracking-wide text-hairline/50">
                Reseau en temps reel {live?.paused ? "· en pause" : `· x${fmtNumber(live?.speed ?? 1, 0)}`}
              </p>
              <p className="font-mono text-lg font-semibold tabular-nums">
                {dateLabel} · {hourLabel}
              </p>
            </div>
          </div>

          {/* Solde net : le chiffre qui bouge */}
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-hairline/50">
              {deficit ? "Deficit instantane" : "Marge de production"}
            </p>
            <p
              className={cn(
                "font-mono text-2xl font-bold tabular-nums",
                deficit ? "text-amber-400" : "text-emerald-400",
              )}
            >
              {net >= 0 ? "+" : ""}
              {fmtNumber(net, 2)} MW
            </p>
          </div>
        </div>

        {/* Sparkline production vs demande */}
        <div className="mt-4">
          <Sparkline
            prod={(live?.history ?? []).map((p) => p.prod_total_mw)}
            demand={(live?.history ?? []).map((p) => p.demand_mw)}
          />
          <div className="mt-1 flex justify-between text-[11px] text-hairline/40">
            <span>
              <span className="text-emerald-400">—</span> production &nbsp;
              <span className="text-violet-400">—</span> demande &nbsp;(48 dernieres heures)
            </span>
            <span className={PERIOD_COLOR[c?.tariff_period ?? "normale"]}>
              {PERIOD_LABEL[c?.tariff_period ?? "normale"]} · {fmtNumber(c?.tariff_mad_kwh ?? 0, 2)} MAD/kWh
            </span>
          </div>
        </div>

        {/* Detail instantane */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric icon={<Zap className="h-4 w-4" />} label="Production" value={`${fmtNumber(c?.prod_total_mw, 2)} MW`} />
          <Metric icon={<Gauge className="h-4 w-4" />} label="Demande" value={`${fmtNumber(c?.demand_mw, 2)} MW`} />
          <Metric icon={<Wind className="h-4 w-4" />} label="Vent" value={`${fmtNumber(c?.wind_ms, 1)} m/s`} />
          <Metric icon={<Sun className="h-4 w-4" />} label="Irradiance" value={`${fmtNumber(c?.ghi, 0)} W/m2`} />
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-hairline/[0.06] bg-hairline/[0.02] px-3 py-2">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-hairline/45">
        <span className="text-emerald-400/70">{icon}</span>
        {label}
      </p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
