"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  FileJson,
  FileText,
  Lock,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CitationList, RagFallbackBanner } from "@/components/plan-card";
import { CorrelationId } from "@/components/correlation-id";
import { ErrorState, TableSkeleton } from "@/components/states";
import { toast } from "@/components/ui/use-toast";
import { api, errorMessage } from "@/lib/api";
import { useDecision } from "@/lib/hooks";
import { ACTION_LABELS } from "@/lib/types";
import { canonicalJson } from "@/lib/canonical";
import { fmtDateTime, fmtNumber, fmtPercent } from "@/lib/utils";
import type { VerifyResult } from "@/lib/schemas";

export default function DecisionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { decision, error, isLoading, mutate } = useDecision(id ?? null);

  const [verifying, setVerifying] = React.useState(false);
  const [verifyResult, setVerifyResult] = React.useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = React.useState<unknown>(null);
  const [copied, setCopied] = React.useState(false);
  const [downloading, setDownloading] = React.useState<"pdf" | "json" | null>(null);

  const canonical = React.useMemo(
    () => (decision ? canonicalJson(decision.card) : ""),
    [decision],
  );

  const verify = async () => {
    if (!id) return;
    setVerifyError(null);
    setVerifying(true);
    try {
      const result = await api.decisions.verify(id);
      setVerifyResult(result);
      toast({
        variant: result.valid ? "success" : "destructive",
        title: result.valid ? "Integrite confirmee" : "Integrite compromise",
        description: result.valid
          ? "L'empreinte recalculee correspond a l'empreinte enregistree."
          : "L'empreinte recalculee DIFFERE de l'empreinte enregistree. La carte a ete alteree.",
      });
    } catch (err) {
      setVerifyError(err);
    } finally {
      setVerifying(false);
    }
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(canonical);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* presse-papiers indisponible */
    }
  };

  const download = async (kind: "pdf" | "json") => {
    if (!decision) return;
    setDownloading(kind);
    try {
      if (kind === "pdf") {
        await api.decisions.downloadPdf(decision.id, decision.correlation_id);
      } else {
        await api.decisions.downloadJson(decision.id, decision.correlation_id);
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Telechargement impossible",
        description: errorMessage(err),
      });
    } finally {
      setDownloading(null);
    }
  };

  if (isLoading && !decision) {
    return <TableSkeleton rows={6} cols={3} />;
  }

  if (error || !decision) {
    return (
      <>
        <PageHeader title="Carte de decision" />
        <ErrorState error={error} onRetry={() => mutate()} />
        <div className="mt-4">
          <Button asChild variant="outline">
            <Link href="/decisions">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Retour aux decisions
            </Link>
          </Button>
        </div>
      </>
    );
  }

  const card = decision.card;

  return (
    <>
      <PageHeader
        title={`Decision — plan ${card.plan_id}`}
        description={`Validee par ${card.validated_by} le ${fmtDateTime(card.validated_at)}.`}
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/decisions">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Retour
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => download("json")}
              loading={downloading === "json"}
            >
              <FileJson className="h-4 w-4" aria-hidden="true" />
              JSON
            </Button>
            <Button
              variant="outline"
              onClick={() => download("pdf")}
              loading={downloading === "pdf"}
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              Export PDF
            </Button>
          </>
        }
      />

      {card.rag_fallback ? (
        <div className="mb-6">
          <RagFallbackBanner />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-6">
          {/* -------------------------------------------------- en-tete */}
          <Card>
            <CardHeader>
              <CardTitle>Resume</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default">Plan {card.plan_id}</Badge>
                {card.rag_fallback ? <Badge variant="warning">Repli RAG</Badge> : null}
                <Badge variant="neutral">
                  Equite {fmtPercent(card.fairness_score, 0)}
                </Badge>
                <CorrelationId value={card.correlation_id} truncate={false} />
              </div>

              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Propose par
                  </dt>
                  <dd className="mt-1 text-sm text-foreground">{card.proposed_by}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Validee par
                  </dt>
                  <dd className="mt-1 text-sm text-foreground">{card.validated_by}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Horodatage
                  </dt>
                  <dd className="mt-1 text-sm text-foreground">
                    {fmtDateTime(card.validated_at)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Notifications
                  </dt>
                  <dd className="mt-1 flex gap-2">
                    <Badge variant={decision.notified.email ? "success" : "neutral"}>
                      E-mail {decision.notified.email ? "envoye" : "non envoye"}
                    </Badge>
                    <Badge variant={decision.notified.slack ? "success" : "neutral"}>
                      Slack {decision.notified.slack ? "envoye" : "non envoye"}
                    </Badge>
                  </dd>
                </div>
              </dl>

              <Separator />

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Commentaire du superviseur
                </p>
                <blockquote className="mt-2 border-l-2 border-emerald-500/40 pl-3 text-sm leading-relaxed text-foreground">
                  {card.comment}
                </blockquote>
              </div>

              {card.deficit_summary ? (
                <>
                  <Separator />
                  <dl className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        Deficit total
                      </dt>
                      <dd className="mt-1 font-mono text-sm tabular-nums text-foreground">
                        {fmtNumber(card.deficit_summary.total_deficit_mwh, 0)} MWh
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        Heures en deficit
                      </dt>
                      <dd className="mt-1 font-mono text-sm tabular-nums text-foreground">
                        {card.deficit_summary.hours_in_deficit} h
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        Pic de deficit
                      </dt>
                      <dd className="mt-1 font-mono text-sm tabular-nums text-foreground">
                        {fmtNumber(card.deficit_summary.peak_deficit_mw)} MW
                      </dd>
                    </div>
                  </dl>
                </>
              ) : null}
            </CardContent>
          </Card>

          {/* -------------------------------------------------- actions */}
          <Card>
            <CardHeader>
              <CardTitle>Actions du plan ({card.actions.length})</CardTitle>
              <CardDescription>
                Actions figees au moment de la validation. Aucun equipement reel n&apos;est pilote.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {card.actions.map((a, i) => (
                  <li
                    key={`${a.site}-${i}`}
                    className="rounded-md border border-hairline/[0.06] bg-hairline/[0.02] p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {ACTION_LABELS[a.action]} · {a.site}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-foreground">
                        {a.delta_mw > 0 ? "+" : ""}
                        {fmtNumber(a.delta_mw)} MW · {a.hours.length} h
                      </span>
                    </div>
                    {a.justification ? (
                      <p className="mt-1.5 text-xs text-muted-foreground">{a.justification}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* ---------------------------------------------- JSON canonique */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div className="space-y-1">
                <CardTitle>JSON canonique</CardTitle>
                <CardDescription>
                  Representation exacte hachee en SHA-256 (cles triees, sans espaces superflus).
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={copyJson}>
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {copied ? "Copie" : "Copier"}
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[420px] overflow-auto rounded-lg border border-hairline/[0.07] bg-base-900/70 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
                <code>{canonical}</code>
              </pre>
            </CardContent>
          </Card>
        </div>

        {/* ------------------------------------------------- integrite */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                Integrite
              </CardTitle>
              <CardDescription>
                Verifiez que la carte n&apos;a pas ete alteree depuis sa journalisation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Empreinte enregistree
                </p>
                <code className="mt-1 block break-all rounded bg-hairline/[0.04] p-2 font-mono text-[11px] text-foreground">
                  {decision.sha256}
                </code>
              </div>

              <Button className="w-full" onClick={verify} loading={verifying}>
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Verifier l&apos;integrite
              </Button>

              {verifyError ? <ErrorState error={verifyError} compact /> : null}

              {/* Badge vert "integre" / rouge "altere" — icone + libelle, jamais la couleur seule. */}
              {verifyResult ? (
                <div
                  role="status"
                  className={`space-y-3 rounded-lg border p-3 ${
                    verifyResult.valid
                      ? "border-ok/35 bg-ok/[0.07]"
                      : "border-danger/40 bg-danger/[0.08]"
                  }`}
                >
                  <p
                    className={`flex items-center gap-2 text-sm font-semibold ${
                      verifyResult.valid ? "text-emerald-300" : "text-red-300"
                    }`}
                  >
                    {verifyResult.valid ? (
                      <>
                        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                        Integre
                      </>
                    ) : (
                      <>
                        <ShieldX className="h-4 w-4" aria-hidden="true" />
                        Altere
                      </>
                    )}
                  </p>

                  <div className="space-y-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Attendue
                      </p>
                      <code className="block break-all font-mono text-[10px] text-muted-foreground">
                        {verifyResult.expected_sha256}
                      </code>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Recalculee
                      </p>
                      <code
                        className={`block break-all font-mono text-[10px] ${
                          verifyResult.valid ? "text-muted-foreground" : "text-red-300"
                        }`}
                      >
                        {verifyResult.computed_sha256}
                      </code>
                    </div>
                  </div>

                  {!verifyResult.valid ? (
                    <p className="flex items-start gap-1.5 text-xs text-red-200">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Les empreintes different : le contenu enregistre ne correspond plus a la
                      carte signee. Signalez-le au support avec l&apos;identifiant de correlation.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Citations RAG */}
          <Card>
            <CardHeader>
              <CardTitle>Citations RAG</CardTitle>
              <CardDescription>Sources documentaires ayant fonde le plan.</CardDescription>
            </CardHeader>
            <CardContent>
              <CitationList citations={card.citations} />
            </CardContent>
          </Card>

          {/* Telechargements */}
          <Card>
            <CardHeader>
              <CardTitle>Exports</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button
                variant="outline"
                onClick={() => download("json")}
                loading={downloading === "json"}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Telecharger le JSON
              </Button>
              <Button
                variant="outline"
                onClick={() => download("pdf")}
                loading={downloading === "pdf"}
              >
                <FileText className="h-4 w-4" aria-hidden="true" />
                Exporter en PDF
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
