"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartCard, SingleSeriesChart } from "@/components/charts";
import { DetailEquipement, LegendeCouleurs } from "@/components/equipements";
import { PanneauEquipement } from "@/components/hmi";
import { EmptyState, ErrorState, KpiSkeleton } from "@/components/states";
import { BATTERY_POLL_MS, useEmsConsignes, useScadaHistorique, useScadaLive } from "@/lib/hooks";
import { SERIES } from "@/lib/chart-theme";
import { fmtNumber } from "@/lib/utils";
import type { Telemetrie } from "@/lib/api";

export default function BatteriesPage() {
  // Le rack se rafraichit toutes les 5 min, pas toutes les 2 s : un SoC ne
  // bouge pas a la seconde, et le faire clignoter donnerait l'illusion d'une
  // instabilite qui n'existe pas.
  const { live, error, isLoading, mutate } = useScadaLive(BATTERY_POLL_MS);
  const { consignes } = useEmsConsignes(48, BATTERY_POLL_MS);
  const [selection, setSelection] = React.useState<Telemetrie | null>(null);

  const batteries = (live?.scada.equipements ?? []).filter((e) => e.type === "batterie");
  const suivie = selection?.equipement_id ?? batteries[0]?.equipement_id;
  // UN seul appel : les sparklines des N modules sortent du meme historique.
  const { historique } = useScadaHistorique(undefined, 48, BATTERY_POLL_MS);

  const parEquipement = React.useMemo(() => {
    const map = new Map<string, number[]>();
    for (const p of historique ?? []) {
      const l = map.get(p.equipement_id) ?? [];
      l.push(p.puissance_mw);
      map.set(p.equipement_id, l);
    }
    return map;
  }, [historique]);

  const suivi = React.useMemo(
    () => (historique ?? []).filter((p) => p.equipement_id === suivie),
    [historique, suivie],
  );
  const courbeSoc = React.useMemo(
    () => suivi.map((p, i) => ({ h: i, soc_pct: p.soc_pct ?? 0 })),
    [suivi],
  );
  const courbePuissance = React.useMemo(
    () => suivi.map((p, i) => ({ h: i, puissance_mw: p.puissance_mw })),
    [suivi],
  );

  // Echelle ajustee aux valeurs. Fige a [0,100], une variation de 35 a 50 %
  // s'ecrase en ligne plate et le graphe n'apprend plus rien. On garde une
  // marge et on borne a 0-100 : l'axe reste honnete, il zoome seulement.
  const domaineSoc = React.useMemo((): [number, number] => {
    const vals = courbeSoc.map((p) => p.soc_pct);
    if (!vals.length) return [0, 100];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const marge = Math.max(4, (max - min) * 0.2);
    return [Math.max(0, Math.floor(min - marge)), Math.min(100, Math.ceil(max + marge))];
  }, [courbeSoc]);

  const derniere = consignes?.[consignes.length - 1];
  // L'EMS pilote le rack comme UN stockage : sa consigne est agregee, le SCADA
  // la repartit ensuite module par module.
  const consigneRack = derniere?.consignes.find((c) => c.type === "batterie");

  const energie = batteries.reduce((s, b) => s + (b.energie_stockee_mwh ?? 0), 0);
  const capacite = batteries.reduce((s, b) => s + (b.capacite_mwh ?? 0), 0);

  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Batteries"
        description="Etat du rack de stockage, module par module. Cliquez un panneau pour le detail. Les mesures viennent du SCADA, les consignes de l'EMS."
      />

      {/* La cadence est ecrite noir sur blanc : sans ca, un ecran qui ne bouge
          pas pendant 5 min passerait pour gele. */}
      <p className="-mt-3 text-xs text-muted-foreground">
        Rafraichissement toutes les 5 minutes — un etat de charge n&apos;evolue pas a la seconde.
      </p>

      {isLoading && !live ? (
        <KpiSkeleton />
      ) : batteries.length === 0 ? (
        <EmptyState
          title="Aucune batterie"
          description="Le SCADA n'a remonte aucun stockage. Generez l'historique via POST /api/scada/seed."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <LegendeCouleurs />
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {fmtNumber(energie, 2)} / {fmtNumber(capacite, 1)} MWh
              </Badge>
              <Badge variant="outline">
                {batteries.filter((b) => b.disponible).length}/{batteries.length} disponibles
              </Badge>
              {derniere ? <Badge variant="outline">Tarif {derniere.bilan.tarif_periode}</Badge> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
            {batteries.map((b) => (
              <PanneauEquipement
                key={b.equipement_id}
                e={b}
                historique={parEquipement.get(b.equipement_id) ?? []}
                onClick={() => setSelection(b)}
              />
            ))}
          </div>

          <DetailEquipement e={selection} onOpenChange={(o) => !o && setSelection(null)} />

          {consigneRack ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Consigne EMS — rack</CardTitle>
                <CardDescription>
                  L&apos;EMS pilote une enveloppe de {fmtNumber(consigneRack.limite_mw ?? 0, 1)} MW ; le SCADA la
                  repartit sur les {batteries.length} modules au prorata de leur marge.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="font-mono text-2xl tabular-nums text-foreground">
                  {consigneRack.consigne_mw > 0 ? "+" : ""}
                  {fmtNumber(consigneRack.consigne_mw, 3)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">MW</span>
                </p>
                {/* Le motif est le coeur : une consigne sans raison n'est pas auditable. */}
                <p className="text-sm text-muted-foreground">{consigneRack.motif}</p>

                {(derniere?.contraintes ?? []).length > 0 ? (
                  <div className="space-y-1.5 border-t border-hairline/[0.07] pt-3">
                    {derniere!.contraintes.map((c, i) => (
                      <p key={i} className="flex gap-1.5 text-xs text-muted-foreground">
                        <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-yellow-400" aria-hidden="true" />
                        {c.detail}
                      </p>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {suivie && courbeSoc.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title={`Etat de charge — ${suivie}`}
                description={`48 dernieres heures. Echelle ${domaineSoc[0]}-${domaineSoc[1]} %, ajustee aux valeurs.`}
              >
                <SingleSeriesChart
                  data={courbeSoc}
                  dataKey="soc_pct"
                  name="SoC"
                  color={SERIES.batterie}
                  unit="%"
                  digits={1}
                  height={220}
                  domain={domaineSoc}
                />
              </ChartCard>
              <ChartCard
                title={`Sollicitation — ${suivie}`}
                description="Positif = decharge (le module soutient le reseau), negatif = charge."
              >
                <SingleSeriesChart
                  data={courbePuissance}
                  dataKey="puissance_mw"
                  name="Puissance"
                  color={SERIES.batterie}
                  unit="MW"
                  digits={3}
                  height={220}
                />
              </ChartCard>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
