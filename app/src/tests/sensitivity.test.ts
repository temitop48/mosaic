import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisResult } from "@/agent/contracts";
import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import { compareDecisionSensitivity } from "@/core/sensitivity/compare";
import type { AffinityEvidence } from "@/core/evidence/types";

const scenario = (seed: string, baseline = "London", alternative = "New York") => ({
  productConcept: "Coffee launch",
  launchLocation: baseline,
  seedQueries: [seed],
  seedCategory: "brand" as const,
  requestedOutcome: "Compare cultural associations",
  targetTypes: ["urn:entity:place"],
});

function evidence(city: string, objectId: string, score: number, id = `${city}:${objectId}`): AffinityEvidence {
  return {
    kind: "affinity", id, subjectEntityId: "qloo:brand:signal", subjectEntityCategory: "brand", subjectEntityName: "Signal",
    objectEntityId: objectId, objectEntityCategory: "place", objectEntityName: "Display name may repeat", providerScore: score,
    providerScoreScale: "qloo:affinity", geographicContext: { city },
    queryParameters: { "filter.location.query": city, "filter.type": "urn:entity:place", "signal.interests.entities": "qloo:brand:signal" },
    provenance: { providerId: "qloo", sourceReference: `qloo:${id}`, retrievedAt: "2026-01-01T00:00:00.000Z" }, verified: true,
  };
}

function research(seed: string, city: string, items: AffinityEvidence[]): AnalysisResult {
  return { analysisId: `${seed}:${city}`, status: "completed", scenario: { productConcept: "Coffee launch", launchLocation: city, seedQueries: [seed], seedCategory: "brand", targetTypes: ["urn:entity:place"] }, resolutions: [], evidence: items, graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] };
}

function result(seed: string, baselineEvidence: AffinityEvidence[], alternativeEvidence: AffinityEvidence[]): CounterfactualResult {
  return { status: "completed", dimension: "launchLocation", baselineScenario: scenario(seed), alternativeScenario: { ...scenario(seed), launchLocation: "New York" }, baselineResearch: research(seed, "London", baselineEvidence), alternativeResearch: research(seed, "New York", alternativeEvidence), comparison: { compared: true, baselineEvidenceCount: baselineEvidence.length, alternativeEvidenceCount: alternativeEvidence.length, baselineGraphEdgeCount: 0, alternativeGraphEdgeCount: 0, sharedEntities: [], baselineOnlyEntities: [], alternativeOnlyEntities: [], sharedRelationships: [], baselineOnlyRelationships: [], alternativeOnlyRelationships: [], changedObservedRelationships: [], evidenceChanges: [], queryContexts: { baseline: [], alternative: [] }, geographicContexts: { baseline: [], alternative: [] }, limitations: [] }, limitations: [], errors: [], strategicInterpretationStatus: "not-requested" };
}

function input(original: CounterfactualResult, variant: CounterfactualResult) {
  return { assumption: { dimension: "culturalSignal" as const, originalValue: "Original Signal", alternativeValue: "Variant Signal" }, originalResult: original, variantResult: variant };
}

const originalLondon = evidence("London", "qloo:place:shared", 0.8);
const originalNewYork = evidence("New York", "qloo:place:stable", 0.7);

test("compares each fixed market and preserves original and variant evidence", () => {
  const original = result("Original Signal", [originalLondon], [originalNewYork]);
  const variant = result("Variant Signal", [evidence("London", "qloo:place:shared", 0.8)], [evidence("New York", "qloo:place:stable", 0.3)]);
  const comparison = compareDecisionSensitivity(input(original, variant));
  assert.equal(comparison.schemaVersion, 1);
  assert.equal(comparison.comparison.baseline.stable.length, 1);
  assert.equal(comparison.comparison.alternative.changed.length, 1);
  assert.equal(comparison.comparison.alternative.changed[0]?.originalEvidence?.providerScore, 0.7);
  assert.equal(comparison.comparison.alternative.changed[0]?.variantEvidence?.providerScore, 0.3);
});

