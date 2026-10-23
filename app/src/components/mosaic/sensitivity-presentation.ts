import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { DecisionSensitivityResult } from "@/core/sensitivity/contracts";
import type { DecisionStability } from "@/core/decision-stability/contracts";
import { researchTargetForResult, type StudioScenarioInput } from "./studio-model";

type AgentResearchPresentationState = { status?: "completed" | "partial" | "stopped" | "unavailable"; followUpEvidence?: unknown[] };

function agentResearchFor(result: CounterfactualResult): AgentResearchPresentationState | undefined {
  return (result as CounterfactualResult & { agentResearch?: AgentResearchPresentationState }).agentResearch;
}

export type SensitivityPresentationSummary = {
  sharedObservedTargetEntities: number;
  originalOnlyObservedTargets: number;
  modifiedOnlyObservedTargets: number;
  sharedRelationshipsWithChangedAttributes: number;
  totalDifferingObservations: number;
};

/** Presentation-only names for the existing validated comparison buckets. */
export function sensitivityPresentationSummary(result: DecisionSensitivityResult, market: "baseline" | "alternative"): SensitivityPresentationSummary {
  const comparison = result.comparison[market];
  return {
    sharedObservedTargetEntities: comparison.destinationContinuity.shared.length,
    originalOnlyObservedTargets: comparison.destinationContinuity.originalOnly.length,
    modifiedOnlyObservedTargets: comparison.destinationContinuity.variantOnly.length,
    sharedRelationshipsWithChangedAttributes: comparison.changed.length,
    totalDifferingObservations: comparison.changed.length + comparison.notObservedInVariant.length + comparison.newInVariant.length,
  };
}

export function stabilityPresentationText(stability: DecisionStability): string {
  if (stability.classification === "stable-conclusion-changed-evidence") return "Assessment category unchanged; cultural evidence changed. This does not mean the business decision is unchanged or commercially validated.";
  if (stability.classification === "stable-conclusion-stable-evidence") return "Assessment category and compared cultural evidence remained stable within this provider result scope. This does not validate a commercial decision.";
  return stability.explanation;
}

export function sensitivityScopeText(originalResult: CounterfactualResult, variantResult?: CounterfactualResult, originalRequest?: StudioScenarioInput): string {
  const targetLabel = researchTargetForResult(originalResult).replace("urn:entity:", "");
  const originalAgent = agentResearchFor(originalResult);
  const variantAgent = variantResult ? agentResearchFor(variantResult) : undefined;
  const originalFollowUpCount = originalAgent?.followUpEvidence?.length ?? 0;
  const variantFollowUpCount = variantAgent?.followUpEvidence?.length ?? 0;
  const agentEnabled = originalRequest?.agentResearchEnabled === true || Boolean(originalAgent);
  let followUpText: string;
  if (!agentEnabled) followUpText = "Optional agent follow-up was not enabled.";
  else if (originalAgent?.status === "unavailable" || variantAgent?.status === "unavailable") followUpText = "Optional agent follow-up was unavailable; follow-up parity was not validated.";
  else if ((originalFollowUpCount > 0) !== (variantFollowUpCount > 0)) followUpText = "Optional agent follow-up was asymmetric between scenarios; it is not treated as comparable evidence.";
  else if (originalFollowUpCount > 0 && variantFollowUpCount > 0) followUpText = "Optional agent follow-up dimensions were evaluated separately for comparability and were present in both scenarios.";
  else if (agentEnabled) followUpText = "Agent research was enabled, but no follow-up observations were returned; follow-up parity was not established.";
  else followUpText = "Optional agent follow-up state was not retained in the available result.";
  return `Sensitivity measures primary ${targetLabel} research evidence. ${followUpText} Different target dimensions are never merged into one ranking.`;
}
