/**
 * Generation du rapport HTML d'un run.
 *
 * Contenu : KPI du run, plan valide, empreinte SHA-256 — et le DISCLAIMER,
 * qui figure obligatoirement dans tout document sortant.
 *
 * Le HTML est autonome (styles en ligne) pour survivre aux clients de messagerie,
 * et rendu dans une iframe `sandbox=""` cote UI (aucun script ne s'y execute).
 */
import { DISCLAIMER, type Decision, type Run } from "./contracts";
import { ACTION_LABELS, RUN_STATUS_LABELS, SCENARIO_LABELS } from "./types";
import { fmtDateTime, fmtMAD, fmtNumber, fmtPercent } from "./utils";

/** Echappement systematique : aucune donnee n'est injectee brute dans le HTML. */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function kpiRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #e6eaef;color:#5b6b7c;font-size:13px;">${esc(
        label,
      )}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e6eaef;color:#0d1b2a;font-size:13px;font-weight:600;text-align:right;font-family:ui-monospace,Menlo,monospace;">${esc(
        value,
      )}</td>
    </tr>`;
}

export function buildReportHtml(run: Run, decision: Decision | null): string {
  const validatedPlan =
    decision?.card.plan_id ?? run.proposed_plan_id ?? null;

  const plan = run.plans?.find((p) => p.id === validatedPlan) ?? null;

  const kpis: string[] = [
    kpiRow("Scenario", SCENARIO_LABELS[run.scenario]),
    kpiRow("Statut du run", RUN_STATUS_LABELS[run.status]),
    kpiRow("Cree le", fmtDateTime(run.created_at)),
    kpiRow("Lance par", run.created_by),
  ];

  if (run.deficit_summary) {
    kpis.push(
      kpiRow(
        "Deficit total",
        `${fmtNumber(run.deficit_summary.total_deficit_mwh, 0)} MWh`,
      ),
      kpiRow("Heures en deficit", `${run.deficit_summary.hours_in_deficit} h`),
      kpiRow("Pic de deficit", `${fmtNumber(run.deficit_summary.peak_deficit_mw, 1)} MW`),
    );
    if (run.deficit_summary.windless_window) {
      kpis.push(
        kpiRow(
          "Fenetre sans vent",
          `H+${run.deficit_summary.windless_window.start_h} → H+${run.deficit_summary.windless_window.end_h}`,
        ),
      );
    }
  }

  if (run.totals) {
    kpis.push(
      kpiRow("Cout total", fmtMAD(run.totals.total_cost)),
      kpiRow("Part batterie", fmtPercent(run.totals.share_battery)),
      kpiRow("Part reseau", fmtPercent(run.totals.share_grid)),
      kpiRow(
        "Violations de charges protegees",
        `${run.totals.protected_load_violations} (cible : 0)`,
      ),
    );
  }

  const actionsHtml = plan?.actions.length
    ? plan.actions
        .map(
          (a) => `
        <li style="margin:0 0 8px;padding:10px 12px;background:#f5f8fa;border-radius:6px;border:1px solid #e6eaef;">
          <div style="display:flex;justify-content:space-between;gap:12px;">
            <strong style="color:#0d1b2a;font-size:13px;">${esc(
              ACTION_LABELS[a.action],
            )} — ${esc(a.site)}</strong>
            <span style="color:#0d1b2a;font-size:13px;font-family:ui-monospace,Menlo,monospace;">${
              a.delta_mw > 0 ? "+" : ""
            }${esc(fmtNumber(a.delta_mw))} MW · ${a.hours.length} h</span>
          </div>
          ${
            a.justification
              ? `<p style="margin:6px 0 0;color:#5b6b7c;font-size:12px;line-height:1.5;">${esc(
                  a.justification,
                )}</p>`
              : ""
          }
        </li>`,
        )
        .join("")
    : `<li style="color:#5b6b7c;font-size:13px;">Aucune action.</li>`;

  const decisionBlock = decision
    ? `
      <h2 style="margin:28px 0 12px;font-size:15px;color:#0d1b2a;">Decision validee</h2>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e6eaef;border-radius:8px;overflow:hidden;">
        ${kpiRow("Plan valide", `Plan ${decision.card.plan_id}`)}
        ${kpiRow("Propose par", decision.card.proposed_by)}
        ${kpiRow("Validee par", decision.card.validated_by)}
        ${kpiRow("Horodatage", fmtDateTime(decision.card.validated_at))}
        ${kpiRow("Score d'equite", fmtPercent(decision.card.fairness_score, 0))}
        ${decision.card.rag_fallback ? kpiRow("Repli RAG", "Oui — preuve insuffisante") : ""}
      </table>

      <div style="margin-top:14px;padding:12px 14px;background:#f5f8fa;border-left:3px solid #17c884;border-radius:4px;">
        <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#5b6b7c;">Commentaire du superviseur</p>
        <p style="margin:0;color:#0d1b2a;font-size:13px;line-height:1.6;">${esc(
          decision.card.comment,
        )}</p>
      </div>

      <div style="margin-top:14px;padding:12px 14px;background:#0d1b2a;border-radius:6px;">
        <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#8fa3b5;">Empreinte SHA-256 de la carte de decision</p>
        <code style="display:block;word-break:break-all;color:#17c884;font-size:11px;font-family:ui-monospace,Menlo,monospace;">${esc(
          decision.sha256,
        )}</code>
      </div>`
    : `
      <h2 style="margin:28px 0 12px;font-size:15px;color:#0d1b2a;">Decision</h2>
      <p style="padding:12px 14px;background:#fff8e6;border:1px solid #f0d69a;border-radius:6px;color:#7a5c12;font-size:13px;margin:0;">
        Aucune decision validee pour ce run a ce jour. ${
          run.proposed_plan_id
            ? `Le plan ${esc(run.proposed_plan_id)} est propose et attend la validation d'un superviseur.`
            : "Aucun plan n'a encore ete propose."
        }
      </p>`;

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Rapport GridBalance — ${esc(run.correlation_id)}</title>
</head>
<body style="margin:0;padding:24px;background:#eef2f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0d1b2a;">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(13,27,42,.08);">

    <div style="padding:22px 26px;background:#040e1b;">
      <p style="margin:0;font-size:17px;font-weight:600;color:#ffffff;">GridBalance AI Morocco</p>
      <p style="margin:4px 0 0;font-size:12px;color:#8fa3b5;">
        Rapport de run — orchestrateur de flexibilite du reseau electrique
      </p>
    </div>

    <div style="padding:26px;">
      <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#5b6b7c;">Identifiant de correlation</p>
      <code style="display:block;margin-bottom:22px;word-break:break-all;color:#0d1b2a;font-size:12px;font-family:ui-monospace,Menlo,monospace;">${esc(
        run.correlation_id,
      )}</code>

      <h2 style="margin:0 0 12px;font-size:15px;color:#0d1b2a;">Indicateurs cles</h2>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e6eaef;border-radius:8px;overflow:hidden;">
        ${kpis.join("")}
      </table>

      ${
        plan
          ? `<h2 style="margin:28px 0 12px;font-size:15px;color:#0d1b2a;">Plan ${esc(
              plan.id,
            )} — actions (${plan.actions.length})</h2>
             <ul style="margin:0;padding:0;list-style:none;">${actionsHtml}</ul>`
          : ""
      }

      ${decisionBlock}
    </div>

    <div style="padding:16px 26px;background:#f5f8fa;border-top:1px solid #e6eaef;">
      <p style="margin:0;font-size:11px;line-height:1.6;color:#5b6b7c;">${esc(DISCLAIMER)}</p>
    </div>
  </div>
</body>
</html>`;
}
