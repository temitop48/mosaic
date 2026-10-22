import type { DecisionAssessment, DecisionConclusion } from "@/agent/decision/contracts";
import type { DecisionStability } from "@/core/decision-stability/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";
import { researchTargetForResult, targetTypeLabel, type StudioResearchResult } from "./studio-model";

export function decisionBriefAssessment(result: StudioResearchResult): Pick<DecisionAssessment, "status" | "conclusion" | "summary" | "evidenceIds" | "gaps" | "decision"> {
  if (result.agentResearch?.assessment) return result.agentResearch.assessment;
  const evidenceIds = [...(result.baselineResearch?.evidence ?? []), ...(result.alternativeResearch?.evidence ?? [])].map((item) => item.id);
  if (result.status !== "completed" || result.errors.length > 0 || !result.baselineResearch || !result.alternativeResearch || result.baselineResearch.evidence.length === 0 || result.alternativeResearch.evidence.length === 0) {
    return { status: "insufficient", conclusion: "comparison-incomplete", summary: "The returned research is incomplete and cannot support a complete cultural comparison.", evidenceIds, gaps: [], decision: { action: "STOP", reason: "Primary research is incomplete.", supportingEvidenceIds: evidenceIds, stopReason: "partial-evidence-stop" } };
  }
  const changed = result.comparison.evidenceChanges.length > 0 || result.comparison.changedObservedRelationships.length > 0;
  return changed
    ? { status: "supported", conclusion: "geographic-differences-observed", summary: "Different provider-backed cultural observations were returned across the researched markets.", evidenceIds, gaps: [], decision: { action: "STOP", reason: "Evidence is sufficient for the supported cultural comparison.", supportingEvidenceIds: evidenceIds, stopReason: "evidence-sufficient" } }
    : { status: "supported", conclusion: "no-observed-differences", summary: "No observed differentiation was found in the returned provider results.", evidenceIds, gaps: [], decision: { action: "STOP", reason: "Evidence is sufficient for the supported cultural comparison.", supportingEvidenceIds: evidenceIds, stopReason: "evidence-sufficient" } };
}

export function decisionBriefGeographicSummary(result: StudioResearchResult): string {
  const markets = `${result.baselineScenario.launchLocation} and ${result.alternativeScenario.launchLocation}`;
  const target = targetTypeLabel(researchTargetForResult(result));
  const changes = result.comparison.evidenceChanges.length + result.comparison.changedObservedRelationships.length;
  if (result.status !== "completed" || result.errors.length > 0) return `The comparison across ${markets} is incomplete; no geographic conclusion is supported.`;
  if (changes > 0) return `${changes} provider-backed ${target} observation${changes === 1 ? "" : "s"} changed across ${markets}. This describes returned evidence, not market superiority.`;
  return `The returned ${target} observations for ${markets} showed no observed differentiation. This does not establish identical cultural landscapes.`;
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
