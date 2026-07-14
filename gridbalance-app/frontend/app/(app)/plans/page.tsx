"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ListChecks, Sparkles, ThumbsDown, ThumbsUp, XCircle } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlanCard, RagFallbackBanner } from "@/components/plan-card";
import { CorrelationId } from "@/components/correlation-id";
import { RunStatusBadge, ScenarioBadge } from "@/components/badges";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { toast } from "@/components/ui/use-toast";
import { api, errorCorrelationId, errorMessage } from "@/lib/api";
import { KEYS, useRun, useRuns, useValidations, usePermissions, useRevalidate } from "@/lib/hooks";
import { ValidateRequestSchema } from "@/lib/schemas";
import { fmtRelative } from "@/lib/utils";
import type { PlanId } from "@/lib/types";
import type { Run } from "@/lib/contracts";

/* -------------------------------------------------------------------------- */
/*                       Boite de dialogue de validation                       */
/* -------------------------------------------------------------------------- */

/**
 * HITL : le superviseur valide ou rejette. Le COMMENTAIRE EST OBLIGATOIRE
 * dans les deux cas — c'est la trace de la decision humaine.
 */
function ValidationDialog({
  run,
  open,
  onOpenChange,
  onDone,
}: {
  run: Run | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [comment, setComment] = React.useState("");
  const [commentError, setCommentError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<"approve" | "reject" | null>(null);
  const [error, setError] = React.useState<unknown>(null);

  React.useEffect(() => {
    if (open) {
      setComment("");
      setCommentError(null);
      setError(null);
      setPending(null);
    }
  }, [open]);

  if (!run) return null;

  const planId = run.proposed_plan_id;

  const submit = async (approve: boolean) => {
    setError(null);

    const parsed = ValidateRequestSchema.safeParse({
      plan_id: planId,
      comment,
      approve,
    });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setCommentError(flat.comment?.[0] ?? "Le commentaire est obligatoire.");
      return;
    }
    setCommentError(null);
    setPending(approve ? "approve" : "reject");

    try {
      await api.runs.validate(run.correlation_id, parsed.data);
      toast({
        variant: approve ? "success" : "default",
        title: approve ? "Plan valide" : "Plan rejete",
        description: approve
          ? `Le plan ${parsed.data.plan_id} a ete valide et journalise (WF-4).`
          : `Le plan ${parsed.data.plan_id} a ete rejete. La decision est tracee.`,
      });
      onOpenChange(false);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setPending(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Validation humaine du plan {planId}</DialogTitle>
          <DialogDescription>
            Votre decision sera journalisee avec votre identite, l&apos;horodatage et votre
            commentaire. Le commentaire est obligatoire.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <ScenarioBadge scenario={run.scenario} />
            {run.rag_fallback ? <Badge variant="warning">Repli RAG</Badge> : null}
            <CorrelationId value={run.correlation_id} />
          </div>

          {run.rag_fallback ? <RagFallbackBanner /> : null}

          <div className="space-y-2">
            <Label htmlFor="comment">
              Commentaire <span className="text-danger">*</span>
            </Label>
            <Textarea
              id="comment"
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                if (commentError) setCommentError(null);
              }}
              placeholder="Justifiez votre decision : contexte reseau, contraintes, reserves eventuelles…"
              aria-invalid={!!commentError}
              aria-describedby={commentError ? "comment-error" : "comment-hint"}
              required
            />
            {commentError ? (
              <p id="comment-error" role="alert" className="text-xs text-red-300">
                {commentError}
              </p>
            ) : (
              <p id="comment-hint" className="text-xs text-muted-foreground">
                Ce texte apparaitra tel quel dans la carte de decision signee.
              </p>
            )}
          </div>

          {error ? <ErrorState error={error} compact /> : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => submit(false)}
            loading={pending === "reject"}
            disabled={pending !== null}
          >
            <ThumbsDown className="h-4 w-4" aria-hidden="true" />
            Rejeter
          </Button>
          <Button
            onClick={() => submit(true)}
            loading={pending === "approve"}
            disabled={pending !== null}
          >
            <ThumbsUp className="h-4 w-4" aria-hidden="true" />
            Valider le plan {planId}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*                              File "A valider"                               */
/* -------------------------------------------------------------------------- */

function ValidationQueue({ onValidate }: { onValidate: (run: Run) => void }) {
  const { validations, error, isLoading, mutate } = useValidations();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          File d&apos;attente — a valider
          {validations?.length ? (
            <Badge variant="default" className="ml-1">
              {validations.length}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          Plans proposes par les operateurs et en attente de votre decision.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && !validations ? (
          <TableSkeleton rows={3} cols={3} />
        ) : error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : validations?.length ? (
          <ul className="space-y-2">
            {validations.map((run) => (
              <li
                key={run.correlation_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-3"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="default">Plan {run.proposed_plan_id}</Badge>
                    <ScenarioBadge scenario={run.scenario} />
                    {run.rag_fallback ? <Badge variant="warning">Repli RAG</Badge> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      Propose par{" "}
                      <strong className="text-foreground">{run.proposed_by ?? "—"}</strong>
                    </span>
                    <span>{fmtRelative(run.created_at)}</span>
                    <CorrelationId value={run.correlation_id} />
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/plans?cid=${run.correlation_id}`}>Examiner</Link>
                  </Button>
                  <Button size="sm" onClick={() => onValidate(run)}>
                    Valider / rejeter
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Aucun plan en attente"
            description="Les plans proposes par les operateurs apparaitront ici."
            icon={CheckCircle2}
          />
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Page                                     */
/* -------------------------------------------------------------------------- */

function PlansView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cid = searchParams.get("cid");

  const { canPropose, canValidate, role } = usePermissions();
  const { runs } = useRuns(20);
  const { run, error: runError, isLoading, mutate } = useRun(cid);
  const revalidate = useRevalidate();

  const [generating, setGenerating] = React.useState(false);
  const [proposing, setProposing] = React.useState(false);
  const [selected, setSelected] = React.useState<PlanId | null>(null);
  const [actionError, setActionError] = React.useState<unknown>(null);
  const [dialogRun, setDialogRun] = React.useState<Run | null>(null);

  // Un plan deja propose devient la selection courante.
  React.useEffect(() => {
    if (run?.proposed_plan_id) setSelected(run.proposed_plan_id);
  }, [run?.proposed_plan_id]);

  const plans = run?.plans ?? [];
  const ragFallback = run?.rag_fallback ?? false;
  const alreadyProposed = !!run?.proposed_plan_id;
  const alreadyDecided = !!run?.decision_id;

  /* ------------------------------------------------- generation des plans */
  const generatePlans = async () => {
    if (!cid) return;
    setActionError(null);
    setGenerating(true);
    try {
      const updated = await api.runs.generatePlans(cid);
      await mutate(updated, { revalidate: false });
      toast({
        variant: updated.rag_fallback ? "warning" : "success",
        title: updated.rag_fallback
          ? "Plans generes — preuve insuffisante"
          : "Plans generes",
        description: updated.rag_fallback
          ? "Le RAG est en repli : aucun plan n'est selectionnable automatiquement."
          : `${updated.plans?.length ?? 0} plans candidats sources par RAG.`,
      });
    } catch (err) {
      setActionError(err);
    } finally {
      setGenerating(false);
    }
  };

  /* --------------------------------------------------- proposition (HITL) */
  const proposePlan = async () => {
    if (!cid || !selected) return;
    setActionError(null);
    setProposing(true);
    try {
      const updated = await api.runs.propose(cid, selected);
      await mutate(updated, { revalidate: false });
      revalidate(KEYS.validations);
      toast({
        variant: "success",
        title: `Plan ${selected} propose`,
        description: "Un superviseur doit maintenant le valider avec un commentaire.",
      });
    } catch (err) {
      setActionError(err);
      toast({
        variant: "destructive",
        title: "Proposition impossible",
        description: `${errorMessage(err)}${
          errorCorrelationId(err) ? ` (ref. ${errorCorrelationId(err)?.slice(0, 8)})` : ""
        }`,
      });
    } finally {
      setProposing(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Plans de reequilibrage"
        description="Trois plans candidats sources par recherche documentaire. Aucun plan n'est execute sans validation humaine."
        actions={
          cid ? <CorrelationId value={cid} truncate={false} /> : null
        }
      />

      {/* File d'attente : superviseurs et admins uniquement. */}
      {canValidate ? (
        <div className="mb-6">
          <ValidationQueue onValidate={(r) => setDialogRun(r)} />
        </div>
      ) : null}

      {/* --------------------------------------------------- choix du run */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Run analyse</CardTitle>
          <CardDescription>
            Selectionnez le run pour lequel generer ou consulter les plans.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[280px] flex-1 space-y-2">
              <Label htmlFor="run-select">Run</Label>
              <Select
                value={cid ?? ""}
                onValueChange={(v) => router.push(`/plans?cid=${v}`)}
              >
                <SelectTrigger id="run-select" aria-label="Choisir un run">
                  <SelectValue placeholder="Choisir un run…" />
                </SelectTrigger>
                <SelectContent>
                  {runs?.length ? (
                    runs.map((r) => (
                      <SelectItem key={r.correlation_id} value={r.correlation_id}>
                        {r.correlation_id.slice(0, 8)} · {r.scenario} · {fmtRelative(r.created_at)}
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

            {run ? (
              <div className="flex flex-wrap items-center gap-2 pb-2">
                <RunStatusBadge status={run.status} />
                <ScenarioBadge scenario={run.scenario} />
                {alreadyDecided ? <Badge variant="success">Decision journalisee</Badge> : null}
              </div>
            ) : null}

            {cid && !plans.length ? (
              <Button onClick={generatePlans} loading={generating}>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Generer les plans (WF-3)
              </Button>
            ) : cid ? (
              <Button variant="outline" onClick={generatePlans} loading={generating}>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Regenerer
              </Button>
            ) : null}
          </div>

          {actionError ? <ErrorState error={actionError} className="mt-4" /> : null}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------- les plans */}
      {!cid ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              title="Aucun run selectionne"
              description="Choisissez un run ci-dessus, ou lancez une nouvelle simulation."
              icon={ListChecks}
              action={
                <Button asChild size="sm">
                  <Link href="/simulation">Lancer une simulation</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : runError ? (
        <ErrorState error={runError} onRetry={() => mutate()} />
      ) : isLoading && !run ? (
        <TableSkeleton rows={3} cols={3} />
      ) : plans.length ? (
        <div className="space-y-5">
          {/* BANDEAU AMBRE si repli RAG. */}
          {ragFallback ? <RagFallbackBanner /> : null}

          <div className="grid gap-5 lg:grid-cols-3">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                selected={selected === plan.id}
                proposed={run?.proposed_plan_id === plan.id}
                // En repli RAG, aucun plan n'est selectionnable AUTOMATIQUEMENT :
                // l'operateur doit tout de meme pouvoir en proposer un explicitement.
                selectable={canPropose && !alreadyProposed}
                onSelect={canPropose && !alreadyProposed ? setSelected : undefined}
              />
            ))}
          </div>

          {/* ------------------------------------------ barre d'action HITL */}
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
              {alreadyDecided ? (
                <>
                  <p className="flex items-center gap-2 text-sm text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Ce run a fait l&apos;objet d&apos;une decision validee et journalisee.
                  </p>
                  <Button asChild variant="outline">
                    <Link href={`/decisions?cid=${run?.correlation_id}`}>
                      Voir la carte de decision
                    </Link>
                  </Button>
                </>
              ) : alreadyProposed ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Le plan{" "}
                    <strong className="text-foreground">{run?.proposed_plan_id}</strong> a ete
                    propose par{" "}
                    <strong className="text-foreground">{run?.proposed_by ?? "—"}</strong>. Il est
                    en attente de validation par un superviseur.
                  </p>
                  {canValidate && run ? (
                    <Button onClick={() => setDialogRun(run)}>Valider / rejeter</Button>
                  ) : (
                    <Badge variant="warning">En attente de validation</Badge>
                  )}
                </>
              ) : canPropose ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {selected
                      ? `Vous vous appretez a proposer le plan ${selected} a la validation humaine.`
                      : "Selectionnez un plan pour le proposer a la validation d'un superviseur."}
                  </p>
                  <Button onClick={proposePlan} disabled={!selected} loading={proposing}>
                    <ThumbsUp className="h-4 w-4" aria-hidden="true" />
                    Proposer le plan {selected ?? ""}
                  </Button>
                </>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                  Votre role ({role}) ne permet pas de proposer un plan.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              title="Aucun plan genere"
              description="Lancez WF-3 pour produire trois plans de reequilibrage candidats, sources par recherche documentaire."
              icon={Sparkles}
              action={
                <Button size="sm" onClick={generatePlans} loading={generating}>
                  Generer les plans (WF-3)
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}

      <ValidationDialog
        run={dialogRun}
        open={!!dialogRun}
        onOpenChange={(open) => !open && setDialogRun(null)}
        onDone={() => {
          revalidate(KEYS.validations, KEYS.decisions, KEYS.alerts);
          mutate();
        }}
      />
    </>
  );
}

/**
 * `useSearchParams()` (parametre `?cid=`) impose une frontiere Suspense.
 */
export default function PlansPage() {
  return (
    <React.Suspense fallback={<TableSkeleton rows={5} cols={3} />}>
      <PlansView />
    </React.Suspense>
  );
}