test("rejects unchanged signals, changed concepts, changed markets, and changed strategic interpretation", () => {
  const original = result("Original Signal", [originalLondon], [originalNewYork]);
  assert.throws(() => compareDecisionSensitivity({ ...input(original, result("Original Signal", [originalLondon], [originalNewYork])), assumption: { dimension: "culturalSignal", originalValue: "Same", alternativeValue: " same " } }));
  const changedConcept = structuredClone(result("Variant Signal", [originalLondon], [originalNewYork]));
  (changedConcept.baselineScenario as { productConcept: string }).productConcept = "Different concept";
  assert.throws(() => compareDecisionSensitivity(input(original, changedConcept)));
  const changedMarket = result("Variant Signal", [originalLondon], [originalNewYork]);
  (changedMarket.baselineScenario as { launchLocation: string }).launchLocation = "Paris";
  assert.throws(() => compareDecisionSensitivity(input(original, changedMarket)));
  const changedInterpretation = result("Variant Signal", [originalLondon], [originalNewYork]);
  changedInterpretation.strategicInterpretationStatus = "available";
  assert.throws(() => compareDecisionSensitivity(input(original, changedInterpretation)));
});

test("classifies new and not-observed relationships by provider-backed identity", () => {
  const original = result("Original Signal", [evidence("London", "qloo:place:old", 0.8)], [originalNewYork]);
  const variant = result("Variant Signal", [evidence("London", "qloo:place:new", 0.8)], [originalNewYork]);
  const comparison = compareDecisionSensitivity(input(original, variant));
  assert.equal(comparison.comparison.baseline.notObservedInVariant[0]?.objectEntityId, "qloo:place:old");
  assert.equal(comparison.comparison.baseline.newInVariant[0]?.objectEntityId, "qloo:place:new");
});

test("deduplicates evidence, orders deterministically, and does not mutate inputs", () => {
  const duplicate = evidence("London", "qloo:place:b", 0.8, "z-id");
  const earlierDuplicate = evidence("London", "qloo:place:b", 0.8, "a-id");
  const original = result("Original Signal", [duplicate, earlierDuplicate, evidence("London", "qloo:place:a", 0.8)], [originalNewYork]);
  const variant = result("Variant Signal", [evidence("London", "qloo:place:a", 0.8), evidence("London", "qloo:place:b", 0.8)], [originalNewYork]);
  const before = structuredClone(original);
  const comparison = compareDecisionSensitivity(input(original, variant));
  assert.equal(comparison.comparison.baseline.stable.length, 2);
  assert.deepEqual(comparison.comparison.baseline.stable.map((item) => item.objectEntityId), ["qloo:place:a", "qloo:place:b"]);
  assert.equal(comparison.comparison.baseline.stable.find((item) => item.objectEntityId === "qloo:place:b")?.originalEvidence?.evidenceId, "a-id");
  assert.deepEqual(original, before);
});

test("rejects missing, malformed, and unverified evidence", () => {
  const original = result("Original Signal", [originalLondon], [originalNewYork]);
  const missing = structuredClone(result("Variant Signal", [originalLondon], [originalNewYork]));
  delete (missing.baselineResearch as unknown as { evidence?: unknown }).evidence;
  assert.throws(() => compareDecisionSensitivity(input(original, missing)));
  const malformed = structuredClone(result("Variant Signal", [originalLondon], [originalNewYork]));
  (malformed.baselineResearch as AnalysisResult).evidence = [{ kind: "affinity", id: "broken" } as never];
  assert.throws(() => compareDecisionSensitivity(input(original, malformed)));
  const unverified = structuredClone(result("Variant Signal", [originalLondon], [originalNewYork]));
  (unverified.baselineResearch as AnalysisResult).evidence = [{ ...originalLondon, verified: false }];
  assert.throws(() => compareDecisionSensitivity(input(original, unverified)));
});

