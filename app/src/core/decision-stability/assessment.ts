import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import { CulturalEvidenceSchema, type CulturalEvidence } from "@/core/evidence/types";
import type { DecisionAssessment } from "@/agent/decision/contracts";
import type { DecisionSensitivityResult } from "@/core/sensitivity/contracts";
import type {
  DecisionAssessmentSnapshot,
  DecisionStability,
  StabilityClassification,
  StabilityConclusionStatus,
  StabilityEvidenceStatus,
} from "./contracts";

type ResultWithAgent = CounterfactualResult & {
  agentResearch?: {
    assessment?: DecisionAssessment;
    followUpEvidence?: CulturalEvidence[];
  };
};

function agentFor(result: CounterfactualResult): ResultWithAgent["agentResearch"] {
  return (result as ResultWithAgent).agentResearch;
}

const UNSUPPORTED_OR_LIMITED_CONCLUSIONS = new Set([
  "comparison-incomplete",
  "evidence-insufficient",
  "unsupported-commercial-conclusion",
  "follow-up-required",
  "follow-up-unavailable",
]);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function validResearch(result: CounterfactualResult): boolean {
  if (result.status !== "completed" || result.errors.length > 0) return false;
  const researches = [result.baselineResearch, result.alternativeResearch];
  return researches.every((research, index) => Boolean(
    research
      && research.status === "completed"
      && research.errors.length === 0
      && research.scenario.launchLocation === (index === 0 ? result.baselineScenario.launchLocation : result.alternativeScenario.launchLocation)
      && research.evidence.length > 0,
  ));
}

function evidenceIsValid(result: CounterfactualResult): boolean {
  return [result.baselineResearch, result.alternativeResearch].every((research) => Boolean(
    research?.evidence.every((item) => {
      const parsed = CulturalEvidenceSchema.safeParse(item);
      return parsed.success && parsed.data.kind === "affinity" && parsed.data.verified && parsed.data.providerScore !== undefined && Number.isFinite(parsed.data.providerScore);
    }),
  ));
}

function targetTypes(result: CounterfactualResult): string[] {
  return unique([
    ...(result.baselineScenario.targetTypes ?? []),
    ...(result.alternativeScenario.targetTypes ?? []),
    ...(result.baselineResearch?.plan?.targetTypes ?? []),
    ...(result.alternativeResearch?.plan?.targetTypes ?? []),
    ...(result.baselineResearch?.evidence ?? []).flatMap((item) => item.kind === "affinity" ? [item.queryParameters["filter.type"]] : []),
    ...(result.alternativeResearch?.evidence ?? []).flatMap((item) => item.kind === "affinity" ? [item.queryParameters["filter.type"]] : []),
  ].filter((value): value is string => Boolean(value))).sort();
}

function providers(result: CounterfactualResult): string[] {
  return unique([
    ...(result.baselineResearch?.evidence ?? []),
    ...(result.alternativeResearch?.evidence ?? []),
  ].flatMap((item) => item.kind === "affinity" ? [item.provenance.providerId] : [])).sort();
}

function snapshotFromAssessment(assessment: DecisionAssessment): DecisionAssessmentSnapshot {
  return {
    status: assessment.status,
    conclusion: assessment.conclusion,
    summary: assessment.summary,
    evidenceIds: [...assessment.evidenceIds],
  };
}

function deterministicAssessment(result: CounterfactualResult): DecisionAssessmentSnapshot {
  const evidenceIds = [
    ...(result.baselineResearch?.evidence ?? []),
    ...(result.alternativeResearch?.evidence ?? []),
  ].map((item) => item.id);
  if (!validResearch(result) || !evidenceIsValid(result)) {
    return { status: "insufficient", conclusion: "comparison-incomplete", summary: "The validated research is incomplete and cannot support a stable decision assessment.", evidenceIds };
  }
  const changed = result.comparison.evidenceChanges.length > 0 || result.comparison.changedObservedRelationships.length > 0;
  return changed
    ? { status: "supported", conclusion: "geographic-differences-observed", summary: "Different provider-backed cultural observations were returned across the fixed markets.", evidenceIds }
    : { status: "supported", conclusion: "no-observed-differences", summary: "No observed differentiation was found in the returned provider results.", evidenceIds };
}

function assessmentFor(result: CounterfactualResult): DecisionAssessmentSnapshot {
  const agentAssessment = agentFor(result)?.assessment;
  return agentAssessment ? snapshotFromAssessment(agentAssessment) : deterministicAssessment(result);
}

function sameObjective(original: CounterfactualResult, variant: CounterfactualResult): boolean {
  const left = agentFor(original)?.assessment?.trace.objective;
  const right = agentFor(variant)?.assessment?.trace.objective;
  if (!left && !right) return true;
  if (!left || !right) return false;
  return stableJson(left) === stableJson(right);
}

function followUpEvidence(result: CounterfactualResult): CulturalEvidence[] {
  return agentFor(result)?.followUpEvidence ?? [];
}

