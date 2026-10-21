import assert from "node:assert/strict";
import test from "node:test";
import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";
import { compareDecisionSensitivity } from "@/core/sensitivity/compare";

const request = { productConcept: "Coffee", baselineLocation: "London", alternativeLocation: "New York" };
function evidence(city: string, objectId: string, score: number, id = `${city}:${objectId}`): CulturalEvidence {
  return { kind: "affinity", id, subjectEntityId: "qloo:brand:signal", subjectEntityCategory: "brand", objectEntityId: objectId, objectEntityCategory: "place", providerScore: score, geographicContext: { city }, queryParameters: { "filter.location.query": city }, provenance: { providerId: "qloo", sourceReference: `qloo:${id}`, retrievedAt: "2026-01-01T00:00:00.000Z" }, verified: true };
}
function research(seed: string, city: string, evidenceList: CulturalEvidence[]) { return { analysisId: `${seed}:${city}`, status: "completed" as const, scenario: { ...request, launchLocation: city, seedQueries: [seed], targetTypes: ["urn:entity:place"] }, resolutions: [], evidence: evidenceList, graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] }; }
function result(seed: string, baseline: CulturalEvidence[], alternative: CulturalEvidence[]): CounterfactualResult { return { status: "completed", dimension: "launchLocation", baselineScenario: { ...request, launchLocation: "London", seedQueries: [seed], targetTypes: ["urn:entity:place"] }, alternativeScenario: { ...request, launchLocation: "New York", seedQueries: [seed], targetTypes: ["urn:entity:place"] }, baselineResearch: research(seed, "London", baseline), alternativeResearch: research(seed, "New York", alternative), comparison: { compared: true, baselineEvidenceCount: baseline.length, alternativeEvidenceCount: alternative.length, baselineGraphEdgeCount: 0, alternativeGraphEdgeCount: 0, sharedEntities: [], baselineOnlyEntities: [], alternativeOnlyEntities: [], sharedRelationships: [], baselineOnlyRelationships: [], alternativeOnlyRelationships: [], changedObservedRelationships: [], evidenceChanges: [], queryContexts: { baseline: [], alternative: [] }, geographicContexts: { baseline: [], alternative: [] }, limitations: [] }, limitations: [], errors: [], strategicInterpretationStatus: "not-requested" }; }

test("keeps original and variant signals distinct while isolating each fixed market", () => {
  const original = result("Original Signal", [evidence("London", "qloo:place:shared", 0.8)], [evidence("New York", "qloo:place:ny", 0.7)]);
  const variant = result("Variant Signal", [evidence("London", "qloo:place:shared", 0.4)], [evidence("New York", "qloo:place:ny", 0.7)]);
  const compared = compareDecisionSensitivity({ assumption: { dimension: "culturalSignal", originalValue: "Original Signal", alternativeValue: "Variant Signal" }, originalResult: original, variantResult: variant });
  assert.equal(compared.originalResult, original);
  assert.equal(compared.variantResult, variant);
  assert.equal(compared.comparison.baseline.changed.length, 1);
  assert.equal(compared.comparison.alternative.stable.length, 1);
  assert.equal(compared.comparison.baseline.changed[0]?.originalEvidence?.geographicContext?.city, "London");
  assert.equal(compared.comparison.alternative.stable[0]?.originalEvidence?.geographicContext?.city, "New York");
});

test("deduplicates relationship evidence by stable provider identity with stable ordering", () => {
  const original = result("Original Signal", [evidence("London", "qloo:place:b", 0.8, "z"), evidence("London", "qloo:place:b", 0.8, "a"), evidence("London", "qloo:place:a", 0.8)], []);
  const variant = result("Variant Signal", [evidence("London", "qloo:place:a", 0.8), evidence("London", "qloo:place:b", 0.8)], []);
  const before = structuredClone(original);
  const first = compareDecisionSensitivity({ assumption: { dimension: "culturalSignal", originalValue: "Original Signal", alternativeValue: "Variant Signal" }, originalResult: original, variantResult: variant });
  const second = compareDecisionSensitivity({ assumption: { dimension: "culturalSignal", originalValue: "Original Signal", alternativeValue: "Variant Signal" }, originalResult: original, variantResult: variant });
  assert.deepEqual(first, second);
  assert.deepEqual(first.comparison.baseline.stable.map((item) => item.objectEntityId), ["qloo:place:a", "qloo:place:b"]);
  assert.equal(first.comparison.baseline.stable.find((item) => item.objectEntityId === "qloo:place:b")?.originalEvidence?.evidenceId, "a");
  assert.deepEqual(original, before);
});

test("describes missing top-N observations without claiming cultural absence or a market winner", () => {
  const original = result("Original Signal", [evidence("London", "qloo:place:old", 0.9)], []);
  const variant = result("Variant Signal", [], [evidence("New York", "qloo:place:new", 0.9)]);
  const compared = compareDecisionSensitivity({ assumption: { dimension: "culturalSignal", originalValue: "Original Signal", alternativeValue: "Variant Signal" }, originalResult: original, variantResult: variant });
  assert.equal(compared.comparison.baseline.notObservedInVariant.length, 1);
  assert.equal(compared.comparison.baseline.notObservedInVariant[0]?.status, "not-observed-in-variant");
  assert.ok(compared.limitations.some((item) => item.includes("not evidence that the relationship is culturally absent")));
  assert.equal("winner" in compared.comparison, false);
});
