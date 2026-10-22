import assert from "node:assert/strict";
import test from "node:test";
import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { DecisionAssessment } from "@/agent/decision/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";
import { assessDecisionStability } from "@/core/decision-stability/assessment";
import type { DecisionSensitivityResult } from "@/core/sensitivity/contracts";
import { compareDecisionSensitivity } from "@/core/sensitivity/compare";
import { mapCounterfactualResponse } from "@/components/mosaic/studio-model";
import { parseSavedAnalyses, saveAnalysis } from "@/components/mosaic/saved-analyses";
import type { StudioScenarioInput } from "@/components/mosaic/studio-model";

const request: StudioScenarioInput = { productConcept: "Coffee launch", seedQuery: "Original Signal", baselineLocation: "London", alternativeLocation: "New York", includeStrategicInterpretation: false };

function evidence(signal: string, city: string, target: string, score = 0.8): CulturalEvidence {
  return { kind: "affinity", id: `${signal}:${city}:${target}`, subjectEntityId: `qloo:brand:${signal.toLowerCase().replaceAll(" ", "-")}`, subjectEntityCategory: "brand", subjectEntityName: signal, objectEntityId: target, objectEntityCategory: "place", objectEntityName: target, providerScore: score, providerScoreScale: "qloo:affinity", queryParameters: { "filter.type": "urn:entity:place", "filter.location.query": city, sort_by: "affinity" }, provenance: { providerId: "qloo", sourceReference: `qloo:${city}:${target}`, retrievedAt: "2026-01-01T00:00:00.000Z" }, verified: true };
}

function research(seed: string, city: string, items: CulturalEvidence[]) {
  return { analysisId: `${seed}:${city}`, status: "completed" as const, scenario: { productConcept: request.productConcept, launchLocation: city, seedQueries: [seed], targetTypes: ["urn:entity:place"] }, resolutions: [], evidence: items, graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] };
}

function result(seed: string, baselineItems: CulturalEvidence[], alternativeItems: CulturalEvidence[]): CounterfactualResult {
  return { status: "completed", dimension: "launchLocation", baselineScenario: { productConcept: request.productConcept, launchLocation: "London", seedQueries: [seed], targetTypes: ["urn:entity:place"] }, alternativeScenario: { productConcept: request.productConcept, launchLocation: "New York", seedQueries: [seed], targetTypes: ["urn:entity:place"] }, baselineResearch: research(seed, "London", baselineItems), alternativeResearch: research(seed, "New York", alternativeItems), comparison: { compared: true, baselineEvidenceCount: baselineItems.length, alternativeEvidenceCount: alternativeItems.length, baselineGraphEdgeCount: baselineItems.length, alternativeGraphEdgeCount: alternativeItems.length, sharedEntities: [], baselineOnlyEntities: [], alternativeOnlyEntities: [], sharedRelationships: [], baselineOnlyRelationships: [], alternativeOnlyRelationships: [], changedObservedRelationships: [], evidenceChanges: [], queryContexts: { baseline: [], alternative: [] }, geographicContexts: { baseline: [], alternative: [] }, limitations: [] }, limitations: [], errors: [], strategicInterpretationStatus: "not-requested" };
}

function assessment(conclusion: DecisionAssessment["conclusion"], summary: string): DecisionAssessment {
  const objective = { kind: "geographic-cultural-comparison" as const, requestedOutcome: "Compare cultural evidence", markets: ["London", "New York"], allowedTargetTypes: ["urn:entity:place"] };
  const decision = { action: "STOP" as const, reason: "Evidence assessed", supportingEvidenceIds: [], stopReason: "evidence-sufficient" as const };
  const budget = { logicalOperationsUsed: 4, maxLogicalOperations: 6, followUpRoundsUsed: 0, maxFollowUpRounds: 1, followUpAffinityByMarket: {}, maxFollowUpAffinityPerMarket: 1 };
  return { status: "supported", conclusion, summary, evidenceIds: [], gaps: [], decision, trace: { objective, gaps: [], decision, steps: [], budget, stopReason: "evidence-sufficient" } };
}

