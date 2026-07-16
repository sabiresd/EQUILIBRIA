"use client";

import * as React from "react";
import { BatteryCharging, Droplets, Sun, Thermometer, Wind } from "lucide-react";

import { cn, fmtNumber } from "@/lib/utils";
import type { Telemetrie } from "@/lib/api";

/**
 * Panneaux d'IHM industrielle (style SCADA) : un pave dense par machine.
 *
 * Trois regles tenues ici :
 *   - la COULEUR vient du backend (champ `couleur`), jamais recalculee ici ;
 *   - aucune information n'est portee par la seule couleur — chaque voyant a
 *     son libelle, chaque jauge son chiffre (daltonisme, ecrans en plein jour) ;
 *   - rien n'est decoratif : la boussole et l'humidite sont des mesures NASA
 *     reellement ingerees, pas des aiguilles qui bougent pour faire joli.
 */

const POINTS: Record<string, string> = {
  vert: "bg-emerald-500",
  orange: "bg-orange-500",
  jaune: "bg-yellow-400",
  rouge: "bg-danger",
  gris: "bg-muted-foreground/50",
};

/* ------------------------------------------------------------------ voyants */

/** Voyant d'etat : allume = plein + halo, eteint = cercle creux. */
function Voyant({ label, actif, ton }: { label: string; actif: boolean; ton: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={cn(
          "h-3.5 w-3.5 rounded-full border transition-all",
          actif ? cn(ton, "border-transparent shadow-[0_0_8px_currentColor]") : "border-hairline/25 bg-hairline/[0.04]",
        )}
        role="img"
        aria-label={`${label} : ${actif ? "actif" : "inactif"}`}
      />
    </div>
  );
}

function RangeeVoyants({ e }: { e: Telemetrie }) {
  const batterie = e.type === "batterie";
  const enMarche = batterie
    ? e.etat === "charge" || e.etat === "decharge"
    : e.etat === "production";
  const arret = batterie
    ? e.etat === "repos"
    : e.etat === "arret_vent_faible" || e.etat === "arret_securite";
  const defaut = batterie ? e.etat === "hors_service" : e.etat === "defaut" || e.etat === "maintenance";

  return (
    <div className="flex items-start justify-around rounded-md border border-hairline/[0.07] bg-hairline/[0.02] px-1 py-1.5">
      <Voyant label={batterie ? "Actif" : "Running"} actif={enMarche} ton="bg-emerald-500 text-emerald-500" />
      <Voyant label="Stop" actif={arret} ton="bg-yellow-400 text-yellow-400" />
      <Voyant label={batterie ? "Panne" : "Faulted"} actif={defaut} ton="bg-danger text-danger" />
    </div>
  );
}

/* -------------------------------------------------------------------- jauge */

/** Jauge en arc (240 deg). Le chiffre est TOUJOURS ecrit au centre : un arc seul
 *  ne se lit pas au dixieme pres. */
function Cadran({ pct, label, valeur, ton }: { pct: number; label: string; valeur: string; ton: string }) {
  const p = Math.min(100, Math.max(0, pct));
  const R = 26;
  const circonference = 2 * Math.PI * R;
  const arc = circonference * 0.66; // 240 deg utiles
  const rempli = (p / 100) * arc;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-[120deg]" role="img" aria-label={`${label} : ${valeur}`}>
        <circle
          cx="32" cy="32" r={R} fill="none" strokeWidth="6" strokeLinecap="round"
          className="stroke-hairline/[0.1]" strokeDasharray={`${arc} ${circonference}`}
        />
        <circle
          cx="32" cy="32" r={R} fill="none" strokeWidth="6" strokeLinecap="round"
          className={ton} strokeDasharray={`${rempli} ${circonference}`}
        />
      </svg>
      <p className="-mt-11 font-mono text-sm font-semibold tabular-nums text-foreground">{valeur}</p>
      <p className="mt-5 text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

/* ----------------------------------------------------------------- boussole */

/** Rose des vents. L'aiguille pointe d'ou vient le vent (convention meteo). */
function Boussole({ deg, vitesse }: { deg: number; vitesse: number }) {
  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 48 48"
        className="h-14 w-14"
        role="img"
        aria-label={`Vent de ${fmtNumber(deg, 0)} degres, ${fmtNumber(vitesse, 1)} metres par seconde`}
      >
        <circle cx="24" cy="24" r="21" className="fill-hairline/[0.03] stroke-hairline/[0.12]" strokeWidth="1" />
        {["N", "E", "S", "O"].map((c, i) => (
          <text
            key={c}
            x={24 + 16 * Math.sin((i * Math.PI) / 2)}
            y={24 - 16 * Math.cos((i * Math.PI) / 2) + 3}
            textAnchor="middle"
            className="fill-muted-foreground text-[7px]"
          >
            {c}
          </text>
        ))}
        <g transform={`rotate(${deg} 24 24)`}>
          <path d="M24 9 L27.5 26 L24 23 L20.5 26 Z" className="fill-info" />
        </g>
        <circle cx="24" cy="24" r="2" className="fill-muted-foreground" />
      </svg>
      <p className="font-mono text-[10px] tabular-nums text-muted-foreground">{fmtNumber(deg, 0)}°</p>
    </div>
  );
}

/* ---------------------------------------------------------------- sparkline */

/** Courbe de tendance. Sans axes : elle dit la FORME (monte/descend/plat), le
 *  chiffre exact est juste a cote. */
