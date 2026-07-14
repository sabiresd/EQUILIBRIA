"use client";

import * as React from "react";
import { ClipboardList, Download, Search } from "lucide-react";

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
import { toast } from "@/components/ui/use-toast";
import { api, errorMessage } from "@/lib/api";
import { useAudit, usePermissions } from "@/lib/hooks";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { fmtDateTime } from "@/lib/utils";

export default function JournalPage() {
  const { entries, error, isLoading, mutate } = useAudit();
  const { canAdmin } = usePermissions();

  const [query, setQuery] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState<Role | "all">("all");
  const [outcomeFilter, setOutcomeFilter] = React.useState<"all" | "success" | "failure">("all");
  const [actionFilter, setActionFilter] = React.useState<string>("all");
  const [exporting, setExporting] = React.useState(false);

  const actions = React.useMemo(() => {
    if (!entries) return [];
    return Array.from(new Set(entries.map((e) => e.action))).sort();
  }, [entries]);

  const filtered = React.useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (roleFilter !== "all" && e.role !== roleFilter) return false;
      if (outcomeFilter !== "all" && e.outcome !== outcomeFilter) return false;
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (!q) return true;
      return (
        (e.correlation_id ?? "").toLowerCase().includes(q) ||
        e.actor.toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q) ||
        (e.target ?? "").toLowerCase().includes(q) ||
        (e.detail ?? "").toLowerCase().includes(q)
      );
    });
  }, [entries, query, roleFilter, outcomeFilter, actionFilter]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await api.audit.exportCsv();
      toast({
        variant: "success",
        title: "Export lance",
        description: "Le journal complet a ete telecharge au format CSV.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Export impossible",
        description: errorMessage(err),
      });
    } finally {
      setExporting(false);
    }
  };

  const resetFilters = () => {
    setQuery("");
    setRoleFilter("all");
    setOutcomeFilter("all");
    setActionFilter("all");
  };

  return (
    <>
      <PageHeader
        title="Journal d'audit"
        description="Trace complete des actions, indexee par identifiant de correlation."
        actions={
          canAdmin ? (
            <Button variant="outline" onClick={exportCsv} loading={exporting}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Exporter en CSV
            </Button>
          ) : null
        }
      />

      {/* Une seule rangee de filtres, au-dessus de tout ce qu'elle cadre. */}
      <Card className="mb-6">
        <CardContent className="grid gap-3 p-5 lg:grid-cols-[1fr_auto_auto_auto]">
          <div className="space-y-2">
            <Label htmlFor="audit-q">Rechercher</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60"
                aria-hidden="true"
              />
              <Input
                id="audit-q"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Correlation, acteur, action, cible…"
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="audit-action">Action</Label>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger id="audit-action" className="w-full lg:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes</SelectItem>
                {actions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="audit-role">Role</Label>
            <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as Role | "all")}>
              <SelectTrigger id="audit-role" className="w-full lg:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="operator">Operateur</SelectItem>
                <SelectItem value="supervisor">Superviseur</SelectItem>
                <SelectItem value="admin">Administrateur</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="audit-outcome">Resultat</Label>
            <Select
              value={outcomeFilter}
              onValueChange={(v) => setOutcomeFilter(v as "all" | "success" | "failure")}
            >
              <SelectTrigger id="audit-outcome" className="w-full lg:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="success">Succes</SelectItem>
                <SelectItem value="failure">Echec</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          {isLoading && !entries ? (
            <TableSkeleton rows={8} cols={6} />
          ) : error ? (
            <ErrorState error={error} onRetry={() => mutate()} />
          ) : filtered.length ? (
            <>
              <p className="mb-3 text-xs text-muted-foreground">
                {filtered.length} entree(s) sur {entries?.length ?? 0}.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Acteur</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Cible</TableHead>
                    <TableHead>Correlation</TableHead>
                    <TableHead>Resultat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDateTime(e.created_at)}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-foreground">{e.actor}</span>
                        {e.role ? (
                          <span className="block text-xs text-muted-foreground">
                            {ROLE_LABELS[e.role]}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <code className="font-mono text-xs text-emerald-300">{e.action}</code>
                        {e.detail ? (
                          <span className="block max-w-[280px] truncate text-xs text-muted-foreground">
                            {e.detail}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {e.target ?? "—"}
                      </TableCell>
                      <TableCell>
                        {e.correlation_id ? (
                          <CorrelationId value={e.correlation_id} label="" />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={e.outcome === "success" ? "success" : "danger"}>
                          {e.outcome === "success" ? "Succes" : "Echec"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          ) : entries?.length ? (
            <EmptyState
              title="Aucun resultat"
              description="Aucune entree du journal ne correspond a vos filtres."
              icon={Search}
              action={
                <Button size="sm" variant="outline" onClick={resetFilters}>
                  Reinitialiser les filtres
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="Journal vide"
              description="Les actions realisees dans l'application seront tracees ici avec leur identifiant de correlation."
              icon={ClipboardList}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
