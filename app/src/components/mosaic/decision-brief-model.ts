import type { DecisionAssessment, DecisionConclusion } from "@/agent/decision/contracts";
import type { DecisionStability } from "@/core/decision-stability/contracts";
import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";
import { CulturalEvidenceSchema, type AffinityEvidence } from "@/core/evidence/types";
import { RESEARCH_TARGET_BRAND, RESEARCH_TARGET_PLACE, researchTargetForResult, targetTypeLabel, type AgentResearchResponse, type ResearchTarget, type StudioResearchResult } from "./studio-model";

export function decisionBriefAssessment(result: StudioResearchResult): Pick<DecisionAssessment, "status" | "conclusion" | "summary" | "evidenceIds" | "gaps" | "decision"> {
  if (result.agentResearch?.assessment) {
    const assessment = result.agentResearch.assessment;
    const summary = assessment.conclusion === "geographic-differences-observed" || assessment.conclusion === "no-observed-differences"
      ? decisionBriefVerdictSummary(result, assessment.conclusion)
      : assessment.summary;
    return { ...assessment, summary };
  }
  const evidenceIds = [...(result.baselineResearch?.evidence ?? []), ...(result.alternativeResearch?.evidence ?? [])].map((item) => item.id);
  if (result.status !== "completed" || result.errors.length > 0 || !result.baselineResearch || !result.alternativeResearch || result.baselineResearch.evidence.length === 0 || result.alternativeResearch.evidence.length === 0) {
    return { status: "insufficient", conclusion: "comparison-incomplete", summary: "The returned research is incomplete and cannot support a complete cultural comparison.", evidenceIds, gaps: [], decision: { action: "STOP", reason: "Primary research is incomplete.", supportingEvidenceIds: evidenceIds, stopReason: "partial-evidence-stop" } };
  }
  const changed = result.comparison.evidenceChanges.length > 0 || result.comparison.changedObservedRelationships.length > 0;
  return changed
    ? { status: "supported", conclusion: "geographic-differences-observed", summary: decisionBriefVerdictSummary(result, "geographic-differences-observed"), evidenceIds, gaps: [], decision: { action: "STOP", reason: "Evidence is sufficient for the supported cultural comparison.", supportingEvidenceIds: evidenceIds, stopReason: "evidence-sufficient" } }
    : { status: "supported", conclusion: "no-observed-differences", summary: decisionBriefVerdictSummary(result, "no-observed-differences"), evidenceIds, gaps: [], decision: { action: "STOP", reason: "Evidence is sufficient for the supported cultural comparison.", supportingEvidenceIds: evidenceIds, stopReason: "evidence-sufficient" } };
}

export type GeographicResearchStrategy = "location-filter" | "location-signal" | "unverified";

export type GeographicInterpretation = {
  target: ResearchTarget;
  strategy: GeographicResearchStrategy;
  placeInventory: boolean;
};

export type FollowUpEvidenceGroup = {
  key: string;
  targetType: string;
  targetLabel: string;
  market: string;
  strategy: GeographicResearchStrategy;
  evidence: AffinityEvidence[];
  placeInventory: boolean;
};

function followUpTargetType(item: AffinityEvidence): string {
  return item.queryParameters["filter.type"] ?? `urn:entity:${item.objectEntityCategory}`;
}

function followUpMarket(item: AffinityEvidence): string {
  return item.queryParameters["signal.location.query"]
    ?? item.queryParameters["filter.location.query"]
    ?? item.geographicContext?.city
    ?? "Market unavailable";
}

function followUpStrategy(item: AffinityEvidence): GeographicResearchStrategy {
  if (item.queryParameters["signal.location.query"] && !item.queryParameters["filter.location.query"]) return "location-signal";
  if (item.queryParameters["filter.location.query"] && !item.queryParameters["signal.location.query"]) return "location-filter";
  return "unverified";
}

/**
 * Returns only provider observations that still satisfy the persisted evidence
 * contract. Follow-up evidence intentionally remains outside the primary graph
 * and is grouped for read-only inspection instead.
 */
