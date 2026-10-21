import assert from "node:assert/strict";
import test from "node:test";
import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { StudioScenarioInput } from "@/components/mosaic/studio-model";
import { SAVED_ANALYSES_KEY, SAVED_ANALYSES_LIMIT, deleteSavedAnalysis, loadSavedAnalyses, parseSavedAnalyses, saveAnalysis, validateSaveableAnalysis } from "@/components/mosaic/saved-analyses";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function request(index = 0): StudioScenarioInput {
  return { productConcept: `Concept ${index}`, seedQuery: `Signal ${index}`, baselineLocation: "London", alternativeLocation: "New York", includeStrategicInterpretation: false };
}

function result(): CounterfactualResult {
  const evidence = (city: string, id: string) => ({ kind: "affinity" as const, id: `evidence:${city}:${id}`, subjectEntityId: "qloo:signal", subjectEntityCategory: "brand" as const, subjectEntityName: "Signal", objectEntityId: `qloo:${city.toLowerCase()}:${id}`, objectEntityCategory: "place" as const, objectEntityName: `${city} Place`, providerScore: 0.7, geographicContext: { city }, queryParameters: { "filter.location.query": city }, provenance: { providerId: "qloo", sourceReference: `qloo:insight:${city}:${id}`, retrievedAt: "2026-01-01T00:00:00.000Z" }, verified: true });
  return {
    status: "completed",
    dimension: "launchLocation",
    baselineScenario: { productConcept: "Concept", launchLocation: "London", seedQueries: ["Signal"], targetTypes: ["urn:entity:place"] },
    alternativeScenario: { productConcept: "Concept", launchLocation: "New York", seedQueries: ["Signal"], targetTypes: ["urn:entity:place"] },
    baselineResearch: { evidence: [evidence("London", "1")], analysisId: "analysis:london", status: "completed", scenario: { productConcept: "Concept", launchLocation: "London", seedQueries: ["Signal"], targetTypes: ["urn:entity:place"] }, resolutions: [], graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] },
    alternativeResearch: { evidence: [evidence("New York", "1")], analysisId: "analysis:new-york", status: "completed", scenario: { productConcept: "Concept", launchLocation: "New York", seedQueries: ["Signal"], targetTypes: ["urn:entity:place"] }, resolutions: [], graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] },
    comparison: { compared: true, baselineEvidenceCount: 1, alternativeEvidenceCount: 0, baselineGraphEdgeCount: 1, alternativeGraphEdgeCount: 0, sharedEntities: [], baselineOnlyEntities: [], alternativeOnlyEntities: [], sharedRelationships: [], baselineOnlyRelationships: [], alternativeOnlyRelationships: [], changedObservedRelationships: [], evidenceChanges: [], queryContexts: { baseline: [], alternative: [] }, geographicContexts: { baseline: [{ city: "London" }], alternative: [{ city: "New York" }] }, limitations: [] },
    limitations: [], errors: [], strategicInterpretationStatus: "not-requested",
  };
}

test("saving is explicit and preserves provider evidence metadata", () => {
  const storage = new MemoryStorage();
  assert.equal(loadSavedAnalyses(storage).length, 0);
  const saved = saveAnalysis(request(), result(), storage, new Date("2026-01-02T03:04:05.000Z"));
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const reopened = loadSavedAnalyses(storage);
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0]?.createdAt, "2026-01-02T03:04:05.000Z");
  assert.deepEqual(reopened[0]?.result.baselineResearch?.evidence[0]?.provenance, result().baselineResearch?.evidence[0]?.provenance);
  assert.equal(reopened[0]?.request.baselineLocation, "London");
});

test("corrupt, unsupported, and incomplete saved data is ignored safely", () => {
  assert.deepEqual(parseSavedAnalyses("not-json"), []);
  assert.deepEqual(parseSavedAnalyses(JSON.stringify([{ schemaVersion: 99 }])), []);
  assert.deepEqual(parseSavedAnalyses(JSON.stringify([{ schemaVersion: 1, id: "missing-result", title: "Broken", request: request() }])), []);
});

test("saved analyses stop at the ten-entry capacity without overwriting existing entries", () => {
  const storage = new MemoryStorage();
  for (let index = 0; index < SAVED_ANALYSES_LIMIT; index += 1) assert.equal(saveAnalysis(request(index), result(), storage).ok, true);
  const rejected = saveAnalysis(request(10), result(), storage);
  assert.equal(rejected.ok, false);
  assert.equal(loadSavedAnalyses(storage).length, SAVED_ANALYSES_LIMIT);
  assert.equal(loadSavedAnalyses(storage).some((entry) => entry.request.productConcept === "Concept 0"), true);
});

test("delete removes only the requested saved analysis", () => {
  const storage = new MemoryStorage();
  const first = saveAnalysis(request(1), result(), storage);
  const second = saveAnalysis(request(2), result(), storage);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok) return;
  assert.deepEqual(deleteSavedAnalysis(first.entry.id, storage), { ok: true });
  assert.equal(loadSavedAnalyses(storage).length, 1);
  assert.equal(loadSavedAnalyses(storage)[0]?.request.productConcept, "Concept 2");
});

test("storage failures return a safe error instead of throwing", () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  const outcome = saveAnalysis(request(), result(), storage);
  assert.equal(outcome.ok, false);
  assert.equal(loadSavedAnalyses({ getItem: () => { throw new Error("blocked"); }, setItem: () => undefined }).length, 0);
  assert.equal(SAVED_ANALYSES_KEY, "mosaic:saved-analyses:v1");
});

test("only completed research with validated evidence can be saved", () => {
  const complete = result();
  assert.deepEqual(validateSaveableAnalysis(complete), { ok: true });
  assert.equal(saveAnalysis(request(), { ...complete, status: "partial" }, new MemoryStorage()).ok, false);
  assert.equal(saveAnalysis(request(), { ...complete, status: "failed" }, new MemoryStorage()).ok, false);
  assert.equal(saveAnalysis(request(), { ...complete, baselineResearch: undefined }, new MemoryStorage()).ok, false);
  assert.equal(saveAnalysis(request(), { ...complete, baselineResearch: { ...complete.baselineResearch!, evidence: [{ ...complete.baselineResearch!.evidence[0]!, providerScore: Number.NaN }] } }, new MemoryStorage()).ok, false);
});
