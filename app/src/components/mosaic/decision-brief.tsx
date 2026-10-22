"use client";

import type { ResearchTarget } from "./studio-model";
import { AGENT_OBJECTIVE_OPTIONS, researchTargetForResult, targetTypeLabel, type AgentObjectiveKind, type AgentResearchResponse, type StudioResearchResult } from "./studio-model";
import type { DecisionStability } from "@/core/decision-stability/contracts";
import type { DecisionConclusion, DecisionAssessment } from "@/agent/decision/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";
import { Card, SelectControl, StatusBadge } from "./primitives";
import { decisionBriefAssessment as sharedDecisionBriefAssessment, decisionBriefEvidence as sharedDecisionBriefEvidence, decisionBriefGeographicSummary as sharedDecisionBriefGeographicSummary, decisionBriefNextAction as sharedDecisionBriefNextAction, decisionBriefStabilityLabel as sharedDecisionBriefStabilityLabel, decisionBriefVerdictLabel as sharedDecisionBriefVerdictLabel } from "./decision-brief-model";

export type AgentResearchDraft = {
  enabled: boolean;
  objective: AgentObjectiveKind;
  followUpTarget: ResearchTarget | "none";
};

export function AgentResearchControls({ value, initialTarget, onChange }: { value: AgentResearchDraft; initialTarget: ResearchTarget; onChange: (next: AgentResearchDraft) => void }) {
  const alternateTarget: ResearchTarget = initialTarget === "urn:entity:brand" ? "urn:entity:place" : "urn:entity:brand";
  const objective = AGENT_OBJECTIVE_OPTIONS.find((option) => option.value === value.objective) ?? AGENT_OBJECTIVE_OPTIONS[0]!;
  return <div className="flex w-full flex-wrap items-start gap-4 rounded-[var(--mosaic-radius-sm)] border border-[var(--mosaic-line)] bg-[rgb(251_248_241_/_0.58)] p-3.5" aria-label="Optional bounded research">
    <label className="flex min-h-10 items-center gap-2 text-sm text-[var(--mosaic-ink)]">
      <input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} />
      <span><strong>Enable bounded research assistant</strong><small className="block text-xs text-[var(--mosaic-muted)]">Mosaic may run one explicitly authorized follow-up.</small></span>
    </label>
    {value.enabled && <>
      <SelectControl className="min-w-[15rem] [&>label]:text-[11px] [&>label]:uppercase [&>label]:tracking-[0.12em] [&_select]:min-h-10" label="Research objective" value={value.objective} onChange={(event) => onChange({ ...value, objective: event.target.value as AgentObjectiveKind })} options={AGENT_OBJECTIVE_OPTIONS.map((option) => ({ label: option.label, value: option.value }))} />
      <SelectControl className="min-w-[13rem] [&>label]:text-[11px] [&>label]:uppercase [&>label]:tracking-[0.12em] [&_select]:min-h-10" label="Optional additional dimension" value={value.followUpTarget} onChange={(event) => onChange({ ...value, followUpTarget: event.target.value as AgentResearchDraft["followUpTarget"] })} options={[{ label: "No additional research", value: "none" }, { label: alternateTarget === "urn:entity:brand" ? "Brands" : "Places", value: alternateTarget }]} />
      <p className="max-w-sm self-end text-xs leading-5 text-[var(--mosaic-muted)]">{objective.description} An additional category is investigated only when you select it.</p>
    </>}
  </div>;
}

function agentStatusLabel(agent: AgentResearchResponse | undefined): string {
  if (!agent) return "Agent disabled";
  const conclusion = agent.assessment?.conclusion;
  if (conclusion === "geographic-differences-observed") return "Geographic differences observed";
  if (conclusion === "no-observed-differences") return "No observed differentiation";
  if (conclusion === "follow-up-required") return "Further research performed";
  if (conclusion === "comparison-incomplete" || conclusion === "evidence-insufficient") return "Evidence incomplete";
  if (conclusion === "follow-up-unavailable") return "No supported follow-up available";
  const status = agent.status;
  if (status === "completed") return agent.followUpEvidence?.length ? "Follow-up completed" : "Agent completed";
  if (status === "partial") return "Evidence incomplete";
  if (status === "unavailable") return "No supported follow-up available";
  return "Research complete";
}

export function decisionBriefAssessment(result: StudioResearchResult) {
  return sharedDecisionBriefAssessment(result);
}

function verdictLabel(conclusion: DecisionConclusion): string {
  return sharedDecisionBriefVerdictLabel(conclusion);
}

function stabilityLabel(stability: DecisionStability): string {
  return sharedDecisionBriefStabilityLabel(stability);
}

