import assert from "node:assert/strict";
import test from "node:test";
import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";
import { compareDecisionSensitivity } from "@/core/sensitivity/compare";
import { createCounterfactualRequest, mapCounterfactualResponse, type StudioScenarioInput } from "@/components/mosaic/studio-model";

const request: StudioScenarioInput = { productConcept: "Coffee launch", seedQuery: "Original Signal", baselineLocation: "London", alternativeLocation: "New York", includeStrategicInterpretation: true };

function evidence(city: string, objectId: string, score: number): CulturalEvidence {
  return { kind: "affinity", id: `qloo:${city}:${objectId}`, subjectEntityId: "qloo:brand:original", subjectEntityCategory: "brand", objectEntityId: objectId, objectEntityCategory: "place", providerScore: score, geographicContext: { city }, queryParameters: { "filter.location.query": city }, provenance: { providerId: "qloo", sourceReference: `qloo:${city}:${objectId}`, retrievedAt: "2026-01-01T00:00:00.000Z" }, verified: true };
}

function research(seed: string, city: string, item: CulturalEvidence) {
  return { analysisId: `${seed}:${city}`, status: "completed" as const, scenario: { productConcept: request.productConcept, launchLocation: city, seedQueries: [seed], targetTypes: ["urn:entity:place"] }, resolutions: [], evidence: [item], graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] };
}

function result(seed: string, score = 0.7): CounterfactualResult {
  return { status: "completed", dimension: "launchLocation", baselineScenario: { productConcept: request.productConcept, launchLocation: request.baselineLocation, seedQueries: [seed], targetTypes: ["urn:entity:place"] }, alternativeScenario: { productConcept: request.productConcept, launchLocation: request.alternativeLocation, seedQueries: [seed], targetTypes: ["urn:entity:place"] }, baselineResearch: research(seed, "London", evidence("London", "qloo:place:shared", score)), alternativeResearch: research(seed, "New York", evidence("New York", "qloo:place:shared", score)), comparison: { compared: true, baselineEvidenceCount: 1, alternativeEvidenceCount: 1, baselineGraphEdgeCount: 0, alternativeGraphEdgeCount: 0, sharedEntities: [], baselineOnlyEntities: [], alternativeOnlyEntities: [], sharedRelationships: [], baselineOnlyRelationships: [], alternativeOnlyRelationships: [], changedObservedRelationships: [], evidenceChanges: [], queryContexts: { baseline: [], alternative: [] }, geographicContexts: { baseline: [], alternative: [] }, limitations: [] }, limitations: [], errors: [], strategicInterpretationStatus: "not-requested" };
}

test("builds a variant request with only the cultural signal changed", () => {
  const variant = createCounterfactualRequest({ ...request, seedQuery: "Variant Signal" });
  assert.equal(variant.baseline.productConcept, request.productConcept);
  assert.equal(variant.baseline.launchLocation, request.baselineLocation);
  assert.equal(variant.modification.alternativeValue, request.alternativeLocation);
  assert.deepEqual(variant.baseline.seedQueries, ["Variant Signal"]);
  assert.equal(variant.includeStrategicInterpretation, true);
});

test("trimming is deterministic and unchanged signals are rejected by the experiment comparison", () => {
  const original = result("Original Signal");
  const variant = result("Original Signal");
  assert.throws(() => compareDecisionSensitivity({ assumption: { dimension: "culturalSignal", originalValue: " Original Signal ", alternativeValue: "original signal" }, originalResult: original, variantResult: variant }));
  const trimmed = createCounterfactualRequest({ ...request, seedQuery: "  Variant Signal  " });
  assert.deepEqual(trimmed.baseline.seedQueries, ["Variant Signal"]);
});

test("successful variant comparison preserves the original result and fixed markets", () => {
  const original = result("Original Signal");
  const variant = result("Variant Signal", 0.4);
  const sensitivity = compareDecisionSensitivity({ assumption: { dimension: "culturalSignal", originalValue: "Original Signal", alternativeValue: "Variant Signal" }, originalResult: original, variantResult: variant });
  assert.equal(sensitivity.originalResult, original);
  assert.equal(sensitivity.variantResult, variant);
  assert.equal(sensitivity.comparison.baseline.changed.length, 1);
  assert.equal(sensitivity.comparison.alternative.changed.length, 1);
  assert.equal(original.baselineScenario.launchLocation, "London");
  assert.equal(original.alternativeScenario.launchLocation, "New York");
});

test("failed or malformed variant responses cannot become sensitivity results", () => {
  assert.equal(mapCounterfactualResponse({ status: "failed" }), undefined);
  const failed = result("Variant Signal");
  failed.status = "partial";
  failed.errors = [{ code: "RESEARCH_FAILURE", message: "provider failure" }];
  assert.throws(() => compareDecisionSensitivity({ assumption: { dimension: "culturalSignal", originalValue: "Original Signal", alternativeValue: "Variant Signal" }, originalResult: result("Original Signal"), variantResult: failed }));
});

test("view changes and saving do not alter the comparison contract", () => {
  const original = result("Original Signal");
  const variant = result("Variant Signal");
  const before = structuredClone(original);
  const sensitivity = compareDecisionSensitivity({ assumption: { dimension: "culturalSignal", originalValue: "Original Signal", alternativeValue: "Variant Signal" }, originalResult: original, variantResult: variant });
  assert.deepEqual(original, before);
  assert.equal(sensitivity.schemaVersion, 1);
  assert.ok(sensitivity.limitations.some((item) => item.includes("top-N")));
});
