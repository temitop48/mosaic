import assert from "node:assert/strict";
import test from "node:test";
import type { CulturalEvidence } from "@/core/evidence/types";
import type { StudioResearchResult } from "@/components/mosaic/studio-model";
import { decisionBriefAssessment, decisionBriefGeographicSummary, decisionBriefNextAction } from "@/components/mosaic/decision-brief-model";

function evidence(id: string, city: string): CulturalEvidence {
  return { kind: "affinity", id, subjectEntityId: "starbucks", subjectEntityCategory: "brand", subjectEntityName: "Starbucks", objectEntityId: id, objectEntityCategory: "place", objectEntityName: `Place ${id}`, providerScore: 0.8, providerScoreScale: "qloo:affinity", queryParameters: { "filter.type": "urn:entity:place", "filter.location.query": city, sort_by: "affinity" }, provenance: { providerId: "qloo", sourceReference: `qloo:${id}`, retrievedAt: "2026-01-01T00:00:00.000Z" }, verified: true };
}

function result(changed = true): StudioResearchResult {
  const baseline = evidence("london-a", "London");
  const alternative = evidence(changed ? "new-york-b" : "london-a", "New York");
  return { status: "completed", dimension: "launchLocation", baselineScenario: { productConcept: "Coffee concept", launchLocation: "London", seedQueries: ["Starbucks"], targetTypes: ["urn:entity:place"] }, alternativeScenario: { productConcept: "Coffee concept", launchLocation: "New York", seedQueries: ["Starbucks"], targetTypes: ["urn:entity:place"] }, baselineResearch: { analysisId: "a", status: "completed", scenario: { productConcept: "Coffee concept", launchLocation: "London", seedQueries: ["Starbucks"], targetTypes: ["urn:entity:place"] }, resolutions: [], evidence: [baseline], graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] }, alternativeResearch: { analysisId: "b", status: "completed", scenario: { productConcept: "Coffee concept", launchLocation: "New York", seedQueries: ["Starbucks"], targetTypes: ["urn:entity:place"] }, resolutions: [], evidence: [alternative], graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] }, comparison: { compared: true, baselineEvidenceCount: 1, alternativeEvidenceCount: 1, baselineGraphEdgeCount: 1, alternativeGraphEdgeCount: 1, sharedEntities: [], baselineOnlyEntities: [], alternativeOnlyEntities: [], sharedRelationships: [], baselineOnlyRelationships: [], alternativeOnlyRelationships: [], changedObservedRelationships: changed ? [{ providerId: "qloo", subjectEntityId: "starbucks", subjectEntityCategory: "brand", objectEntityId: "new-york-b", objectEntityCategory: "place", alternative: { evidenceId: alternative.id, providerId: "qloo", subjectEntityId: "starbucks", subjectEntityCategory: "brand", objectEntityId: alternative.objectEntityId, objectEntityCategory: "place", providerScore: alternative.providerScore, queryParameters: alternative.queryParameters, retrievedAt: alternative.provenance.retrievedAt } }] : [], evidenceChanges: changed ? [{ changeType: "added-in-alternative", providerId: "qloo", subjectEntityId: "starbucks", subjectEntityCategory: "brand", objectEntityId: "new-york-b", objectEntityCategory: "place", alternative: { evidenceId: alternative.id, providerId: "qloo", subjectEntityId: "starbucks", subjectEntityCategory: "brand", objectEntityId: alternative.objectEntityId, objectEntityCategory: "place", providerScore: alternative.providerScore, queryParameters: alternative.queryParameters, retrievedAt: alternative.provenance.retrievedAt } }] : [], queryContexts: { baseline: [baseline.queryParameters], alternative: [alternative.queryParameters] }, geographicContexts: { baseline: [], alternative: [] }, limitations: [] }, limitations: [], errors: [], strategicInterpretationStatus: "not-requested" };
}

test("builds a supported verdict and geographic scope without commercial claims", () => {
  const value = result();
  const assessment = decisionBriefAssessment(value);
  assert.equal(assessment.conclusion, "geographic-differences-observed");
  assert.match(decisionBriefGeographicSummary(value), /London and New York/);
  assert.match(decisionBriefNextAction(value, assessment), /independent commercial research/);
});

test("reports no observed differentiation without implying identical markets", () => {
  const value = result(false);
  assert.equal(decisionBriefAssessment(value).conclusion, "no-observed-differences");
  assert.match(decisionBriefGeographicSummary(value), /does not establish identical cultural landscapes/);
});

test("incomplete research receives an evidence limitation and no unsupported verdict", () => {
  const value = { ...result(), status: "partial" as const, alternativeResearch: undefined };
  const assessment = decisionBriefAssessment(value);
  assert.equal(assessment.conclusion, "comparison-incomplete");
  assert.match(decisionBriefGeographicSummary(value), /incomplete/);
});
