import { LaunchScenarioInputSchema, type AnalysisResult, type LaunchScenarioInput } from "@/agent/contracts";
import type { CounterfactualEvidenceObservation, CounterfactualResult } from "@/core/counterfactuals/contracts";
import { CulturalEvidenceSchema, type AffinityEvidence } from "@/core/evidence/types";
import {
  DecisionSensitivityValidationError,
  type DecisionSensitivityAssumption,
  type DecisionSensitivityDestination,
  type DecisionSensitivityDestinationContinuity,
  type DecisionSensitivityInput,
  type DecisionSensitivityMarketComparison,
  type DecisionSensitivityRelationship,
  type DecisionSensitivityResult,
} from "@/core/sensitivity/contracts";

const LIMITATIONS = [
  "Each comparison uses the provider's returned top-N result set; an item not observed in the variant is not evidence that the relationship is culturally absent.",
  "Provider affinity scores are separately normalized observations. Numerical score differences are retained as changed evidence attributes only and are not treated as directly comparable magnitudes.",
  "This comparison makes no inference about market demand, commercial suitability, sales, or launch success.",
];

function fail(message: string): never {
  throw new DecisionSensitivityValidationError(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function relationshipKey(value: Pick<CounterfactualEvidenceObservation, "providerId" | "subjectEntityId" | "subjectEntityCategory" | "objectEntityId" | "objectEntityCategory">): string {
  return [value.providerId, value.subjectEntityCategory, value.subjectEntityId, value.objectEntityCategory, value.objectEntityId].join("\u0000");
}

function observation(evidence: AffinityEvidence): CounterfactualEvidenceObservation {
  return {
    evidenceId: evidence.id,
    providerId: evidence.provenance.providerId,
    subjectEntityId: evidence.subjectEntityId,
    subjectEntityCategory: evidence.subjectEntityCategory,
    objectEntityId: evidence.objectEntityId,
    objectEntityCategory: evidence.objectEntityCategory,
    providerScore: evidence.providerScore,
    geographicContext: evidence.geographicContext,
    queryParameters: evidence.queryParameters,
    retrievedAt: evidence.provenance.retrievedAt,
  };
}

function relationship(value: CounterfactualEvidenceObservation): DecisionSensitivityRelationship {
  return {
    status: "stable",
    providerId: value.providerId,
    subjectEntityId: value.subjectEntityId,
    subjectEntityCategory: value.subjectEntityCategory,
    objectEntityId: value.objectEntityId,
    objectEntityCategory: value.objectEntityCategory,
    originalEvidence: value,
  };
}

function destinationKey(value: Pick<CounterfactualEvidenceObservation, "providerId" | "objectEntityId" | "objectEntityCategory">): string {
  return [value.providerId, value.objectEntityCategory, value.objectEntityId].join("\u0000");
}

function compareRelevantAttributes(left: CounterfactualEvidenceObservation, right: CounterfactualEvidenceObservation): boolean {
  return left.providerScore === right.providerScore
    && equalJson(left.geographicContext, right.geographicContext)
    && equalJson(left.queryParameters, right.queryParameters);
}

function evidenceByRelationship(result: AnalysisResult, label: string): Map<string, CounterfactualEvidenceObservation> {
  if (!isObject(result) || !Array.isArray(result.evidence)) fail(`${label} research evidence must be an array`);
  const values = new Map<string, CounterfactualEvidenceObservation>();
  for (const raw of result.evidence) {
    const parsed = CulturalEvidenceSchema.safeParse(raw);
    if (!parsed.success || parsed.data.kind !== "affinity" || !parsed.data.verified) {
      fail(`${label} research contains missing, malformed, unsupported, or unverified evidence`);
    }
    const current = observation(parsed.data);
    const key = relationshipKey(current);
    const previous = values.get(key);
    // Duplicate relationships are represented once. The lexicographically earliest
    // evidence ID is selected so duplicate handling is deterministic and input order
    // cannot change the comparison.
    if (!previous || current.evidenceId < previous.evidenceId) values.set(key, current);
  }
  return values;
}

function evidenceByDestination(evidence: Map<string, CounterfactualEvidenceObservation>): Map<string, CounterfactualEvidenceObservation> {
  const values = new Map<string, CounterfactualEvidenceObservation>();
  for (const current of evidence.values()) {
    const key = destinationKey(current);
    const previous = values.get(key);
    if (!previous || current.evidenceId < previous.evidenceId) values.set(key, current);
  }
  return values;
}

function destination(value: CounterfactualEvidenceObservation): DecisionSensitivityDestination {
  return {
    providerId: value.providerId,
    objectEntityId: value.objectEntityId,
    objectEntityCategory: value.objectEntityCategory,
    originalEvidence: value,
  };
}

function compareDestinationContinuity(original: Map<string, CounterfactualEvidenceObservation>, variant: Map<string, CounterfactualEvidenceObservation>): DecisionSensitivityDestinationContinuity {
  const originalDestinations = evidenceByDestination(original);
  const variantDestinations = evidenceByDestination(variant);
  const shared: DecisionSensitivityDestination[] = [];
  const originalOnly: DecisionSensitivityDestination[] = [];
  const variantOnly: DecisionSensitivityDestination[] = [];
  for (const [key, originalEvidence] of originalDestinations) {
    const variantEvidence = variantDestinations.get(key);
    if (variantEvidence) shared.push({ ...destination(originalEvidence), variantEvidence });
    else originalOnly.push(destination(originalEvidence));
  }
  for (const [key, variantEvidence] of variantDestinations) {
    if (!originalDestinations.has(key)) variantOnly.push({ ...destination(variantEvidence), originalEvidence: undefined, variantEvidence });
  }
  const sortDestinations = (left: DecisionSensitivityDestination, right: DecisionSensitivityDestination) => destinationKey(left).localeCompare(destinationKey(right));
  shared.sort(sortDestinations);
  originalOnly.sort(sortDestinations);
  variantOnly.sort(sortDestinations);
  const unionDestinationCount = new Set([...originalDestinations.keys(), ...variantDestinations.keys()]).size;
  return {
    shared,
    originalOnly,
    variantOnly,
    originalDestinationCount: originalDestinations.size,
    variantDestinationCount: variantDestinations.size,
    unionDestinationCount,
    jaccardOverlap: unionDestinationCount === 0 ? 0 : shared.length / unionDestinationCount,
  };
}

function scenarioWithoutSeed(scenario: LaunchScenarioInput): Omit<LaunchScenarioInput, "seedQueries"> {
  const { seedQueries: _seedQueries, ...rest } = scenario;
  return rest;
}

function validateScenario(result: CounterfactualResult, label: string): void {
  if (!isObject(result) || result.dimension !== "launchLocation") fail(`${label} result must be a launchLocation counterfactual result`);
  if (!result.baselineScenario || !result.alternativeScenario) fail(`${label} result is missing its fixed-market scenarios`);
  if (!LaunchScenarioInputSchema.safeParse(result.baselineScenario).success || !LaunchScenarioInputSchema.safeParse(result.alternativeScenario).success) {
    fail(`${label} result contains an invalid scenario`);
  }
  if (!result.baselineResearch || !result.alternativeResearch) fail(`${label} result is missing required research evidence`);
  if (!Array.isArray(result.errors) || !Array.isArray(result.limitations) || !isObject(result.comparison)) {
    fail(`${label} result has an invalid counterfactual structure`);
  }
  if (result.status === "failed" || result.errors.length > 0) fail(`${label} result cannot be reliably compared because it contains errors`);
  if (result.strategicInterpretationStatus === "unavailable") fail(`${label} result has unavailable strategic interpretation`);
  if (!Array.isArray(result.baselineResearch.evidence) || !Array.isArray(result.alternativeResearch.evidence)) fail(`${label} result has structurally invalid research evidence`);
  evidenceByRelationship(result.baselineResearch, `${label} baseline`);
  evidenceByRelationship(result.alternativeResearch, `${label} alternative`);
}

function validateInput(input: unknown): asserts input is DecisionSensitivityInput {
  if (!isObject(input) || !isObject(input.assumption) || !isObject(input.originalResult) || !isObject(input.variantResult)) fail("A decision sensitivity experiment requires an assumption and two counterfactual results");
  const assumption = input.assumption as Partial<DecisionSensitivityAssumption>;
  if (assumption.dimension !== "culturalSignal" || typeof assumption.originalValue !== "string" || typeof assumption.alternativeValue !== "string" || !assumption.originalValue.trim() || !assumption.alternativeValue.trim()) fail("Only a non-empty culturalSignal assumption is supported");
  if (normalized(assumption.originalValue) === normalized(assumption.alternativeValue)) fail("The cultural signal must change between original and variant results");
  validateScenario(input.originalResult as CounterfactualResult, "Original");
  validateScenario(input.variantResult as CounterfactualResult, "Variant");
}

function validateCompatibility(assumption: DecisionSensitivityAssumption, original: CounterfactualResult, variant: CounterfactualResult): void {
  const originalScenarios = [original.baselineScenario, original.alternativeScenario];
  const variantScenarios = [variant.baselineScenario, variant.alternativeScenario];
  for (let index = 0; index < 2; index += 1) {
    const left = originalScenarios[index];
    const right = variantScenarios[index];
    if (left.launchLocation !== right.launchLocation) fail("Original and variant results must use the same baseline and alternative cities");
    if (!equalJson(scenarioWithoutSeed(left), scenarioWithoutSeed(right))) fail("Original and variant results must keep every non-seed scenario parameter unchanged");
    if (!Array.isArray(left.seedQueries) || left.seedQueries.length !== 1 || !Array.isArray(right.seedQueries) || right.seedQueries.length !== 1) fail("Cultural-signal sensitivity requires exactly one seed query in each scenario");
    if (normalized(left.seedQueries[0]) !== normalized(assumption.originalValue) || normalized(right.seedQueries[0]) !== normalized(assumption.alternativeValue)) fail("The result seed queries must match the original and alternative cultural-signal values");
  }
  if (original.strategicInterpretationStatus !== variant.strategicInterpretationStatus) fail("Original and variant results must use the same strategic interpretation setting");
}

function compareMarket(market: "baseline" | "alternative", original: AnalysisResult, variant: AnalysisResult): DecisionSensitivityMarketComparison {
  const originalEvidence = evidenceByRelationship(original, `Original ${market}`);
  const variantEvidence = evidenceByRelationship(variant, `Variant ${market}`);
  const result: DecisionSensitivityMarketComparison = { market, stable: [], changed: [], notObservedInVariant: [], newInVariant: [], destinationContinuity: { shared: [], originalOnly: [], variantOnly: [], originalDestinationCount: 0, variantDestinationCount: 0, unionDestinationCount: 0, jaccardOverlap: 0 } };
  for (const [key, originalObservation] of originalEvidence) {
    const variantObservation = variantEvidence.get(key);
    if (!variantObservation) {
      result.notObservedInVariant.push({ ...relationship(originalObservation), status: "not-observed-in-variant" });
    } else {
      const item: DecisionSensitivityRelationship = { ...relationship(originalObservation), variantEvidence: variantObservation, status: compareRelevantAttributes(originalObservation, variantObservation) ? "stable" : "changed" };
      if (item.status === "stable") result.stable.push(item);
      else result.changed.push(item);
    }
  }
  for (const [key, variantObservation] of variantEvidence) if (!originalEvidence.has(key)) {
    result.newInVariant.push({ ...relationship(variantObservation), originalEvidence: undefined, variantEvidence: variantObservation, status: "new-in-variant" });
  }
  for (const list of [result.stable, result.changed, result.notObservedInVariant, result.newInVariant]) list.sort((left, right) => relationshipKey(left).localeCompare(relationshipKey(right)));
  result.destinationContinuity = compareDestinationContinuity(originalEvidence, variantEvidence);
  return result;
}

export function compareDecisionSensitivity(input: unknown): DecisionSensitivityResult {
  validateInput(input);
  const { assumption, originalResult, variantResult } = input;
  validateCompatibility(assumption, originalResult, variantResult);
  return {
    schemaVersion: 1,
    assumption: { dimension: "culturalSignal", originalValue: assumption.originalValue.trim(), alternativeValue: assumption.alternativeValue.trim() },
    originalResult,
    variantResult,
    comparison: {
      baseline: compareMarket("baseline", originalResult.baselineResearch as AnalysisResult, variantResult.baselineResearch as AnalysisResult),
      alternative: compareMarket("alternative", originalResult.alternativeResearch as AnalysisResult, variantResult.alternativeResearch as AnalysisResult),
    },
    limitations: [...LIMITATIONS],
  };
}

export type { DecisionSensitivityInput } from "@/core/sensitivity/contracts";
