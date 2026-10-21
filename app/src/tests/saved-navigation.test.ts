import assert from "node:assert/strict";
import test from "node:test";
import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { StudioScenarioInput } from "@/components/mosaic/studio-model";
import { SAVED_ANALYSIS_HANDOFF_KEY, parseSavedAnalyses, type SavedAnalysis } from "@/components/mosaic/saved-analyses";

const request: StudioScenarioInput = { productConcept: "Coffee", seedQuery: "Signal", baselineLocation: "London", alternativeLocation: "New York", includeStrategicInterpretation: false };
const result = { status: "completed", dimension: "launchLocation", baselineScenario: { productConcept: "Coffee", launchLocation: "London", seedQueries: ["Signal"], targetTypes: ["urn:entity:place"] }, alternativeScenario: { productConcept: "Coffee", launchLocation: "New York", seedQueries: ["Signal"], targetTypes: ["urn:entity:place"] }, baselineResearch: { analysisId: "london", status: "completed", scenario: { productConcept: "Coffee", launchLocation: "London", seedQueries: ["Signal"], targetTypes: ["urn:entity:place"] }, resolutions: [], evidence: [], graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] }, alternativeResearch: { analysisId: "new-york", status: "completed", scenario: { productConcept: "Coffee", launchLocation: "New York", seedQueries: ["Signal"], targetTypes: ["urn:entity:place"] }, resolutions: [], evidence: [], graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] }, comparison: { compared: true, baselineEvidenceCount: 0, alternativeEvidenceCount: 0, baselineGraphEdgeCount: 0, alternativeGraphEdgeCount: 0, sharedEntities: [], baselineOnlyEntities: [], alternativeOnlyEntities: [], sharedRelationships: [], baselineOnlyRelationships: [], alternativeOnlyRelationships: [], changedObservedRelationships: [], evidenceChanges: [], queryContexts: { baseline: [], alternative: [] }, geographicContexts: { baseline: [], alternative: [] }, limitations: [] }, limitations: [], errors: [], strategicInterpretationStatus: "not-requested" } satisfies CounterfactualResult;

test("saved-page handoff retains the validated historical entry for workspace restoration", () => {
  const entry: SavedAnalysis = { id: "saved-1", title: "Coffee · London → New York", request, result, createdAt: "2026-01-02T03:04:05.000Z", schemaVersion: 1 };
  const restored = parseSavedAnalyses(JSON.stringify([entry]));
  assert.equal(SAVED_ANALYSIS_HANDOFF_KEY, "mosaic:saved-analysis-handoff:v1");
  assert.equal(restored[0]?.id, entry.id);
  assert.equal(restored[0]?.request.seedQuery, "Signal");
  assert.equal(restored[0]?.result.baselineScenario.launchLocation, "London");
  assert.equal(restored[0]?.result.alternativeScenario.launchLocation, "New York");
  assert.equal(restored[0]?.createdAt, entry.createdAt);
});

test("invalid handoff data is ignored without creating a research request", () => {
  assert.deepEqual(parseSavedAnalyses(JSON.stringify([{ schemaVersion: 1, id: "bad" }])), []);
});
