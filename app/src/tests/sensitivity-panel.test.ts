import assert from "node:assert/strict";
import test from "node:test";
import { compareDecisionSensitivity } from "@/core/sensitivity/compare";
import { sensitivityMarketSummary, sensitivityRelationshipDisplay } from "@/components/mosaic/studio-model";
import { type AffinityEvidence } from "@/core/evidence/types";
import { type CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { DecisionSensitivityRelationship } from "@/core/sensitivity/contracts";

const scenario = (seed: string) => ({ productConcept: "Athletic lifestyle brand", launchLocation: "Lagos", seedQueries: [seed], seedCategory: "brand" as const, targetTypes: ["urn:entity:brand"] });

function evidence(signal: string, city: string, objectId: string, objectName?: string, score = 0.8): AffinityEvidence {
  return {
    kind: "affinity", id: `${signal}:${city}:${objectId}`, subjectEntityId: `qloo:brand:${signal.toLowerCase()}`, subjectEntityCategory: "brand", subjectEntityName: signal,
    objectEntityId: objectId, objectEntityCategory: "brand", objectEntityName: objectName, providerScore: score, providerScoreScale: "qloo:affinity",
    queryParameters: { "filter.location.query": city, "filter.type": "urn:entity:brand" }, provenance: { providerId: "qloo", sourceReference: `qloo:${signal}:${objectId}`, retrievedAt: "2026-01-01T00:00:00.000Z" }, verified: true,
  };
}

function research(seed: string, city: string, items: AffinityEvidence) {
  return { analysisId: `${seed}:${city}`, status: "completed" as const, scenario: { ...scenario(seed), launchLocation: city }, resolutions: [], evidence: [items], graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] };
}

function result(seed: string, item: AffinityEvidence): CounterfactualResult {
  return {
    status: "completed", dimension: "launchLocation", baselineScenario: scenario(seed), alternativeScenario: { ...scenario(seed), launchLocation: "New York" },
    baselineResearch: research(seed, "Lagos", item), alternativeResearch: research(seed, "New York", item), comparison: { compared: true, baselineEvidenceCount: 1, alternativeEvidenceCount: 1, baselineGraphEdgeCount: 0, alternativeGraphEdgeCount: 0, sharedEntities: [], baselineOnlyEntities: [], alternativeOnlyEntities: [], sharedRelationships: [], baselineOnlyRelationships: [], alternativeOnlyRelationships: [], changedObservedRelationships: [], evidenceChanges: [], queryContexts: { baseline: [], alternative: [] }, geographicContexts: { baseline: [], alternative: [] }, limitations: [] }, limitations: [], errors: [], strategicInterpretationStatus: "not-requested",
  };
}

test("builds concise per-market summary values without changing comparison data", () => {
  const original = result("Adidas", evidence("Adidas", "Lagos", "qloo:brand:nike", "Nike", 0.8));
  const variant = result("Starbucks", evidence("Starbucks", "Lagos", "qloo:brand:nike", "Nike", 0.4));
  const sensitivity = compareDecisionSensitivity({ assumption: { dimension: "culturalSignal", originalValue: "Adidas", alternativeValue: "Starbucks" }, originalResult: original, variantResult: variant });
  const before = structuredClone(sensitivity.comparison.baseline);
  const summary = sensitivityMarketSummary(sensitivity, "baseline");
  assert.deepEqual(summary, { sharedObservedTargetEntities: 1, originalOnlyObservedTargets: 0, modifiedOnlyObservedTargets: 0, exactRelationshipChanges: 0, totalRelationshipChanges: 2 });
  assert.deepEqual(sensitivity.comparison.baseline, before);
});

