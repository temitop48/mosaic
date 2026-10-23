"use client";

import type { ResearchTarget } from "./studio-model";
import { AGENT_OBJECTIVE_OPTIONS, researchTargetForResult, targetTypeLabel, type AgentObjectiveKind, type AgentResearchResponse, type StudioResearchResult } from "./studio-model";
import type { DecisionStability } from "@/core/decision-stability/contracts";
import type { DecisionConclusion, DecisionAssessment } from "@/agent/decision/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";
import { Card, SelectControl, StatusBadge } from "./primitives";
import { decisionBriefAssessment as sharedDecisionBriefAssessment, decisionBriefEvidence as sharedDecisionBriefEvidence, decisionBriefGeographicSummary as sharedDecisionBriefGeographicSummary, decisionBriefNextAction as sharedDecisionBriefNextAction, decisionBriefStabilityLabel as sharedDecisionBriefStabilityLabel, decisionBriefVerdictLabel as sharedDecisionBriefVerdictLabel, followUpEvidenceCount, followUpEvidenceGroups, followUpRationale, formatAffinityValue, stopRationale, type FollowUpEvidenceGroup } from "./decision-brief-model";

export type AgentResearchDraft = {
  enabled: boolean;
  objective: AgentObjectiveKind;
  followUpTarget: ResearchTarget | "none";
};

export function AgentResearchControls({ value, initialTarget, onChange }: { value: AgentResearchDraft; initialTarget: ResearchTarget; onChange: (next: AgentResearchDraft) => void }) {
  const alternateTarget: ResearchTarget = initialTarget === "urn:entity:brand" ? "urn:entity:place" : "urn:entity:brand";
  const objective = AGENT_OBJECTIVE_OPTIONS.find((option) => option.value === value.objective) ?? AGENT_OBJECTIVE_OPTIONS[0]!;
  return <div className="mosaic-agent-control w-full rounded-[var(--mosaic-radius-sm)] border border-[var(--mosaic-line)] bg-[rgb(251_248_241_/_0.58)] p-2.5" aria-label="Optional bounded research">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="flex min-h-9 items-center gap-2 text-sm text-[var(--mosaic-ink)]" htmlFor="agent-research-enabled">
        <input id="agent-research-enabled" type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} aria-describedby="agent-research-help" />
        <span><strong className="block">Research Assistant</strong><small className="block text-xs text-[var(--mosaic-muted)]">Optional · Off by default</small></span>
      </label>
      <p id="agent-research-help" className="max-w-xl text-xs leading-5 text-[var(--mosaic-muted)]">Allow Mosaic to investigate one additional authorized cultural dimension when the research requires it.</p>
    </div>
    {value.enabled && <div className="mt-2 grid gap-3 border-t border-[var(--mosaic-line)] pt-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)] sm:items-end">
      <SelectControl className="[&>label]:text-[10px] [&>label]:uppercase [&>label]:tracking-[0.12em] [&_select]:min-h-9" label="Research objective" value={value.objective} onChange={(event) => onChange({ ...value, objective: event.target.value as AgentObjectiveKind })} options={AGENT_OBJECTIVE_OPTIONS.map((option) => ({ label: option.label, value: option.value }))} />
      <SelectControl className="[&>label]:text-[10px] [&>label]:uppercase [&>label]:tracking-[0.12em] [&_select]:min-h-9" label="Authorize one additional dimension" value={value.followUpTarget} onChange={(event) => onChange({ ...value, followUpTarget: event.target.value as AgentResearchDraft["followUpTarget"] })} options={[{ label: "No additional research", value: "none" }, { label: alternateTarget === "urn:entity:brand" ? "Brands" : "Places", value: alternateTarget }]} />
      <p className="text-xs leading-5 text-[var(--mosaic-muted)]">{objective.description} The selected category is investigated only when an evidence gap justifies it.</p>
    </div>}
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

function followUpStrategyLabel(group: FollowUpEvidenceGroup): string {
  if (group.placeInventory) return "Location-specific place coverage";
  if (group.strategy === "location-signal") return "Location-conditioned provider relationships";
  if (group.strategy === "location-filter") return "Geographically filtered provider observations";
  return "Geographic strategy unavailable";
}