export function followUpEvidenceGroups(result: StudioResearchResult): FollowUpEvidenceGroup[] {
  if (!result.agentResearch || (result.agentResearch.status !== "completed" && result.agentResearch.status !== "partial")) return [];
  const groups = new Map<string, FollowUpEvidenceGroup>();
  for (const candidate of result.agentResearch?.followUpEvidence ?? []) {
    if (candidate.kind !== "affinity" || candidate.verified !== true) continue;
    const parsed = CulturalEvidenceSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.kind !== "affinity" || parsed.data.verified !== true) continue;
    const item = parsed.data;
    const targetType = followUpTargetType(item);
    const market = followUpMarket(item);
    const strategy = followUpStrategy(item);
    const key = `${targetType}|${market}|${strategy}`;
    const existing = groups.get(key);
    if (existing) existing.evidence.push(item);
    else groups.set(key, {
      key,
      targetType,
      targetLabel: targetTypeLabel(targetType),
      market,
      strategy,
      evidence: [item],
      placeInventory: targetType === RESEARCH_TARGET_PLACE && strategy === "location-filter",
    });
  }
  return [...groups.values()].sort((left, right) => left.targetLabel.localeCompare(right.targetLabel) || left.market.localeCompare(right.market));
}

export function followUpEvidenceCount(result: StudioResearchResult): number {
  return followUpEvidenceGroups(result).reduce((count, group) => count + group.evidence.length, 0);
}

/**
 * Reads the initial follow-up rationale when the execution trace retained it.
 * The final trace decision is deliberately excluded: it is the post-follow-up
 * reassessment and may be a STOP decision for a different reason.
 */
export function followUpRationale(agent: AgentResearchResponse, targetLabel?: string): string {
  if (agent.status === "stopped" && (agent.followUpEvidence?.length ?? 0) === 0) return "No follow-up was executed; the final stop rationale is shown separately.";
  const decisionStep = agent.trace?.steps.find((step) => step.action === "FOLLOW_UP_APPROVED" && step.reason.trim());
  if (decisionStep) return decisionStep.reason;

  const authorizedGap = agent.trace?.gaps.find((gap) => gap.type === "requested-dimension" && gap.allowedActions.includes("FOLLOW_UP_APPROVED"));
  if (authorizedGap) {
    if (targetLabel) return `The explicitly authorized ${targetLabel} dimension addressed a missing research dimension in the initial evidence.`;
    return "The explicitly authorized additional dimension addressed a missing research dimension in the initial evidence.";
  }

  return "The follow-up rationale was not retained in the available execution trace.";
}

export function stopRationale(agent: AgentResearchResponse): string | undefined {
  const trace = agent.trace;
  const reason = trace?.stopReason ?? agent.stopReason;
  if (!reason) return undefined;
  return `${trace?.decision.reason ?? "Final stop reason retained in the agent response."} (trace stop reason: ${reason})`;
}

/** Display-only formatting; the evidence object retains the original number. */
export function formatAffinityValue(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "—";
}

function affinityEvidence(result: CounterfactualResult): Array<Extract<CulturalEvidence, { kind: "affinity" }>> {
  return [...(result.baselineResearch?.evidence ?? []), ...(result.alternativeResearch?.evidence ?? [])]
    .filter((item): item is Extract<CulturalEvidence, { kind: "affinity" }> => item.kind === "affinity");
}

/** Reads the effective geographic strategy from provider query provenance. */
export function geographicInterpretationForResult(result: CounterfactualResult): GeographicInterpretation {
  const target = researchTargetForResult(result);
  const evidence = affinityEvidence(result);
  const strategies = new Set<GeographicResearchStrategy>();
  for (const item of evidence) {
    const query = item.queryParameters;
    if (query["signal.location.query"] && !query["filter.location.query"]) strategies.add("location-signal");
    else if (query["filter.location.query"] && !query["signal.location.query"]) strategies.add("location-filter");
    else strategies.add("unverified");
  }
  const strategy = strategies.size === 1 ? [...strategies][0]! : "unverified";
  return { target, strategy, placeInventory: target === RESEARCH_TARGET_PLACE && strategy === "location-filter" };
}

export function decisionBriefVerdictSummary(result: StudioResearchResult, conclusion: DecisionConclusion): string {
  if (conclusion === "geographic-differences-observed") {
    return "Validated Qloo evidence supports a comparison of the selected cultural connections across the researched markets. It does not establish preference shifts, demand, or market advantage.";
  }
  if (conclusion === "no-observed-differences") return "The validated provider observations showed no observed differentiation within this research scope. This does not establish identical cultural landscapes or demand.";
  return "The available validated evidence does not support a complete geographic conclusion.";
}