function evidenceForResult(result: StudioResearchResult, ids: string[]): CulturalEvidence[] {
  return sharedDecisionBriefEvidence(result, ids);
}

export function decisionBriefGeographicSummary(result: StudioResearchResult): string {
  return sharedDecisionBriefGeographicSummary(result);
  /*
  const markets = `${result.baselineScenario.launchLocation} and ${result.alternativeScenario.launchLocation}`;
  const target = targetTypeLabel(researchTargetForResult(result));
  const changes = result.comparison.evidenceChanges.length + result.comparison.changedObservedRelationships.length;
  if (result.status !== "completed" || result.errors.length > 0) return `The comparison across ${markets} is incomplete; no geographic conclusion is supported.`;
  if (changes > 0) return `${changes} provider-backed ${target} observation change${changes === 1 ? "" : "s"} were recorded across ${markets}. This describes returned evidence, not market superiority.`;
  return `The returned ${target} observations for ${markets} showed no observed differentiation. This does not establish identical cultural landscapes.`;
  */
}

export function decisionBriefNextAction(result: StudioResearchResult, assessment: Pick<DecisionAssessment, "conclusion" | "gaps" | "decision">): string {
  return sharedDecisionBriefNextAction(result, assessment);
  /*
  if (assessment.conclusion === "unsupported-commercial-conclusion") return "Validate demand and commercial viability with independent market research; Qloo affinity does not answer those questions.";
  if (assessment.decision.action === "FOLLOW_UP_APPROVED" && (result.agentResearch?.followUpEvidence?.length ?? 0) === 0) return "Complete the explicitly authorized follow-up only if the bounded provider action is still available.";
  if (assessment.gaps.length > 0) return assessment.gaps[0]?.whyItMatters ?? "Address the identified evidence gap with an explicitly authorized research dimension.";
  return "No additional Qloo query is required for this scope. Use independent commercial research before making a launch decision.";
  */
}