function followUpOutcome(agent: AgentResearchResponse, count: number): string {
  if (agent.status === "completed" && count > 0) return "Authorized follow-up completed and validated.";
  if (agent.status === "partial") return count > 0 ? "Partial follow-up: only validated observations are shown." : "Follow-up was partial, but no validated observations are available.";
  if (agent.status === "unavailable") return "No verified follow-up results are available.";
  if (agent.status === "stopped") return "No follow-up was executed.";
  return count > 0 ? "Validated follow-up observations are available." : "No verified follow-up results are available.";
}

function EvidenceReference({ value }: { value: string }) {
  const isUrl = /^https?:\/\//i.test(value);
  return isUrl
    ? <a className="text-[var(--mosaic-cobalt)] underline underline-offset-2" href={value} target="_blank" rel="noreferrer">Provider source</a>
    : <span>{value}</span>;
}

function FollowUpGroup({ group, compact }: { group: FollowUpEvidenceGroup; compact: boolean }) {
  return <details className="rounded-[var(--mosaic-radius-sm)] border border-[var(--mosaic-line)] p-3">
    <summary className="cursor-pointer text-xs font-semibold text-[var(--mosaic-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mosaic-cobalt)]">
      {group.targetLabel} in {group.market} · {group.evidence.length} validated observation{group.evidence.length === 1 ? "" : "s"}
    </summary>
    <div className="mt-3 grid gap-2">
      <p className="text-xs leading-5 text-[var(--mosaic-muted)]">{followUpStrategyLabel(group)}. Provider affinity values and identities are shown as returned; they do not establish demand or market advantage.</p>
      {group.evidence.map((item) => <details key={item.id} className="rounded border border-[var(--mosaic-line)] bg-[rgb(251_248_241_/_0.55)] p-2">
        <summary className="cursor-pointer text-xs text-[var(--mosaic-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mosaic-cobalt)]">
          <span className="font-semibold">{item.objectEntityName ?? `${item.objectEntityCategory} entity`}</span>{item.providerScore !== undefined && <span className="ml-2 text-[var(--mosaic-muted)]">affinity {formatAffinityValue(item.providerScore)}</span>}
        </summary>
        <div className="mt-2 grid gap-1.5 text-[11px] leading-5 text-[var(--mosaic-muted)]">
          <p><strong className="text-[var(--mosaic-ink)]">Validated:</strong> Provider-backed affinity observation</p>
          <p><strong className="text-[var(--mosaic-ink)]">Provider:</strong> {item.provenance.providerId}</p>
          {item.providerScoreScale && <p><strong className="text-[var(--mosaic-ink)]">Score scale:</strong> {item.providerScoreScale}</p>}
          {!compact && <><p><strong className="text-[var(--mosaic-ink)]">Evidence ID:</strong> <span className="font-mono">{item.id}</span></p><p><strong className="text-[var(--mosaic-ink)]">Entity ID:</strong> <span className="font-mono">{item.objectEntityId}</span></p><p><strong className="text-[var(--mosaic-ink)]">Source:</strong> <EvidenceReference value={item.provenance.sourceReference} /></p><p><strong className="text-[var(--mosaic-ink)]">Geographic query:</strong> {item.queryParameters["signal.location.query"] ? `signal.location.query=${item.queryParameters["signal.location.query"]}` : item.queryParameters["filter.location.query"] ? `filter.location.query=${item.queryParameters["filter.location.query"]}` : item.geographicContext?.city ? `validated city context=${item.geographicContext.city}` : "Not available"}</p></>}
        </div>
      </details>)}
    </div>
  </details>;
}

