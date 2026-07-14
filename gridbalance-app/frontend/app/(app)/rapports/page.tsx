"use client";

import * as React from "react";
import { CalendarClock, FileBarChart, Mail, Plus, Send, X } from "lucide-react";

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
import { KEYS, useDecisions, useReports, useRun, useRevalidate, useRuns } from "@/lib/hooks";
import { ScheduleReportRequestSchema, SendReportRequestSchema } from "@/lib/schemas";
import { buildReportHtml } from "@/lib/report";
import { fmtDateTime, fmtRelative } from "@/lib/utils";
import type { ReportFrequency } from "@/lib/schemas";

/* -------------------------------------------------------------------------- */
/*                        Saisie d'une liste d'e-mails                         */
/* -------------------------------------------------------------------------- */

function RecipientsInput({
  recipients,
  onChange,
  id,
  error,
}: {
  recipients: string[];
  onChange: (next: string[]) => void;
  id: string;
  error?: string | null;
}) {
  const [value, setValue] = React.useState("");

  const add = () => {
    const email = value.trim().toLowerCase();
    if (!email) return;
    if (recipients.includes(email)) {
      setValue("");
      return;
    }
    onChange([...recipients, email]);
    setValue("");
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Destinataires</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="dispatch@onee.ma"
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <Button type="button" variant="outline" onClick={add} aria-label="Ajouter le destinataire">
          <Plus className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {recipients.length ? (
        <ul className="flex flex-wrap gap-2 pt-1">
          {recipients.map((r) => (
            <li key={r}>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] py-1 pl-2.5 pr-1 text-xs text-foreground">
                {r}
                <button
                  type="button"
                  onClick={() => onChange(recipients.filter((x) => x !== r))}
                  aria-label={`Retirer ${r}`}
                  className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const STATUS_BADGE = {
  sent: { variant: "success", label: "Envoye" },
  failed: { variant: "danger", label: "Echec" },
  scheduled: { variant: "info", label: "Planifie" },
  pending: { variant: "warning", label: "En cours" },
} as const;

export default function RapportsPage() {
  const { runs } = useRuns(30);
  const { decisions } = useDecisions();
  const { reports, error, isLoading, mutate } = useReports();
  const revalidate = useRevalidate();

  const [cid, setCid] = React.useState<string>("");
  const [recipients, setRecipients] = React.useState<string[]>([]);
  const [recipientsError, setRecipientsError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);

  const [schedFrequency, setSchedFrequency] = React.useState<ReportFrequency>("daily");
  const [schedRecipients, setSchedRecipients] = React.useState<string[]>([]);
  const [schedError, setSchedError] = React.useState<string | null>(null);
  const [scheduling, setScheduling] = React.useState(false);

  const { run } = useRun(cid || null);

  const decision = React.useMemo(
    () => decisions?.find((d) => d.correlation_id === cid) ?? null,
    [decisions, cid],
  );

  /** Apercu HTML du rapport : KPI du run, plan valide, empreinte SHA-256. */
  const previewHtml = React.useMemo(
    () => (run ? buildReportHtml(run, decision) : ""),
    [run, decision],
  );

  const send = async () => {
    setRecipientsError(null);
    const parsed = SendReportRequestSchema.safeParse({
      correlation_id: cid,
      recipients,
    });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setRecipientsError(
        flat.recipients?.[0] ??
          flat.correlation_id?.[0] ??
          "Selectionnez un run et au moins un destinataire valide.",
      );
      return;
    }
    setSending(true);
    try {
      await api.reports.send(parsed.data.correlation_id, parsed.data.recipients);
      revalidate(KEYS.reports);
      toast({
        variant: "success",
        title: "Rapport envoye",
        description: `Le rapport a ete transmis a ${parsed.data.recipients.length} destinataire(s).`,
      });
      setRecipients([]);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Envoi impossible",
        description: errorMessage(err),
      });
    } finally {
      setSending(false);
    }
  };

  const schedule = async () => {
    setSchedError(null);
    const parsed = ScheduleReportRequestSchema.safeParse({
      frequency: schedFrequency,
      recipients: schedRecipients,
    });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setSchedError(flat.recipients?.[0] ?? "Au moins un destinataire valide est requis.");
      return;
    }
    setScheduling(true);
    try {
      await api.reports.schedule(parsed.data.frequency, parsed.data.recipients);
      revalidate(KEYS.reports);
      toast({
        variant: "success",
        title: "Planification enregistree",
        description:
          parsed.data.frequency === "daily"
            ? "Un rapport quotidien sera envoye automatiquement."
            : "Un rapport hebdomadaire sera envoye automatiquement.",
      });
      setSchedRecipients([]);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Planification impossible",
        description: errorMessage(err),
      });
    } finally {
      setScheduling(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Rapports"
        description="Generez le rapport d'un run, transmettez-le immediatement ou planifiez un envoi recurrent."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_1fr]">
        {/* ----------------------------------------------------- envoi */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                Envoi immediat
              </CardTitle>
              <CardDescription>
                Le rapport reprend les KPI du run, le plan valide et son empreinte SHA-256.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="report-run">Run</Label>
                <Select value={cid} onValueChange={setCid}>
                  <SelectTrigger id="report-run" aria-label="Choisir le run a rapporter">
                    <SelectValue placeholder="Choisir un run…" />
                  </SelectTrigger>
                  <SelectContent>
                    {runs?.length ? (
                      runs.map((r) => (
                        <SelectItem key={r.correlation_id} value={r.correlation_id}>
                          {r.correlation_id.slice(0, 8)} · {r.scenario} ·{" "}
                          {fmtRelative(r.created_at)}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none" disabled>
                        Aucun run disponible
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <RecipientsInput
                id="send-recipients"
                recipients={recipients}
                onChange={setRecipients}
                error={recipientsError}
              />

              <Button className="w-full" onClick={send} loading={sending} disabled={!cid}>
                <Mail className="h-4 w-4" aria-hidden="true" />
                Envoyer le rapport
              </Button>
            </CardContent>
          </Card>

          {/* ----------------------------------------------- planification */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                Planification
              </CardTitle>
              <CardDescription>
                Envoi automatique d&apos;une synthese recurrente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="frequency">Frequence</Label>
                <Select
                  value={schedFrequency}
                  onValueChange={(v) => setSchedFrequency(v as ReportFrequency)}
                >
                  <SelectTrigger id="frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Quotidien</SelectItem>
                    <SelectItem value="weekly">Hebdomadaire</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <RecipientsInput
                id="sched-recipients"
                recipients={schedRecipients}
                onChange={setSchedRecipients}
                error={schedError}
              />

              <Button
                className="w-full"
                variant="outline"
                onClick={schedule}
                loading={scheduling}
              >
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
                Planifier
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* -------------------------------------------------- apercu HTML */}
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Apercu du rapport</CardTitle>
            <CardDescription>
              Rendu HTML transmis aux destinataires. Le disclaimer y figure systematiquement.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!cid ? (
              <EmptyState
                title="Aucun run selectionne"
                description="Choisissez un run pour previsualiser le rapport qui sera envoye."
                icon={FileBarChart}
              />
            ) : previewHtml ? (
              <iframe
                title="Apercu du rapport"
                srcDoc={previewHtml}
                sandbox=""
                className="h-[640px] w-full rounded-lg border border-white/[0.07] bg-white"
              />
            ) : (
              <TableSkeleton rows={4} cols={2} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ------------------------------------------------- historique */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Historique des envois</CardTitle>
          <CardDescription>Statut de chaque rapport transmis ou planifie.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && !reports ? (
            <TableSkeleton rows={4} cols={5} />
          ) : error ? (
            <ErrorState error={error} onRetry={() => mutate()} />
          ) : reports?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Statut</TableHead>
                  <TableHead>Run</TableHead>
                  <TableHead>Destinataires</TableHead>
                  <TableHead>Frequence</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => {
                  const badge = STATUS_BADGE[r.status];
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {r.status === "failed" && r.error ? (
                          <p className="mt-1 max-w-[220px] truncate text-xs text-red-300">
                            {r.error}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {r.correlation_id ? (
                          <CorrelationId value={r.correlation_id} label="" />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Synthese periodique
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {r.recipients.length ? r.recipients.join(", ") : "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {r.frequency ? (
                          <Badge variant="neutral">
                            {r.frequency === "daily" ? "Quotidien" : "Hebdomadaire"}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Ponctuel</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDateTime(r.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title="Aucun rapport envoye"
              description="Les rapports transmis et les planifications apparaitront ici avec leur statut."
              icon={FileBarChart}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
