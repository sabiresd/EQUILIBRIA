"use client";

import * as React from "react";
import { BatteryCharging, Sun, Wind } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn, fmtNumber } from "@/lib/utils";
import type { Telemetrie } from "@/lib/api";

/**
 * Code couleur des equipements.
 *
 * La couleur est calculee par le SCADA (champ `couleur`), pas ici : deux ecrans
 * ne peuvent donc pas diverger. Le frontend ne fait que peindre.
 *
 * Chaque pastille est TOUJOURS doublee d'un libelle : une information portee par
 * la seule couleur serait perdue pour un daltonien — et orange/rouge/jaune sont
 * precisement la triade la plus confondue.
 */
export const COULEURS: Record<string, { point: string; carte: string; texte: string; libelle: string }> = {
  vert: {
    point: "bg-emerald-500",
    carte: "border-emerald-500/40 bg-emerald-500/[0.07] hover:bg-emerald-500/[0.12]",
    texte: "text-emerald-400",
    libelle: "Bon etat",
  },
  orange: {
    point: "bg-orange-500",
    carte: "border-orange-500/40 bg-orange-500/[0.07] hover:bg-orange-500/[0.12]",
    texte: "text-orange-400",
    libelle: "En decharge",
  },
  jaune: {
    point: "bg-yellow-400",
    carte: "border-yellow-400/40 bg-yellow-400/[0.07] hover:bg-yellow-400/[0.12]",
    texte: "text-yellow-400",
    libelle: "A surveiller",
  },
  rouge: {
    point: "bg-danger",
    carte: "border-danger/40 bg-danger/[0.07] hover:bg-danger/[0.12]",
    texte: "text-danger",
    libelle: "A l'arret",
  },
  gris: {
    point: "bg-muted-foreground/60",
    carte: "border-hairline/12 bg-hairline/[0.03] hover:bg-hairline/[0.06]",
    texte: "text-muted-foreground",
    libelle: "Desactive",
  },
};

const ETATS: Record<string, string> = {
  production: "En production",
  arret_vent_faible: "Arret — vent faible",
  arret_securite: "Arret securite — vent fort",
  maintenance: "Maintenance",
  defaut: "Defaut",
  decharge: "En decharge",
  charge: "En charge",
  repos: "Au repos",
  hors_service: "Hors service",
  nuit: "Nuit",
};

export function libelleEtat(etat: string): string {
  return ETATS[etat] ?? etat;
}

function couleurDe(e: Telemetrie) {
  return COULEURS[e.couleur ?? "gris"] ?? COULEURS.gris;
}