function expectedLocations(result: CounterfactualResult): string[] {
  return unique([
    result.baselineScenario.launchLocation,
    result.alternativeScenario.launchLocation,
    result.baselineResearch?.scenario.launchLocation,
    result.alternativeResearch?.scenario.launchLocation,
  ].filter((value): value is string => Boolean(value)));
}

function followUpTargetType(item: CulturalEvidence): string | undefined {
  return item.kind === "affinity" ? item.queryParameters["filter.type"] : undefined;
}

function followUpLocationIsValid(item: CulturalEvidence, locations: string[]): boolean {
  if (item.kind !== "affinity") return false;
  const targetType = followUpTargetType(item);
  const location = targetType === "urn:entity:brand"
    ? item.queryParameters["signal.location.query"]
    : targetType === "urn:entity:place"
      ? item.queryParameters["filter.location.query"]
      : undefined;
  if (!location || !locations.includes(location)) return false;
  if (targetType === "urn:entity:brand") return !item.queryParameters["filter.location.query"];
  if (targetType === "urn:entity:place") return !item.queryParameters["signal.location.query"];
  return false;
}

/**
 * Validates optional agent evidence before it can affect a stability result.
 * An empty, absent follow-up is valid; a present follow-up must be a complete
 * provider-backed affinity observation in an explicitly supported dimension.
 */
export function validateFollowUpEvidence(result: CounterfactualResult): { valid: true; evidence: CulturalEvidence[] } | { valid: false; reason: string } {
  const agent = agentFor(result);
  if (!agent || agent.followUpEvidence === undefined) return { valid: true, evidence: [] };
  if (!Array.isArray(agent.followUpEvidence)) return { valid: false, reason: "Optional follow-up evidence is not a valid observation list." };
  const locations = expectedLocations(result);
  const allowed = new Set([
    ...(agent.assessment?.trace.objective.allowedTargetTypes ?? []),
    ...(result.baselineScenario.targetTypes ?? []),
    ...(result.alternativeScenario.targetTypes ?? []),
  ]);
  const seenSubjects = new Set<string>();
  for (const item of agent.followUpEvidence) {
    const parsed = CulturalEvidenceSchema.safeParse(item);
    if (!parsed.success || parsed.data.kind !== "affinity" || parsed.data.verified !== true || parsed.data.providerScore === undefined || !Number.isFinite(parsed.data.providerScore)) {
      return { valid: false, reason: "Optional follow-up evidence contains an invalid or unverified provider observation." };
    }
    const targetType = followUpTargetType(parsed.data);
    if (!targetType || !allowed.has(targetType)) return { valid: false, reason: "Optional follow-up evidence uses an unauthorized research target dimension." };
    if (!followUpLocationIsValid(parsed.data, locations)) return { valid: false, reason: "Optional follow-up evidence is not attributed to a declared market using the target's supported geographic strategy." };
    const subjectKey = `${parsed.data.provenance.providerId}:${parsed.data.subjectEntityCategory}:${parsed.data.subjectEntityId}`;
    seenSubjects.add(subjectKey);
  }
  if (seenSubjects.size > 1) return { valid: false, reason: "Optional follow-up evidence contains incompatible subject identities." };
  return { valid: true, evidence: agent.followUpEvidence };
}

function followUpTargetTypes(result: CounterfactualResult): string[] {
  return unique(followUpEvidence(result).flatMap((item) => item.kind === "affinity" ? [item.queryParameters["filter.type"]] : [])).sort();
}

function followUpFingerprint(result: CounterfactualResult): string {
  return stableJson(followUpEvidence(result).map((item) => {
    if (item.kind !== "affinity") return item.id;
    return {
      providerId: item.provenance.providerId,
      subjectEntityId: item.subjectEntityId,
      subjectEntityCategory: item.subjectEntityCategory,
      objectEntityId: item.objectEntityId,
      objectEntityCategory: item.objectEntityCategory,
      providerScore: item.providerScore,
      providerScoreScale: item.providerScoreScale,
      queryParameters: item.queryParameters,
    };
  }).sort((left, right) => stableJson(left).localeCompare(stableJson(right))));
}