export function DecisionBrief({ result, compact = false, stability, onInspectEvidence }: { result?: StudioResearchResult; compact?: boolean; stability?: DecisionStability; onInspectEvidence?: (evidenceId: string) => void }) {
  const agent = result?.agentResearch;
  if (!result) return null;
  const assessment = decisionBriefAssessment(result);
  const trace = agent?.trace;
  const evidenceCount = agent?.followUpEvidence?.length ?? 0;
  const evidenceItems = evidenceForResult(result, assessment.evidenceIds).slice(0, 6);
  const followUpTargets = [...new Set((agent?.followUpEvidence ?? []).map((item) => item.kind === "affinity" ? targetTypeLabel(item.queryParameters["filter.type"]) : undefined).filter(Boolean))];
  const followUpMarkets = [...new Set((agent?.followUpEvidence ?? []).map((item) => item.kind === "affinity" ? item.queryParameters["signal.location.query"] ?? item.queryParameters["filter.location.query"] : undefined).filter(Boolean))];
  return <Card className={compact ? "p-4" : "mt-7 p-5 sm:p-6"} as="section" aria-labelledby={compact ? "canvas-agent-brief-title" : "studio-agent-brief-title"}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--mosaic-cobalt)]">Decision brief</p><h2 id={compact ? "canvas-agent-brief-title" : "studio-agent-brief-title"} className="mosaic-serif mt-2 text-2xl text-[var(--mosaic-ink)]">Evidence-led research assessment</h2></div><StatusBadge label={verdictLabel(assessment.conclusion)} tone={assessment.status === "supported" ? "positive" : "attention"} /></div>
    {agent?.error && <p className="mt-4 text-sm leading-5 text-[var(--mosaic-muted)]">Agent status: {agent.error.message}</p>}
    <div className="mt-5 grid gap-4 text-sm leading-5 text-[var(--mosaic-ink)] sm:grid-cols-2"><div><strong className="block text-xs uppercase tracking-[0.12em] text-[var(--mosaic-muted)]">Research verdict</strong><p className="mt-1">{assessment.summary}</p></div><div><strong className="block text-xs uppercase tracking-[0.12em] text-[var(--mosaic-muted)]">Research scope</strong><p className="mt-1">{result.baselineScenario.launchLocation} and {result.alternativeScenario.launchLocation} · {targetTypeLabel(researchTargetForResult(result))} entities · Qloo provider observations.</p></div><div><strong className="block text-xs uppercase tracking-[0.12em] text-[var(--mosaic-muted)]">Geographic evidence</strong><p className="mt-1">{decisionBriefGeographicSummary(result)}</p></div><div><strong className="block text-xs uppercase tracking-[0.12em] text-[var(--mosaic-muted)]">Remaining uncertainty</strong><p className="mt-1">{assessment.gaps.length > 0 ? assessment.gaps[0]?.whyItMatters : "Cultural affinity does not establish demand, sales, commercial viability, or launch success."}</p></div><div><strong className="block text-xs uppercase tracking-[0.12em] text-[var(--mosaic-muted)]">Next research action</strong><p className="mt-1">{decisionBriefNextAction(result, assessment)}</p></div></div>
    {agent && <div className="mt-4 rounded-[var(--mosaic-radius-sm)] bg-[var(--mosaic-blue-wash)] p-3 text-xs leading-5 text-[var(--mosaic-muted)]"><strong className="text-[var(--mosaic-ink)]">Agent investigation:</strong> {agentStatusLabel(agent)}{evidenceCount > 0 ? ` · ${evidenceCount} additional ${followUpTargets.join(" and ")} observation${evidenceCount === 1 ? "" : "s"} across ${followUpMarkets.join(" and ")}.` : ` · ${trace?.stopReason ? `stopped because ${trace.stopReason}.` : "No follow-up evidence was returned."}`}</div>}
    {!agent && <p className="mt-4 rounded-[var(--mosaic-radius-sm)] bg-[var(--mosaic-blue-wash)] p-3 text-xs leading-5 text-[var(--mosaic-muted)]"><strong className="text-[var(--mosaic-ink)]">Agent investigation:</strong> Disabled. This brief uses the deterministic assessment of the validated primary research.</p>}
    {stability && <div className="mt-4 rounded-[var(--mosaic-radius-sm)] border border-[var(--mosaic-line)] p-3 text-xs leading-5 text-[var(--mosaic-muted)]"><strong className="block text-[var(--mosaic-ink)]">Counterfactual stability: {stabilityLabel(stability)}</strong><p className="mt-1">{stability.explanation}</p><p className="mt-1">Evidence: {stability.evidenceChange} · conclusion: {stability.conclusionChange}. {stability.limitations[0] ?? ""}</p></div>}
    {evidenceItems.length > 0 && <details className="mt-4"><summary className="cursor-pointer text-xs font-semibold text-[var(--mosaic-ink)]">Inspect supporting evidence ({assessment.evidenceIds.length})</summary><div className="mt-2 flex flex-wrap gap-2">{evidenceItems.map((item) => <button type="button" key={item.id} onClick={() => onInspectEvidence?.(item.id)} disabled={!onInspectEvidence} className="rounded-full bg-[var(--mosaic-blue-wash)] px-2.5 py-1 text-[10px] text-[var(--mosaic-cobalt)] disabled:cursor-default">{item.kind === "affinity" ? item.objectEntityName ?? item.objectEntityCategory : item.id}</button>)}</div></details>}
    {trace && <details className="mt-5 border-t border-[rgb(120_93_58_/_0.16)] pt-4"><summary className="cursor-pointer text-sm font-semibold text-[var(--mosaic-ink)]">Inspect research trace</summary><div className="mt-4 grid gap-3 text-xs leading-5 text-[var(--mosaic-muted)]"><p><strong className="text-[var(--mosaic-ink)]">Decision:</strong> {trace.decision.action} — {trace.decision.reason}</p><p><strong className="text-[var(--mosaic-ink)]">Stop reason:</strong> {trace.stopReason ?? "Not stopped"}</p><p><strong className="text-[var(--mosaic-ink)]">Budget:</strong> {trace.budget.logicalOperationsUsed} of {trace.budget.maxLogicalOperations} logical provider operations; {trace.budget.followUpRoundsUsed} of {trace.budget.maxFollowUpRounds} follow-up rounds.</p><p><strong className="text-[var(--mosaic-ink)]">Evidence references:</strong> {assessment.evidenceIds.length} validated references.</p><details><summary className="cursor-pointer">Technical request details</summary><div className="mt-2 grid gap-2">{trace.steps.map((step) => <div key={`${step.index}-${step.action}`} className="rounded border border-[var(--mosaic-line)] p-2"><span className="font-semibold text-[var(--mosaic-ink)]">{step.action}</span> · {step.outcome}{step.requestFingerprint && <span className="block font-mono text-[10px]">{step.requestFingerprint}</span>}</div>)}</div></details></div></details>}
    {!compact && <p className="mt-5 text-xs leading-5 text-[var(--mosaic-muted)]">Cultural affinity evidence does not establish sales, demand, commercial viability, partnership suitability, or guaranteed launch success.</p>}
  </Card>;
}