function withAssessments(value: CounterfactualResult, original: DecisionAssessment, counterfactual: DecisionAssessment): CounterfactualResult {
  return { ...value, agentResearch: { status: "stopped", assessment: original, trace: original.trace, stopReason: original.trace.stopReason, followUpEvidence: [] }, alternativeAgentResearch: counterfactual } as CounterfactualResult;
}

function withFollowUp(value: CounterfactualResult, items: CulturalEvidence[]): CounterfactualResult {
  const assessed = assessment("geographic-differences-observed", "Follow-up evidence assessed");
  return { ...value, agentResearch: { status: "completed", assessment: assessed, trace: assessed.trace, stopReason: assessed.trace.stopReason, followUpEvidence: items } } as CounterfactualResult;
}

function sensitivity(original: CounterfactualResult, variant: CounterfactualResult): DecisionSensitivityResult {
  return compareDecisionSensitivity({ assumption: { dimension: "culturalSignal", originalValue: "Original Signal", alternativeValue: "Variant Signal" }, originalResult: original, variantResult: variant });
}

class MemoryStorage {
  private value = "[]";
  getItem() { return this.value; }
  setItem(_key: string, value: string) { this.value = value; }
}

test("classifies stable conclusion with changed evidence", () => {
  const original = result("Original Signal", [evidence("Original Signal", "London", "qloo:place:a")], [evidence("Original Signal", "New York", "qloo:place:b")]);
  const variant = result("Variant Signal", [evidence("Variant Signal", "London", "qloo:place:c")], [evidence("Variant Signal", "New York", "qloo:place:d")]);
  const assessed = sensitivity(original, variant).decisionStability!;
  assert.equal(assessed.classification, "stable-conclusion-changed-evidence");
  assert.equal(assessed.evidenceChange, "changed");
});

test("classifies a changed conclusion only from deterministic assessment differences", () => {
  const original = withAssessments(result("Original Signal", [evidence("Original Signal", "London", "qloo:place:a")], [evidence("Original Signal", "New York", "qloo:place:b")]), assessment("geographic-differences-observed", "Different observations"), assessment("geographic-differences-observed", "Different observations"));
  const variantBase = result("Variant Signal", [evidence("Variant Signal", "London", "qloo:place:a")], [evidence("Variant Signal", "New York", "qloo:place:a")]);
  const variant = withAssessments(variantBase, assessment("no-observed-differences", "No observed differentiation"), assessment("no-observed-differences", "No observed differentiation"));
  const assessed = sensitivity(original, variant).decisionStability!;
  assert.equal(assessed.classification, "changed-conclusion");
  assert.equal(assessed.conclusionChange, "changed");
});

test("classifies stable conclusion with stable evidence", () => {
  const original = result("Original Signal", [evidence("Original Signal", "London", "qloo:place:a")], [evidence("Original Signal", "New York", "qloo:place:a")]);
  const variant = result("Variant Signal", [evidence("Variant Signal", "London", "qloo:place:a")], [evidence("Variant Signal", "New York", "qloo:place:a")]);
  variant.baselineResearch!.evidence = [{ ...variant.baselineResearch!.evidence[0]!, subjectEntityId: original.baselineResearch!.evidence[0]!.subjectEntityId }];
  variant.alternativeResearch!.evidence = [{ ...variant.alternativeResearch!.evidence[0]!, subjectEntityId: original.alternativeResearch!.evidence[0]!.subjectEntityId }];
  const assessed = sensitivity(original, variant).decisionStability!;
  assert.equal(assessed.classification, "stable-conclusion-stable-evidence");
});

test("returns indeterminate for missing, invalid, or mismatched research", () => {
  const original = result("Original Signal", [evidence("Original Signal", "London", "qloo:place:a")], [evidence("Original Signal", "New York", "qloo:place:a")]);
  const variant = result("Variant Signal", [evidence("Variant Signal", "London", "qloo:place:a")], [evidence("Variant Signal", "New York", "qloo:place:a")]);
  const base = sensitivity(original, variant);
  const missing = assessDecisionStability({ ...base, originalResult: { ...original, baselineResearch: undefined } });
  assert.equal(missing.classification, "indeterminate");
  const invalidEvidence = { ...original.baselineResearch!.evidence[0]!, providerScore: Number.NaN };
  const invalid = assessDecisionStability({ ...base, originalResult: { ...original, baselineResearch: { ...original.baselineResearch!, evidence: [invalidEvidence] } } });
  assert.equal(invalid.classification, "indeterminate");
  const mismatched = assessDecisionStability({ ...base, variantResult: { ...variant, baselineScenario: { ...variant.baselineScenario, launchLocation: "Lagos" } } });
  assert.equal(mismatched.classification, "indeterminate");
});

