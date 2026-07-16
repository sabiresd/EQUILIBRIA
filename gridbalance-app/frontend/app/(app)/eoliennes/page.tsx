"use client";

import * as React from "react";

import { PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { ChartCard, SingleSeriesChart } from "@/components/charts";
import { DetailEquipement, LegendeCouleurs } from "@/components/equipements";
import { PanneauEquipement } from "@/components/hmi";
import { EmptyState, ErrorState, KpiSkeleton } from "@/components/states";
import { useEmsConsignes, useScadaHistorique, useScadaLive } from "@/lib/hooks";
import { SERIES } from "@/lib/chart-theme";
import { fmtNumber } from "@/lib/utils";
import type { Telemetrie } from "@/lib/api";

export default function EoliennesPage() {
  const { live, error, isLoading, mutate } = useScadaLive();
  const { consignes } = useEmsConsignes(48);
  const [selection, setSelection] = React.useState<Telemetrie | null>(null);

  // UN seul appel pour toutes les sparklines : une requete par panneau
  // multiplierait les allers-retours sans rien apporter.
  const { historique } = useScadaHistorique(undefined, 48);

  const turbines = (live?.scada.equipements ?? []).filter((e) => e.type === "eolienne");

  const parEquipement = React.useMemo(() => {
    const map = new Map<string, number[]>();
    for (const p of historique ?? []) {
      const l = map.get(p.equipement_id) ?? [];
      l.push(p.puissance_mw);
      map.set(p.equipement_id, l);
    }
    return map;
  }, [historique]);

  const suivie = selection?.equipement_id ?? turbines[0]?.equipement_id;
  const courbe = React.useMemo(
    () =>
      (historique ?? [])
        .filter((p) => p.equipement_id === suivie)
        .map((p, i) => ({ h: i, puissance_mw: p.puissance_mw })),
    [historique, suivie],
  );

  const derniere = consignes?.[consignes.length - 1];
  const consigne = selection
    ? derniere?.consignes.find((c) => c.equipement_id === selection.equipement_id)
    : undefined;

  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Eoliennes"
        description="Supervision temps reel du parc. Cliquez un panneau pour le detail. Observation seule : aucun equipement n'est pilote depuis cette page."
      />

      {isLoading && !live ? (
        <KpiSkeleton />
      ) : turbines.length === 0 ? (
        <EmptyState
          title="Aucune turbine"
          description="Le SCADA n'a remonte aucun equipement. Generez l'historique via POST /api/scada/seed."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <LegendeCouleurs />
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                Parc {fmtNumber(live?.scada.totaux.production_eolienne_mw ?? 0, 3)} MW
              </Badge>
              <Badge variant="outline">
                {turbines.filter((t) => t.disponible).length}/{turbines.length} disponibles
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
            {turbines.map((t) => (
              <PanneauEquipement
                key={t.equipement_id}
                e={t}
                historique={parEquipement.get(t.equipement_id) ?? []}
                onClick={() => setSelection(t)}
              />
            ))}
          </div>

          <DetailEquipement
            e={selection}
            onOpenChange={(o) => !o && setSelection(null)}
            consigne={consigne}
          />

          {suivie && courbe.length > 0 ? (
            <ChartCard
              title={`Puissance — ${suivie}`}
              description="48 dernieres heures. La courbe suit la machine ouverte : c'est ce qui rend visible un arret ou un defaut."
            >
              <SingleSeriesChart
                data={courbe}
                dataKey="puissance_mw"
                name="Puissance"
                color={SERIES.vent}
                unit="MW"
                digits={3}
                height={240}
              />
            </ChartCard>
          ) : null}
        </>
      )}
    </div>
  );
}