export function geographicComparisonNotice(result: CounterfactualResult): string {
  const markets = `${result.baselineScenario.launchLocation} and ${result.alternativeScenario.launchLocation}`;
  const interpretation = geographicInterpretationForResult(result);
  if (interpretation.placeInventory) return `Qloo returned geographically filtered place observations for ${markets}. Different place identities primarily describe location-specific evidence coverage; they do not establish a cultural preference shift, demand, or a market winner.`;
  if (interpretation.strategy === "location-signal" && interpretation.target === RESEARCH_TARGET_BRAND) return `Qloo returned location-conditioned brand affinities for ${markets}. Differences describe provider-observed relationships under those signals; they do not establish causality, demand, or a market winner.`;
  return `These are geographically separate provider result sets for ${markets}. Their differences do not by themselves establish cultural preference, demand, commercial suitability, or a market winner.`;
}

export function decisionBriefGeographicSummary(result: StudioResearchResult): string {
  const markets = `${result.baselineScenario.launchLocation} and ${result.alternativeScenario.launchLocation}`;
  const target = targetTypeLabel(researchTargetForResult(result));
  const changes = result.comparison.evidenceChanges.length + result.comparison.changedObservedRelationships.length;
  if (result.status !== "completed" || result.errors.length > 0) return `The comparison across ${markets} is incomplete; no geographic conclusion is supported.`;
  if (changes > 0) {
    const interpretation = geographicInterpretationForResult(result);
    if (interpretation.placeInventory) return `Qloo returned different place observations across ${markets}. Because the requests used geographic filters, this primarily describes location-specific evidence coverage; it does not establish a cultural preference shift or market superiority.`;
    if (interpretation.strategy === "location-signal" && interpretation.target === RESEARCH_TARGET_BRAND) return `${changes} provider-observed brand affinity relationship${changes === 1 ? "" : "s"} changed across ${markets} under location signals. This does not establish causal behavior or market superiority.`;
    return `${changes} provider-backed ${target} observation${changes === 1 ? "" : "s"} changed across ${markets}. The geographic strategy could not support a stronger interpretation.`;
  }
  const interpretation = geographicInterpretationForResult(result);
  if (interpretation.placeInventory) return `No observed differentiation was found in the returned place evidence for ${markets}. Because place requests use geographic filters, this primarily describes available location-specific coverage rather than a complete cultural landscape.`;
  if (interpretation.strategy === "location-signal" && interpretation.target === RESEARCH_TARGET_BRAND) return `No observed differentiation was found in the returned location-conditioned brand affinities for ${markets}. This describes the observed research scope, not identical cultural landscapes or commercial performance.`;
  return decisionBriefVerdictSummary(result, "no-observed-differences");
}

export function decisionBriefNextAction(result: StudioResearchResult, assessment: Pick<DecisionAssessment, "conclusion" | "gaps" | "decision">): string {
  if (assessment.conclusion === "unsupported-commercial-conclusion") return "Validate demand and commercial viability with independent market research; Qloo affinity does not answer those questions.";
  if (assessment.decision.action === "FOLLOW_UP_APPROVED" && (result.agentResearch?.followUpEvidence?.length ?? 0) === 0) return "Complete the explicitly authorized follow-up only if the bounded provider action is still available.";
  if (assessment.gaps.length > 0) return assessment.gaps[0]?.whyItMatters ?? "Address the identified evidence gap with an explicitly authorized research dimension.";
  return "No additional Qloo query is required for this scope. Use independent commercial research before making a launch decision.";
}

export function decisionBriefEvidence(result: StudioResearchResult, ids: string[]): CulturalEvidence[] {
  const evidence = [...(result.baselineResearch?.evidence ?? []), ...(result.alternativeResearch?.evidence ?? [])];
  return ids.map((id) => evidence.find((item) => item.id === id)).filter((item): item is CulturalEvidence => Boolean(item));
}

export function decisionBriefStabilityLabel(stability: DecisionStability): string {
  if (stability.classification === "stable-conclusion-changed-evidence") return "Stable conclusion, changed evidence";
  if (stability.classification === "changed-conclusion") return "Changed conclusion";
  if (stability.classification === "stable-conclusion-stable-evidence") return "Stable conclusion, stable evidence";
  return "Indeterminate";
}

export function decisionBriefVerdictLabel(conclusion: DecisionConclusion): string {
  if (conclusion === "geographic-differences-observed") return "Geographic differences observed";
  if (conclusion === "no-observed-differences") return "No observed differentiation";
  if (conclusion === "comparison-ready") return "Comparison supported";
  if (conclusion === "unsupported-commercial-conclusion") return "Commercial conclusion unsupported";
  return "Evidence incomplete";
}