/** Legende : sans elle, le code couleur n'est qu'une devinette. */
export function LegendeCouleurs() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {(["vert", "orange", "jaune", "rouge", "gris"] as const).map((c) => (
        <span key={c} className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", COULEURS[c].point)} aria-hidden="true" />
          {COULEURS[c].libelle}
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Carte compacte                                 */
/* -------------------------------------------------------------------------- */

export function CarteEquipement({ e, onClick }: { e: Telemetrie; onClick: () => void }) {
  const c = couleurDe(e);
  const Icone = e.type === "batterie" ? BatteryCharging : e.type === "solaire" ? Sun : Wind;
  const mesure = e.type === "batterie" ? `${fmtNumber(e.soc_pct ?? 0, 0)} %` : `${fmtNumber(e.charge_pct ?? 0, 0)} %`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${e.nom} — ${c.libelle}, ${libelleEtat(e.etat)}. Voir le detail.`}
      className={cn(
        "group flex w-full flex-col gap-2 rounded-xl border p-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        c.carte,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate font-mono text-xs text-foreground">{e.equipement_id}</span>
        </span>
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", c.point)} aria-hidden="true" />
      </div>

      <p className="font-mono text-xl font-semibold tabular-nums text-foreground">
        {fmtNumber(e.puissance_mw, 3)}
        <span className="ml-1 text-xs font-normal text-muted-foreground">MW</span>
      </p>

      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("truncate text-xs", c.texte)}>{libelleEtat(e.etat)}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{mesure}</span>
      </div>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*                            Detail (au clic)                                 */
/* -------------------------------------------------------------------------- */

function Mesure({ label, valeur, unite, aide }: { label: string; valeur: string; unite?: string; aide?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-lg tabular-nums text-foreground">
        {valeur}
        {unite ? <span className="ml-1 text-xs font-normal text-muted-foreground">{unite}</span> : null}
      </p>
      {aide ? <p className="text-xs text-muted-foreground">{aide}</p> : null}
    </div>
  );
}

function Jauge({ pct, alerte, legende }: { pct: number; alerte?: boolean; legende: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{legende}</span>
        <span className="font-mono tabular-nums text-foreground">{fmtNumber(pct, 1)} %</span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-hairline/[0.08]"
        role="img"
        aria-label={`${legende} : ${fmtNumber(pct, 1)} pour cent`}
      >
        <div
          className={cn("h-full rounded-full transition-all", alerte ? "bg-yellow-400" : "bg-emerald-500")}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}

export function DetailEquipement({
  e,
  onOpenChange,
  consigne,
}: {
  e: Telemetrie | null;
  onOpenChange: (open: boolean) => void;
  consigne?: { consigne_mw: number; motif: string; limite_mw?: number };
}) {
  if (!e) return null;
  const c = couleurDe(e);
  const batterie = e.type === "batterie";

  return (
    <Dialog open={!!e} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", c.point)} aria-hidden="true" />
            {e.nom}
            <span className="font-mono text-xs font-normal text-muted-foreground">{e.equipement_id}</span>
          </DialogTitle>
          <DialogDescription>
            {c.libelle} · {libelleEtat(e.etat)}
            {e.disponible ? "" : " · indisponible"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {batterie ? (
            <Jauge pct={e.soc_pct ?? 0} alerte={(e.soc_pct ?? 100) <= 15} legende="Etat de charge (SoC)" />
          ) : (
            <Jauge pct={e.charge_pct ?? 0} legende="Charge" />
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Mesure
              label="Puissance"
              valeur={fmtNumber(e.puissance_mw, 3)}
              unite="MW"
              aide={batterie ? (e.puissance_mw > 0 ? "decharge" : e.puissance_mw < 0 ? "charge" : "repos") : undefined}
            />
            {batterie ? (
              <>
                <Mesure
                  label="Energie stockee"
                  valeur={fmtNumber(e.energie_stockee_mwh ?? 0, 2)}
                  unite="MWh"
                  aide={`sur ${fmtNumber(e.capacite_mwh ?? 0, 1)} MWh`}
                />
                <Mesure label="Sante (SoH)" valeur={fmtNumber(e.soh_pct ?? 100, 1)} unite="%" />
                <Mesure label="Puissance max" valeur={fmtNumber(e.p_max_mw ?? 0, 2)} unite="MW" />
                <Mesure label="Cycles" valeur={fmtNumber(e.cycles ?? 0, 1)} />
                <Mesure label="Temperature" valeur={fmtNumber(e.temperature_c ?? 0, 1)} unite="C" />
              </>
            ) : e.type === "solaire" ? (
              <>
                <Mesure label="Irradiance" valeur={fmtNumber(e.irradiance_wm2 ?? 0, 0)} unite="W/m2" />
                <Mesure label="Temp. module" valeur={fmtNumber(e.temperature_module_c ?? 0, 1)} unite="C" />
                <Mesure label="Crete" valeur={fmtNumber(e.puissance_nominale_mw ?? 0, 2)} unite="MW" />
              </>
            ) : (
              <>
                <Mesure label="Nominal" valeur={fmtNumber(e.puissance_nominale_mw ?? 0, 3)} unite="MW" />
                <Mesure label="Vent nacelle" valeur={fmtNumber(e.vent_nacelle_ms ?? 0, 2)} unite="m/s" />
                <Mesure
                  label="Vent a 10 m"
                  valeur={fmtNumber(e.vent_10m_ms ?? 0, 2)}
                  unite="m/s"
                  aide="mesure NASA"
                />
                <Mesure label="Rotor" valeur={fmtNumber(e.rotor_rpm ?? 0, 1)} unite="tr/min" />
                <Mesure label="Nacelle" valeur={fmtNumber(e.temperature_nacelle_c ?? 0, 1)} unite="C" />
              </>
            )}
          </div>

          {consigne ? (
            <div className="rounded-lg border border-hairline/[0.07] bg-hairline/[0.02] p-3">
              <p className="text-xs text-muted-foreground">Consigne EMS</p>
              <p className="font-mono text-lg tabular-nums text-foreground">
                {consigne.consigne_mw > 0 ? "+" : ""}
                {fmtNumber(consigne.consigne_mw, 3)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">MW</span>
              </p>
              {/* Une consigne sans motif n'est pas auditable. */}
              <p className="mt-1 text-xs text-muted-foreground">{consigne.motif}</p>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
