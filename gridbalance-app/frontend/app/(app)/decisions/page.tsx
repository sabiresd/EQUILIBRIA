"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Search, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CorrelationId } from "@/components/correlation-id";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { useDecisions } from "@/lib/hooks";
import { fmtDateTime } from "@/lib/utils";
import type { PlanId } from "@/lib/types";

function DecisionsView() {
  const searchParams = useSearchParams();
  const initialCid = searchParams.get("cid") ?? "";

  const { decisions, error, isLoading, mutate } = useDecisions();

  const [query, setQuery] = React.useState(initialCid);
  const [planFilter, setPlanFilter] = React.useState<PlanId | "all">("all");
  const [fallbackFilter, setFallbackFilter] = React.useState<"all" | "yes" | "no">("all");

  const filtered = React.useMemo(() => {
    if (!decisions) return [];
    const q = query.trim().toLowerCase();
    return decisions.filter((d) => {
      if (planFilter !== "all" && d.card.plan_id !== planFilter) return false;
      if (fallbackFilter === "yes" && !d.card.rag_fallback) return false;
      if (fallbackFilter === "no" && d.card.rag_fallback) return false;
      if (!q) return true;
      return (
        d.correlation_id.toLowerCase().includes(q) ||
        d.sha256.toLowerCase().includes(q) ||
        d.card.validated_by.toLowerCase().includes(q) ||
        d.card.proposed_by.toLowerCase().includes(q) ||
        d.card.comment.toLowerCase().includes(q)
      );
    });
  }, [decisions, query, planFilter, fallbackFilter]);

  return (
    <>
      <PageHeader
        title="Cartes de decision"
        description="Chaque decision validee est figee, hachee en SHA-256 et verifiable a tout moment."
      />

      {/* Filtres : une seule rangee, au-dessus du tableau qu'elle cadre. */}
      <Card className="mb-6">
        <CardContent className="grid gap-3 p-5 sm:grid-cols-[1fr_auto_auto]">
          <div className="space-y-2">
            <Label htmlFor="q">Rechercher</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60"
                aria-hidden="true"
              />
              <Input
                id="q"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ID de correlation, hash, validateur, commentaire…"
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="plan-filter">Plan</Label>
            <Select
              value={planFilter}
              onValueChange={(v) => setPlanFilter(v as PlanId | "all")}
            >
              <SelectTrigger id="plan-filter" className="w-full sm:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les plans</SelectItem>
                <SelectItem value="A">Plan A</SelectItem>
                <SelectItem value="B">Plan B</SelectItem>
                <SelectItem value="C">Plan C</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fallback-filter">Repli RAG</Label>
            <Select
              value={fallbackFilter}
              onValueChange={(v) => setFallbackFilter(v as "all" | "yes" | "no")}
            >
              <SelectTrigger id="fallback-filter" className="w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="yes">Avec repli RAG</SelectItem>
                <SelectItem value="no">Sans repli RAG</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          {isLoading && !decisions ? (
            <TableSkeleton rows={5} cols={6} />
          ) : error ? (
            <ErrorState error={error} onRetry={() => mutate()} />
          ) : filtered.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Correlation</TableHead>
                  <TableHead>Validee par</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Empreinte SHA-256</TableHead>
                  <TableHead className="text-right">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <Badge variant="default">Plan {d.card.plan_id}</Badge>
                        {d.card.rag_fallback ? (
                          <Badge variant="warning">Repli RAG</Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      <CorrelationId value={d.correlation_id} label="" />
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-foreground">{d.card.validated_by}</span>
                      <span className="block text-xs text-muted-foreground">
                        propose par {d.card.proposed_by}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDateTime(d.card.validated_at)}
                    </TableCell>
                    <TableCell>
                      <code className="font-mono text-[11px] text-muted-foreground">
                        {d.sha256.slice(0, 12)}…
                      </code>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/decisions/${d.id}`}>
                          Ouvrir
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : decisions?.length ? (
            <EmptyState
              title="Aucun resultat"
              description="Aucune carte de decision ne correspond a vos filtres."
              icon={Search}
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setPlanFilter("all");
                    setFallbackFilter("all");
                  }}
                >
                  Reinitialiser les filtres
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="Aucune decision journalisee"
              description="Les plans valides par un superviseur produiront une carte de decision signee, verifiable ici."
              icon={ShieldCheck}
              action={
                <Button asChild size="sm">
                  <Link href="/plans">Voir les plans</Link>
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * `useSearchParams()` (parametre `?cid=`) impose une frontiere Suspense.
 */
export default function DecisionsPage() {
  return (
    <React.Suspense fallback={<TableSkeleton rows={6} cols={6} />}>
      <DecisionsView />
    </React.Suspense>
  );
}