test("calculates complete destination continuity without changing relationship semantics", () => {
  const original = result("Original Signal", [evidence("London", "qloo:place:a", 0.8), evidence("London", "qloo:place:b", 0.7)], [originalNewYork]);
  const variant = result("Variant Signal", [evidence("London", "qloo:place:a", 0.4), evidence("London", "qloo:place:b", 0.3)], [originalNewYork]);
  const comparison = compareDecisionSensitivity(input(original, variant));
  const continuity = comparison.comparison.baseline.destinationContinuity;
  assert.equal(comparison.comparison.baseline.changed.length, 2);
  assert.equal(continuity.shared.length, 2);
  assert.equal(continuity.originalOnly.length, 0);
  assert.equal(continuity.variantOnly.length, 0);
  assert.equal(continuity.unionDestinationCount, 2);
  assert.equal(continuity.jaccardOverlap, 1);
  assert.equal(continuity.shared[0]?.originalEvidence?.evidenceId, "London:qloo:place:a");
  assert.equal(continuity.shared[0]?.variantEvidence?.evidenceId, "London:qloo:place:a");
});

test("calculates partial and zero destination overlap using object identity", () => {
  const original = result("Original Signal", [evidence("London", "qloo:place:a", 0.8), evidence("London", "qloo:place:b", 0.7)], []);
  const variant = result("Variant Signal", [evidence("London", "qloo:place:b", 0.4), evidence("London", "qloo:place:c", 0.3)], []);
  const partial = compareDecisionSensitivity(input(original, variant)).comparison.baseline.destinationContinuity;
  assert.deepEqual(partial.shared.map((item) => item.objectEntityId), ["qloo:place:b"]);
  assert.deepEqual(partial.originalOnly.map((item) => item.objectEntityId), ["qloo:place:a"]);
  assert.deepEqual(partial.variantOnly.map((item) => item.objectEntityId), ["qloo:place:c"]);
  assert.equal(partial.unionDestinationCount, 3);
  assert.equal(partial.jaccardOverlap, 1 / 3);

  const zero = compareDecisionSensitivity(input(result("Original Signal", [evidence("London", "qloo:place:a", 0.8)], []), result("Variant Signal", [evidence("London", "qloo:place:b", 0.8)], []))).comparison.baseline.destinationContinuity;
  assert.equal(zero.shared.length, 0);
  assert.equal(zero.jaccardOverlap, 0);
});

test("deduplicates destinations, isolates markets, orders deterministically, and preserves inputs", () => {
  const duplicate = evidence("London", "qloo:place:b", 0.8, "z-id");
  const earlierDuplicate = evidence("London", "qloo:place:b", 0.8, "a-id");
  const original = result("Original Signal", [duplicate, earlierDuplicate, evidence("London", "qloo:place:a", 0.8)], [evidence("New York", "qloo:place:ny", 0.8)]);
  const variant = result("Variant Signal", [evidence("London", "qloo:place:a", 0.8), evidence("London", "qloo:place:b", 0.8)], [evidence("New York", "qloo:place:other", 0.8)]);
  const before = structuredClone(original);
  const first = compareDecisionSensitivity(input(original, variant));
  const second = compareDecisionSensitivity(input(original, variant));
  assert.deepEqual(first.comparison.baseline.destinationContinuity, second.comparison.baseline.destinationContinuity);
  assert.deepEqual(first.comparison.baseline.destinationContinuity.shared.map((item) => item.objectEntityId), ["qloo:place:a", "qloo:place:b"]);
  assert.equal(first.comparison.baseline.destinationContinuity.shared.find((item) => item.objectEntityId === "qloo:place:b")?.originalEvidence?.evidenceId, "a-id");
  assert.equal(first.comparison.alternative.destinationContinuity.shared.length, 0);
  assert.equal(first.comparison.alternative.destinationContinuity.originalOnly.length, 1);
  assert.equal(first.comparison.alternative.destinationContinuity.variantOnly.length, 1);
  assert.deepEqual(original, before);
});

test("handles empty destination sets without NaN", () => {
  const compared = compareDecisionSensitivity(input(result("Original Signal", [], []), result("Variant Signal", [], [])));
  for (const market of ["baseline", "alternative"] as const) {
    const continuity = compared.comparison[market].destinationContinuity;
    assert.equal(continuity.originalDestinationCount, 0);
    assert.equal(continuity.variantDestinationCount, 0);
    assert.equal(continuity.unionDestinationCount, 0);
    assert.equal(continuity.jaccardOverlap, 0);
    assert.equal(Number.isNaN(continuity.jaccardOverlap), false);
  }
});