function FollowUpFindings({ result, compact }: { result: StudioResearchResult; compact: boolean }) {
  const agent = result.agentResearch;
  if (!agent) return null;
  const groups = followUpEvidenceGroups(result);
  const count = followUpEvidenceCount(result);
  const hasFollowUpState = groups.length > 0 || agent.status === "partial" || agent.status === "unavailable" || agent.status === "stopped";
  if (!hasFollowUpState) return null;
  const dimensions = [...new Set(groups.map((group) => group.targetLabel))];
  const markets = [...new Set(groups.map((group) => group.market))];
  return <section className="mt-4 rounded-[var(--mosaic-radius-sm)] border border-[var(--mosaic-line)] bg-[rgb(251_248_241_/_0.5)] p-3" aria-labelledby={compact ? "canvas-follow-up-findings" : "studio-follow-up-findings"}>
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 id={compact ? "canvas-follow-up-findings" : "studio-follow-up-findings"} className="text-sm font-semibold text-[var(--mosaic-ink)]">Research Assistant Findings</h3><p className="mt-1 text-xs leading-5 text-[var(--mosaic-muted)]">{dimensions.length > 0 ? `${dimensions.join(" and ")} · ${markets.join(" and ")} · ${count} validated observation${count === 1 ? "" : "s"}` : "No validated follow-up observations"}</p></div><span className="text-[10px] uppercase tracking-[0.12em] text-[var(--mosaic-muted)]">{agent.status}</span></div>
    <div className="mt-2 grid gap-1 text-xs leading-5 text-[var(--mosaic-muted)]"><p><strong className="text-[var(--mosaic-ink)]">Outcome:</strong> {followUpOutcome(agent, count)}</p><p><strong className="text-[var(--mosaic-ink)]">Why investigated:</strong> {followUpRationale(agent, dimensions[0])}</p>{stopRationale(agent) && <p><strong className="text-[var(--mosaic-ink)]">Stopped afterward:</strong> {stopRationale(agent)}</p>}</div>
    {groups.length > 0 && <div className="mt-3 grid gap-2">{groups.map((group) => <FollowUpGroup key={group.key} group={group} compact={compact} />)}</div>}
  </section>;
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
  const followUpGroups = followUpEvidenceGroups(result);
  const evidenceCount = followUpEvidenceCount(result);
  const evidenceItems = evidenceForResult(result, assessment.evidenceIds).slice(0, 6);
  const followUpTargets = [...new Set(followUpGroups.map((group) => group.targetLabel))];
  const followUpMarkets = [...new Set(followUpGroups.map((group) => group.market))];
  return <Card className={compact ? "p-4" : "mt-7 p-5 sm:p-6"} as="section" aria-labelledby={compact ? "canvas-agent-brief-title" : "studio-agent-brief-title"}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--mosaic-cobalt)]">Decision brief</p><h2 id={compact ? "canvas-agent-brief-title" : "studio-agent-brief-title"} className="mosaic-serif mt-2 text-2xl text-[var(--mosaic-ink)]">Evidence-led research assessment</h2></div><StatusBadge label={verdictLabel(assessment.conclusion)} tone={assessment.status === "supported" ? "positive" : "attention"} /></div>
    {agent?.error && <p className="mt-4 text-sm leading-5 text-[var(--mosaic-muted)]">Agent status: {agent.error.message}</p>}
    <div className="mt-5 grid gap-4 text-sm leading-5 text-[var(--mosaic-ink)] sm:grid-cols-2"><div><strong className="block text-xs uppercase tracking-[0.12em] text-[var(--mosaic-muted)]">Primary {targetTypeLabel(researchTargetForResult(result))} conclusion</strong><p className="mt-1">{assessment.summary}</p></div><div><strong className="block text-xs uppercase tracking-[0.12em] text-[var(--mosaic-muted)]">Research scope</strong><p className="mt-1">{result.baselineScenario.launchLocation} and {result.alternativeScenario.launchLocation} · {targetTypeLabel(researchTargetForResult(result))} entities · Qloo provider observations.</p></div><div><strong className="block text-xs uppercase tracking-[0.12em] text-[var(--mosaic-muted)]">Additional research coverage</strong><p className="mt-1">{evidenceCount > 0 ? `${evidenceCount} validated ${followUpTargets.join(" and ")} observation${evidenceCount === 1 ? "" : "s"} kept separate from the primary ${targetTypeLabel(researchTargetForResult(result))} conclusion.` : "No additional research coverage was returned."}</p></div><div><strong className="block text-xs uppercase tracking-[0.12em] text-[var(--mosaic-muted)]">Remaining unsupported commercial conclusions</strong><p className="mt-1">Demand, sales, commercial viability, market advantage, and launch success remain unsupported by affinity evidence.</p></div><div><strong className="block text-xs uppercase tracking-[0.12em] text-[var(--mosaic-muted)]">Geographic evidence</strong><p className="mt-1">{decisionBriefGeographicSummary(result)}</p></div><div><strong className="block text-xs uppercase tracking-[0.12em] text-[var(--mosaic-muted)]">Next research action</strong><p className="mt-1">{decisionBriefNextAction(result, assessment)}</p></div></div>
    {agent && <div className="mt-4 rounded-[var(--mosaic-radius-sm)] bg-[var(--mosaic-blue-wash)] p-3 text-xs leading-5 text-[var(--mosaic-muted)]"><strong className="text-[var(--mosaic-ink)]">Agent investigation:</strong> {agentStatusLabel(agent)}{evidenceCount > 0 ? ` · ${evidenceCount} additional ${followUpTargets.join(" and ")} observation${evidenceCount === 1 ? "" : "s"} across ${followUpMarkets.join(" and ")}.` : ` · ${trace?.stopReason ? `stopped because ${trace.stopReason}.` : "No follow-up evidence was returned."}`}</div>}
    {!agent && <p className="mt-4 rounded-[var(--mosaic-radius-sm)] bg-[var(--mosaic-blue-wash)] p-3 text-xs leading-5 text-[var(--mosaic-muted)]"><strong className="text-[var(--mosaic-ink)]">Agent investigation:</strong> Disabled. This brief uses the deterministic assessment of the validated primary research.</p>}
    <FollowUpFindings result={result} compact={compact} />
    {stability && <div className="mt-4 rounded-[var(--mosaic-radius-sm)] border border-[var(--mosaic-line)] p-3 text-xs leading-5 text-[var(--mosaic-muted)]"><strong className="block text-[var(--mosaic-ink)]">Counterfactual stability: {stabilityLabel(stability)}</strong><p className="mt-1">{stability.explanation}</p><p className="mt-1">Evidence: {stability.evidenceChange} · conclusion: {stability.conclusionChange}. {stability.limitations[0] ?? ""}</p></div>}
    {evidenceItems.length > 0 && <details className="mt-4"><summary className="cursor-pointer text-xs font-semibold text-[var(--mosaic-ink)]">Inspect supporting evidence ({assessment.evidenceIds.length})</summary><div className="mt-2 flex flex-wrap gap-2">{evidenceItems.map((item) => <button type="button" key={item.id} onClick={() => onInspectEvidence?.(item.id)} disabled={!onInspectEvidence} className="rounded-full bg-[var(--mosaic-blue-wash)] px-2.5 py-1 text-[10px] text-[var(--mosaic-cobalt)] disabled:cursor-default">{item.kind === "affinity" ? item.objectEntityName ?? item.objectEntityCategory : item.id}</button>)}</div></details>}
    {trace && <details className="mt-5 border-t border-[rgb(120_93_58_/_0.16)] pt-4"><summary className="cursor-pointer text-sm font-semibold text-[var(--mosaic-ink)]">Inspect research trace</summary><div className="mt-4 grid gap-3 text-xs leading-5 text-[var(--mosaic-muted)]"><p><strong className="text-[var(--mosaic-ink)]">Decision:</strong> {trace.decision.action} — {trace.decision.reason}</p><p><strong className="text-[var(--mosaic-ink)]">Stop reason:</strong> {trace.stopReason ?? "Not stopped"}</p><p><strong className="text-[var(--mosaic-ink)]">Budget:</strong> {trace.budget.logicalOperationsUsed} of {trace.budget.maxLogicalOperations} logical provider operations; {trace.budget.followUpRoundsUsed} of {trace.budget.maxFollowUpRounds} follow-up rounds.</p><p><strong className="text-[var(--mosaic-ink)]">Evidence references:</strong> {assessment.evidenceIds.length} validated references.</p><details><summary className="cursor-pointer">Technical request details</summary><div className="mt-2 grid gap-2">{trace.steps.map((step) => <div key={`${step.index}-${step.action}`} className="rounded border border-[var(--mosaic-line)] p-2"><span className="font-semibold text-[var(--mosaic-ink)]">{step.action}</span> · {step.outcome}{step.requestFingerprint && <span className="block font-mono text-[10px]">{step.requestFingerprint}</span>}</div>)}</div></details></div></details>}
    {!compact && <p className="mt-5 text-xs leading-5 text-[var(--mosaic-muted)]">Cultural affinity evidence does not establish sales, demand, commercial viability, partnership suitability, or guaranteed launch success.</p>}
  </Card>;
}
