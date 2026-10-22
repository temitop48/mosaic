import assert from "node:assert/strict";
import test from "node:test";
import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";
import { parseSavedAnalyses, saveAnalysis } from "@/components/mosaic/saved-analyses";
import {
  continuityLabelForTarget,
  createCounterfactualRequest,
  normalizeResearchTarget,
  RESEARCH_TARGET_BRAND,
  RESEARCH_TARGET_PLACE,
  researchTargetForResult,
  type StudioScenarioInput,
} from "@/components/mosaic/studio-model";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const request = (researchTarget?: StudioScenarioInput["researchTarget"]): StudioScenarioInput => ({
  productConcept: "Athletic lifestyle brand",
  seedQuery: "Adidas",
  baselineLocation: "Lagos",
  alternativeLocation: "New York",
  includeStrategicInterpretation: true,
  researchTarget,
});

function evidence(targetType: string): CulturalEvidence {
  return {
    kind: "affinity",
    id: `evidence:${targetType}`,
    subjectEntityId: "qloo:adidas",
    subjectEntityCategory: "brand",
    subjectEntityName: "Adidas",
    objectEntityId: "qloo:target",
    objectEntityCategory: targetType === RESEARCH_TARGET_BRAND ? "brand" : "place",
    objectEntityName: "Target",
    providerScore: 0.9,
    queryParameters: { "filter.type": targetType, "filter.location.query": "Lagos" },
    provenance: { providerId: "qloo", sourceReference: "qloo:insights:adidas:target", retrievedAt: "2026-01-01T00:00:00.000Z" },
    verified: true,
  };
}

function result(targetType: string): CounterfactualResult {
  const item = evidence(targetType);
  return {
    status: "completed",
    dimension: "launchLocation",
    baselineScenario: { productConcept: "Athletic lifestyle brand", launchLocation: "Lagos", seedQueries: ["Adidas"], targetTypes: [targetType] },
    alternativeScenario: { productConcept: "Athletic lifestyle brand", launchLocation: "New York", seedQueries: ["Adidas"], targetTypes: [targetType] },
    baselineResearch: { analysisId: "baseline", status: "completed", scenario: { productConcept: "Athletic lifestyle brand", launchLocation: "Lagos", seedQueries: ["Adidas"], targetTypes: [targetType] }, resolutions: [], evidence: [item], graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] },
    alternativeResearch: { analysisId: "alternative", status: "completed", scenario: { productConcept: "Athletic lifestyle brand", launchLocation: "New York", seedQueries: ["Adidas"], targetTypes: [targetType] }, resolutions: [], evidence: [item], graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] },
    comparison: { compared: true, baselineEvidenceCount: 1, alternativeEvidenceCount: 1, baselineGraphEdgeCount: 1, alternativeGraphEdgeCount: 1, sharedEntities: [], baselineOnlyEntities: [], alternativeOnlyEntities: [], sharedRelationships: [], baselineOnlyRelationships: [], alternativeOnlyRelationships: [], changedObservedRelationships: [], evidenceChanges: [], queryContexts: { baseline: [], alternative: [] }, geographicContexts: { baseline: [{ city: "Lagos" }], alternative: [{ city: "New York" }] }, limitations: [] },
    limitations: [], errors: [], strategicInterpretationStatus: "not-requested",
  };
}

test("defaults to Places and never infers Brands from the product concept", () => {
  assert.equal(normalizeResearchTarget(undefined), RESEARCH_TARGET_PLACE);
  assert.equal(normalizeResearchTarget("sports"), RESEARCH_TARGET_PLACE);
  assert.equal(createCounterfactualRequest(request()).baseline.targetTypes[0], RESEARCH_TARGET_PLACE);
});

test("propagates an explicit Brands selection through targetTypes", () => {
  const built = createCounterfactualRequest(request(RESEARCH_TARGET_BRAND));
  assert.deepEqual(built.baseline.targetTypes, [RESEARCH_TARGET_BRAND]);
  assert.equal(built.baseline.productConcept, "Athletic lifestyle brand");
});

test("sensitivity request construction preserves the original research target", () => {
  const original = request(RESEARCH_TARGET_BRAND);
  const variant = createCounterfactualRequest({ ...original, seedQuery: "Nike" });
  assert.deepEqual(variant.baseline.targetTypes, [RESEARCH_TARGET_BRAND]);
  assert.equal(variant.baseline.productConcept, original.productConcept);
  assert.equal(variant.modification.originalValue, original.baselineLocation);
  assert.equal(variant.modification.alternativeValue, original.alternativeLocation);
  assert.equal(variant.includeStrategicInterpretation, original.includeStrategicInterpretation);
});

test("result target metadata drives entity continuity terminology", () => {
  assert.equal(researchTargetForResult(result(RESEARCH_TARGET_PLACE)), RESEARCH_TARGET_PLACE);
  assert.equal(researchTargetForResult(result(RESEARCH_TARGET_BRAND)), RESEARCH_TARGET_BRAND);
  assert.equal(continuityLabelForTarget(RESEARCH_TARGET_PLACE), "Destination Continuity");
  assert.equal(continuityLabelForTarget(RESEARCH_TARGET_BRAND), "Entity Continuity");
});

test("saved brand research preserves its target and legacy saved entries remain compatible", () => {
  const storage = new MemoryStorage();
  const saved = saveAnalysis(request(RESEARCH_TARGET_BRAND), result(RESEARCH_TARGET_BRAND), storage, new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(saved.ok, true);
  const reopened = parseSavedAnalyses(storage.getItem("mosaic:saved-analyses:v1"));
  assert.equal(reopened[0]?.request.researchTarget, RESEARCH_TARGET_BRAND);

  const legacy = { ...reopened[0]!, request: { ...reopened[0]!.request, researchTarget: undefined } };
  const legacyReopened = parseSavedAnalyses(JSON.stringify([legacy]));
  assert.equal(legacyReopened[0]?.request.researchTarget, undefined);
  assert.equal(normalizeResearchTarget(legacyReopened[0]?.request.researchTarget), RESEARCH_TARGET_PLACE);
});

test("provider evidence attribution and target identity remain intact", () => {
  const item = result(RESEARCH_TARGET_BRAND).baselineResearch?.evidence[0];
  assert.equal(item?.provenance.providerId, "qloo");
  assert.equal(item?.queryParameters["filter.type"], RESEARCH_TARGET_BRAND);
  assert.equal(item?.objectEntityCategory, "brand");
  assert.equal(item?.verified, true);
});