function comparable(original: CounterfactualResult, variant: CounterfactualResult): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!validResearch(original) || !validResearch(variant)) reasons.push("Both scenarios require complete validated research.");
  if (!evidenceIsValid(original) || !evidenceIsValid(variant)) reasons.push("One scenario contains invalid or unverifiable provider observations.");
  if (original.baselineScenario.launchLocation !== variant.baselineScenario.launchLocation || original.alternativeScenario.launchLocation !== variant.alternativeScenario.launchLocation) reasons.push("The scenarios do not cover equivalent markets.");
  if (stableJson(original.baselineScenario.targetTypes ?? []) !== stableJson(variant.baselineScenario.targetTypes ?? [])) reasons.push("The primary target category differs between scenarios.");
  if (targetTypes(original).join("|") !== targetTypes(variant).join("|")) reasons.push("The effective research target dimensions differ between scenarios.");
  if (providers(original).join("|") !== providers(variant).join("|")) reasons.push("Provider provenance is not compatible between scenarios.");
  if (!sameObjective(original, variant)) reasons.push("The research objectives or optional agent assessments differ between scenarios.");

  const originalFollowUpValidation = validateFollowUpEvidence(original);
  const variantFollowUpValidation = validateFollowUpEvidence(variant);
  if (!originalFollowUpValidation.valid) reasons.push(`Original optional follow-up evidence is invalid: ${originalFollowUpValidation.reason}`);
  if (!variantFollowUpValidation.valid) reasons.push(`Counterfactual optional follow-up evidence is invalid: ${variantFollowUpValidation.reason}`);

  const originalFollowUp = followUpEvidence(original).length > 0;
  const variantFollowUp = followUpEvidence(variant).length > 0;
  if (originalFollowUp !== variantFollowUp) reasons.push("Optional follow-up evidence exists for only one scenario.");
  if (originalFollowUp && followUpTargetTypes(original).join("|") !== followUpTargetTypes(variant).join("|")) reasons.push("Optional follow-up target dimensions are not equivalent.");
  return { ok: reasons.length === 0, reasons };
}

function primaryEvidenceChanged(sensitivity: DecisionSensitivityResult): boolean {
  return [sensitivity.comparison.baseline, sensitivity.comparison.alternative].some((market) => market.changed.length > 0 || market.notObservedInVariant.length > 0 || market.newInVariant.length > 0);
}

function evidenceChangeStatus(sensitivity: DecisionSensitivityResult): StabilityEvidenceStatus {
  const original = sensitivity.originalResult;
  const variant = sensitivity.variantResult;
  const originalFollowUp = followUpEvidence(original);
  const variantFollowUp = followUpEvidence(variant);
  if ((originalFollowUp.length > 0) !== (variantFollowUp.length > 0)) return "indeterminate";
  if (primaryEvidenceChanged(sensitivity)) return "changed";
  if (originalFollowUp.length > 0 && followUpFingerprint(original) !== followUpFingerprint(variant)) return "changed";
  return "stable";
}

function conclusionChangeStatus(original: DecisionAssessmentSnapshot, variant: DecisionAssessmentSnapshot): StabilityConclusionStatus {
  if (UNSUPPORTED_OR_LIMITED_CONCLUSIONS.has(original.conclusion) || UNSUPPORTED_OR_LIMITED_CONCLUSIONS.has(variant.conclusion)) return "indeterminate";
  return original.conclusion === variant.conclusion ? "stable" : "changed";
}

function classification(evidence: StabilityEvidenceStatus, conclusion: StabilityConclusionStatus, comparableState: boolean): StabilityClassification {
  if (!comparableState || evidence === "indeterminate" || conclusion === "indeterminate") return "indeterminate";
  if (conclusion === "changed") return "changed-conclusion";
  return evidence === "changed" ? "stable-conclusion-changed-evidence" : "stable-conclusion-stable-evidence";
}

export function assessDecisionStability(sensitivity: DecisionSensitivityResult): DecisionStability {
  const originalAssessment = assessmentFor(sensitivity.originalResult);
  const counterfactualAssessment = assessmentFor(sensitivity.variantResult);
  const compatibility = comparable(sensitivity.originalResult, sensitivity.variantResult);
  const evidenceChange = compatibility.ok ? evidenceChangeStatus(sensitivity) : "indeterminate";
  const conclusionChange = compatibility.ok ? conclusionChangeStatus(originalAssessment, counterfactualAssessment) : "indeterminate";
  const resultClassification = classification(evidenceChange, conclusionChange, compatibility.ok);
  const limitations = [...compatibility.reasons];
  if (UNSUPPORTED_OR_LIMITED_CONCLUSIONS.has(originalAssessment.conclusion) || UNSUPPORTED_OR_LIMITED_CONCLUSIONS.has(counterfactualAssessment.conclusion)) {
    limitations.push("A shared limitation or unsupported commercial conclusion is not evidence of a stable commercial recommendation.");
  }
  if (resultClassification === "indeterminate") limitations.push("Decision stability cannot be determined from the available comparable evidence.");
  const supportingEvidenceIds = unique([...originalAssessment.evidenceIds, ...counterfactualAssessment.evidenceIds]);
  let explanation: string;
  if (resultClassification === "stable-conclusion-changed-evidence") explanation = "The supported assessment classification remained the same, while the provider-backed observations changed.";
  else if (resultClassification === "changed-conclusion") explanation = "The deterministic supported assessment classification changed between the original and counterfactual signals.";
  else if (resultClassification === "stable-conclusion-stable-evidence") explanation = "The supported assessment classification and relevant provider observations remained stable.";
  else explanation = limitations[0] ?? "The scenarios are not sufficiently comparable to determine decision stability.";
  return { classification: resultClassification, originalAssessment, counterfactualAssessment, evidenceChange, conclusionChange, comparability: compatibility.ok ? "comparable" : "incomparable", supportingEvidenceIds, limitations: unique(limitations), explanation };
}