test("does not compare different target categories or objectives", () => {
  const original = result("Original Signal", [evidence("Original Signal", "London", "qloo:place:a")], [evidence("Original Signal", "New York", "qloo:place:a")]);
  const variant = result("Variant Signal", [evidence("Variant Signal", "London", "qloo:place:a")], [evidence("Variant Signal", "New York", "qloo:place:a")]);
  const changedTarget = { ...variant, baselineScenario: { ...variant.baselineScenario, targetTypes: ["urn:entity:brand"] } };
  assert.equal(assessDecisionStability({ ...sensitivity(original, variant), variantResult: changedTarget }).classification, "indeterminate");
  const changedObjective = withAssessments(variant, assessment("no-observed-differences", "Same"), assessment("no-observed-differences", "Same"));
  const originalWithObjective = withAssessments(original, assessment("no-observed-differences", "Same"), assessment("no-observed-differences", "Same"));
  (changedObjective as unknown as { agentResearch: { assessment: DecisionAssessment } }).agentResearch.assessment.trace.objective.requestedOutcome = "Different objective";
  assert.equal(assessDecisionStability(sensitivity(originalWithObjective, changedObjective)).classification, "indeterminate");
});

test("optional follow-up evidence must be present comparably", () => {
  const original = result("Original Signal", [evidence("Original Signal", "London", "qloo:place:a")], [evidence("Original Signal", "New York", "qloo:place:a")]);
  const variant = result("Variant Signal", [evidence("Variant Signal", "London", "qloo:place:a")], [evidence("Variant Signal", "New York", "qloo:place:a")]);
  const base = sensitivity(original, variant);
  const followUp = evidence("Original Signal", "London", "qloo:place:follow-up");
  const withOneFollowUp = { ...original, agentResearch: { status: "completed" as const, followUpEvidence: [followUp] } };
  const assessed = assessDecisionStability({ ...base, originalResult: withOneFollowUp });
  assert.equal(assessed.classification, "indeterminate");
  assert.ok(assessed.limitations.some((item) => item.includes("only one scenario")));
});

test("valid follow-up evidence is independently validated in both scenarios", () => {
  const original = result("Original Signal", [evidence("Original Signal", "London", "qloo:place:a")], [evidence("Original Signal", "New York", "qloo:place:a")]);
  const variant = result("Variant Signal", [evidence("Variant Signal", "London", "qloo:place:a")], [evidence("Variant Signal", "New York", "qloo:place:a")]);
  const originalWithFollowUp = withFollowUp(original, [evidence("Original Signal", "London", "qloo:place:follow-up")]);
  const variantWithFollowUp = withFollowUp(variant, [evidence("Variant Signal", "London", "qloo:place:follow-up")]);
  const assessed = assessDecisionStability(sensitivity(originalWithFollowUp, variantWithFollowUp));
  assert.notEqual(assessed.classification, "indeterminate");
});

test("malformed or incompatible follow-up evidence is indeterminate", () => {
  const original = result("Original Signal", [evidence("Original Signal", "London", "qloo:place:a")], [evidence("Original Signal", "New York", "qloo:place:a")]);
  const variant = result("Variant Signal", [evidence("Variant Signal", "London", "qloo:place:a")], [evidence("Variant Signal", "New York", "qloo:place:a")]);
  const valid = evidence("Original Signal", "London", "qloo:place:follow-up");
  const malformed = withFollowUp(original, [{ ...valid, providerScore: Number.NaN }]);
  const invalidGeo = withFollowUp(original, [{ ...valid, queryParameters: { ...valid.queryParameters, "filter.location.query": "Lagos" } }]);
  const invalidDimension = withFollowUp(original, [{ ...valid, queryParameters: { ...valid.queryParameters, "filter.type": "urn:entity:brand" } }]);
  const invalidProvenance = withFollowUp(original, [{ ...valid, provenance: { ...valid.provenance, providerId: "" } }]);
  for (const candidate of [malformed, invalidGeo, invalidDimension, invalidProvenance]) {
    const assessed = assessDecisionStability(sensitivity(candidate, withFollowUp(variant, [evidence("Variant Signal", "London", "qloo:place:follow-up")])));
    assert.equal(assessed.classification, "indeterminate");
    assert.ok(assessed.limitations.some((item) => item.includes("follow-up evidence")));
  }
});