function Sparkline({ points, ton }: { points: number[]; ton: string }) {
  if (points.length < 2) return <div className="h-8" />;
  const max = Math.max(...points, 0.0001);
  const min = Math.min(...points, 0);
  const etendue = max - min || 1;
  const d = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 28 - ((v - min) / etendue) * 26;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full" aria-hidden="true">
      <path d={`${d} L100,30 L0,30 Z`} className={cn(ton, "opacity-15")} fill="currentColor" stroke="none" />
      <path d={d} fill="none" strokeWidth="1.5" className={ton} stroke="currentColor" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ------------------------------------------------------------------ mesures */

function Mini({ icone: Icone, valeur, unite }: { icone: typeof Wind; valeur: string; unite: string }) {
  return (
    <div className="flex items-center gap-1 rounded border border-hairline/[0.06] bg-hairline/[0.02] px-1.5 py-1">
      <Icone className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="font-mono text-[11px] tabular-nums text-foreground">{valeur}</span>
      <span className="text-[9px] text-muted-foreground">{unite}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ panneau */

export function PanneauEquipement({
  e,
  historique = [],
  onClick,
}: {
  e: Telemetrie;
  historique?: number[];
  onClick: () => void;
}) {
  const batterie = e.type === "batterie";
  const solaire = e.type === "solaire";
  const Icone = batterie ? BatteryCharging : solaire ? Sun : Wind;
  const point = POINTS[e.couleur ?? "gris"] ?? POINTS.gris;

  // Jauge : SoC pour une batterie, taux de charge sinon.
  const pct = batterie ? (e.soc_pct ?? 0) : (e.charge_pct ?? 0);
  const tonJauge = batterie
    ? e.couleur === "jaune"
      ? "stroke-yellow-400"
      : e.couleur === "orange"
        ? "stroke-orange-500"
        : "stroke-emerald-500"
    : e.couleur === "rouge"
      ? "stroke-danger"
      : e.couleur === "gris"
        ? "stroke-muted-foreground/50"
        : "stroke-emerald-500";

  const nominal = batterie ? (e.p_max_mw ?? 0) : (e.puissance_nominale_mw ?? 0);
  const remplissage = nominal > 0 ? Math.min(100, (Math.abs(e.puissance_mw) / nominal) * 100) : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${e.nom}, ${e.etat}. Voir le detail.`}
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg border border-hairline/[0.09] bg-base-800/70 p-2 text-left",
        "transition-colors hover:border-hairline/20 hover:bg-base-700/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      {/* Bandeau : identite + pastille d'etat */}
      <div className="flex items-center gap-1.5 border-b border-hairline/[0.07] pb-1.5">
        <Icone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-foreground">
          {e.equipement_id}
        </span>
        <span className={cn("h-2 w-2 shrink-0 rounded-full", point)} aria-hidden="true" />
      </div>

      <RangeeVoyants e={e} />

      {/* Jauge + boussole (la boussole n'a de sens que pour une eolienne) */}
      <div className="flex items-center justify-around">
        <Cadran
          pct={pct}
          label={batterie ? "SoC" : "Charge"}
          valeur={`${fmtNumber(pct, 0)}%`}
          ton={tonJauge}
        />
        {!batterie && !solaire ? (
          <Boussole deg={e.vent_direction_deg ?? 0} vitesse={e.vent_nacelle_ms ?? 0} />
        ) : null}
      </div>

      {/* Meteo / mesures — vraies valeurs NASA */}
      <div className="grid grid-cols-2 gap-1">
        <Mini icone={Thermometer} valeur={fmtNumber(batterie ? (e.temperature_c ?? 0) : (e.temperature_c ?? e.temperature_nacelle_c ?? 0), 0)} unite="°C" />
        {batterie ? (
          <Mini icone={BatteryCharging} valeur={fmtNumber(e.soh_pct ?? 100, 0)} unite="SoH%" />
        ) : solaire ? (
          <Mini icone={Sun} valeur={fmtNumber(e.irradiance_wm2 ?? 0, 0)} unite="W/m²" />
        ) : (
          <Mini icone={Wind} valeur={fmtNumber(e.vent_nacelle_ms ?? 0, 1)} unite="m/s" />
        )}
        {batterie ? (
          <Mini icone={BatteryCharging} valeur={fmtNumber(e.energie_stockee_mwh ?? 0, 1)} unite="MWh" />
        ) : (
          <Mini icone={Droplets} valeur={fmtNumber(e.humidite_pct ?? 0, 0)} unite="%HR" />
        )}
        <Mini icone={Wind} valeur={fmtNumber(nominal, 2)} unite="MW max" />
      </div>

      {/* Production : chiffre, barre, tendance */}
      <div className="rounded-md border border-hairline/[0.06] bg-hairline/[0.02] p-1.5">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-xl font-semibold tabular-nums text-foreground">
            {fmtNumber(e.puissance_mw, 3)}
          </span>
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">MW</span>
        </div>
        <div className="my-1 h-1 overflow-hidden rounded-full bg-hairline/[0.08]">
          <div
            className={cn("h-full rounded-full", e.puissance_mw < 0 ? "bg-info" : "bg-emerald-500")}
            style={{ width: `${remplissage}%` }}
          />
        </div>
        <Sparkline points={historique} ton="text-info" />
      </div>
    </button>
  );
}