test("maps verified names to original and modified relationship labels", () => {
  const original = result("Adidas", evidence("Adidas", "Lagos", "qloo:brand:nike", "Nike"));
  const variant = result("Starbucks", evidence("Starbucks", "Lagos", "qloo:brand:nike", "Nike"));
  const relationship = {
    status: "changed" as const,
    providerId: "qloo",
    subjectEntityId: "qloo:brand:adidas",
    subjectEntityCategory: "brand" as const,
    objectEntityId: "qloo:brand:nike",
    objectEntityCategory: "brand" as const,
    originalEvidence: { evidenceId: "Adidas:Lagos:qloo:brand:nike", providerId: "qloo", subjectEntityId: "qloo:brand:adidas", subjectEntityCategory: "brand" as const, objectEntityId: "qloo:brand:nike", objectEntityCategory: "brand" as const, providerScore: 0.8, geographicContext: { city: "Lagos" }, queryParameters: {}, retrievedAt: "2026-01-01T00:00:00.000Z" },
    variantEvidence: { evidenceId: "Starbucks:Lagos:qloo:brand:nike", providerId: "qloo", subjectEntityId: "qloo:brand:starbucks", subjectEntityCategory: "brand" as const, objectEntityId: "qloo:brand:nike", objectEntityCategory: "brand" as const, providerScore: 0.8, geographicContext: { city: "Lagos" }, queryParameters: {}, retrievedAt: "2026-01-01T00:00:00.000Z" },
  } satisfies DecisionSensitivityRelationship;
  assert.deepEqual(sensitivityRelationshipDisplay(relationship, original, variant), { original: "Adidas → Nike", modified: "Starbucks → Nike" });
});

test("uses concise technical identity fallback when verified names are absent", () => {
  const original = result("Adidas", evidence("Adidas", "Lagos", "qloo:brand:nike"));
  const variant = result("Starbucks", evidence("Starbucks", "Lagos", "qloo:brand:nike"));
  const relationship = {
    status: "changed" as const,
    providerId: "qloo",
    subjectEntityId: "qloo:brand:adidas",
    subjectEntityCategory: "brand" as const,
    objectEntityId: "qloo:brand:nike",
    objectEntityCategory: "brand" as const,
    originalEvidence: { evidenceId: "Adidas:Lagos:qloo:brand:nike", providerId: "qloo", subjectEntityId: "qloo:brand:adidas", subjectEntityCategory: "brand" as const, objectEntityId: "qloo:brand:nike", objectEntityCategory: "brand" as const, providerScore: 0.8, geographicContext: { city: "Lagos" }, queryParameters: {}, retrievedAt: "2026-01-01T00:00:00.000Z" },
    variantEvidence: { evidenceId: "Starbucks:Lagos:qloo:brand:nike", providerId: "qloo", subjectEntityId: "qloo:brand:starbucks", subjectEntityCategory: "brand" as const, objectEntityId: "qloo:brand:nike", objectEntityCategory: "brand" as const, providerScore: 0.8, geographicContext: { city: "Lagos" }, queryParameters: {}, retrievedAt: "2026-01-01T00:00:00.000Z" },
  } satisfies DecisionSensitivityRelationship;
  assert.deepEqual(sensitivityRelationshipDisplay(relationship, original, variant), { original: "Adidas → brand qloo:brand:nike", modified: "Starbucks → brand qloo:brand:nike" });
});

test("qualifies partial results while retaining all evidence references", () => {
  const original = result("Adidas", evidence("Adidas", "Lagos", "qloo:brand:nike", "Nike"));
  const variant = result("Starbucks", evidence("Starbucks", "Lagos", "qloo:brand:nike", "Nike"));
  const sensitivity = compareDecisionSensitivity({ assumption: { dimension: "culturalSignal", originalValue: "Adidas", alternativeValue: "Starbucks" }, originalResult: original, variantResult: variant });
  sensitivity.variantResult.status = "partial";
  sensitivity.variantResult.alternativeResearch!.status = "partial";
  assert.equal(sensitivity.comparison.baseline.notObservedInVariant[0]?.originalEvidence?.evidenceId, "Adidas:Lagos:qloo:brand:nike");
  assert.equal(sensitivity.comparison.baseline.newInVariant[0]?.variantEvidence?.evidenceId, "Starbucks:Lagos:qloo:brand:nike");
});