test("stability assessment is provider-call free and response mapping remains additive", () => {
  let calls = 0;
  const original = result("Original Signal", [evidence("Original Signal", "London", "qloo:place:a")], [evidence("Original Signal", "New York", "qloo:place:a")]);
  const variant = result("Variant Signal", [evidence("Variant Signal", "London", "qloo:place:a")], [evidence("Variant Signal", "New York", "qloo:place:a")]);
  const assessed = assessDecisionStability(sensitivity(original, variant));
  calls += 0;
  assert.equal(calls, 0);
  assert.ok(assessed.supportingEvidenceIds.length > 0);
  assert.ok(mapCounterfactualResponse({ ...original, agentResearch: { status: "stopped" } }));
});

test("decision stability round-trips in saved analyses and legacy entries remain readable", () => {
  const storage = new MemoryStorage();
  const original = result("Original Signal", [evidence("Original Signal", "London", "qloo:place:a")], [evidence("Original Signal", "New York", "qloo:place:a")]);
  const variant = result("Variant Signal", [evidence("Variant Signal", "London", "qloo:place:a")], [evidence("Variant Signal", "New York", "qloo:place:a")]);
  const stability = sensitivity(original, variant).decisionStability!;
  const saved = saveAnalysis(request, original as never, storage as never, new Date("2026-01-01T00:00:00.000Z"), stability);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const parsed = parseSavedAnalyses(storage.getItem());
  assert.equal(parsed[0]?.decisionStability?.classification, "indeterminate");
  assert.ok(parsed[0]?.decisionStability?.limitations.some((item) => item.includes("counterfactual result is not stored")));
  const legacy = JSON.parse(storage.getItem());
  delete legacy[0].decisionStability;
  assert.equal(parseSavedAnalyses(JSON.stringify(legacy)).length, 1);
});

test("persisted stability labels cannot override recomputation limits or unsupported values", () => {
  const storage = new MemoryStorage();
  const original = result("Original Signal", [evidence("Original Signal", "London", "qloo:place:a")], [evidence("Original Signal", "New York", "qloo:place:a")]);
  const stability = sensitivity(original, result("Variant Signal", [evidence("Variant Signal", "London", "qloo:place:a")], [evidence("Variant Signal", "New York", "qloo:place:a")])).decisionStability!;
  const saved = saveAnalysis(request, original as never, storage as never, new Date("2026-01-01T00:00:00.000Z"), stability);
  assert.equal(saved.ok, true);
  const raw = JSON.parse(storage.getItem());
  raw[0].decisionStability.classification = "unsupported-classification";
  const parsed = parseSavedAnalyses(JSON.stringify(raw));
  assert.equal(parsed[0]?.decisionStability?.classification, "indeterminate");
  assert.equal(parsed[0]?.result.baselineResearch?.evidence.length, 1);
});

test("persisted incomplete evidence yields indeterminate stability while preserving the saved entry", () => {
  const storage = new MemoryStorage();
  const original = result("Original Signal", [evidence("Original Signal", "London", "qloo:place:a")], [evidence("Original Signal", "New York", "qloo:place:a")]);
  const variant = result("Variant Signal", [evidence("Variant Signal", "London", "qloo:place:a")], [evidence("Variant Signal", "New York", "qloo:place:a")]);
  const stability = sensitivity(original, variant).decisionStability!;
  const saved = saveAnalysis(request, original as never, storage as never, new Date("2026-01-01T00:00:00.000Z"), stability);
  assert.equal(saved.ok, true);
  const raw = JSON.parse(storage.getItem());
  raw[0].result.baselineResearch.evidence[0].verified = false;
  const parsed = parseSavedAnalyses(JSON.stringify(raw));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.decisionStability?.classification, "indeterminate");
  assert.ok(parsed[0]?.decisionStability?.limitations.some((item) => item.includes("incomplete")));
});
