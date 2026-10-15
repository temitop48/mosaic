import assert from "node:assert/strict";
import { test } from "node:test";
import { DecisionRecommendationSchema } from "@/core/decisions/contracts";
import { buildEvidenceGraph } from "@/core/evidence/graph";
import { EvidenceRegistry } from "@/core/evidence/registry";
import { assessRecommendationSupport } from "@/core/evidence/recommendations";
import type { CulturalEntity } from "@/core/entities/types";
import type { AffinityEvidence } from "@/core/evidence/types";

const brand: CulturalEntity = {
  id: "brand:starbucks",
  providerId: "qloo",
  name: "Starbucks",
  category: "brand",
  sourceReference: "qloo:entity:brand:starbucks",
  metadata: {},
};

const place: CulturalEntity = {
  id: "place:london-1",
  providerId: "qloo",
  name: "London Fixture Place",
  category: "place",
  geographicContext: { city: "London" },
  sourceReference: "qloo:entity:place:london-1",
  metadata: {},
};

const affinity: AffinityEvidence = {
  id: "qloo:affinity:brand:starbucks:place:london-1:London",
  kind: "affinity",
  subjectEntityId: brand.id,
  subjectEntityCategory: "brand",
  subjectEntityName: brand.name,
  objectEntityId: place.id,
  objectEntityCategory: "place",
  objectEntityName: place.name,
  providerScore: 0.82,
  providerScoreScale: "qloo:affinity",
  explainability: { "signal.interests.entities": [{ entity_id: brand.id, score: 1 }] },
  geographicContext: { city: "London" },
  queryParameters: {
    "filter.type": "urn:entity:place",
    "filter.location.query": "London",
    "signal.interests.entities": brand.id,
  },
  provenance: {
    providerId: "qloo",
    sourceReference: "qloo:insights:brand:starbucks:place:london-1",
    retrievedAt: "2026-01-01T00:00:00.000Z",
  },
  verified: true,
};

function registryWithEvidence(): EvidenceRegistry {
  const registry = new EvidenceRegistry();
  registry.registerEntities([brand, place]);
  const result = registry.registerEvidence(affinity);
  assert.equal(result.valid, true);
  return registry;
}

test("registry accepts validated provider evidence and preserves identity context", () => {
  const registry = registryWithEvidence();
  const stored = registry.getEvidence(affinity.id);
  assert.equal(stored?.subjectEntityCategory, "brand");
  assert.equal(stored?.objectEntityCategory, "place");
  assert.equal(stored?.geographicContext?.city, "London");
  assert.equal(stored?.explainability?.["signal.interests.entities"] !== undefined, true);
});

test("registry rejects unsupported, unverifiable, and mismatched evidence", () => {
  const registry = new EvidenceRegistry();
  registry.registerEntities([brand, place]);

  const missingScore = registry.registerEvidence({ ...affinity, id: "missing-score", providerScore: undefined });
  assert.equal(missingScore.valid, false);

  const mismatchedCategory = registry.registerEvidence({ ...affinity, id: "mismatched", objectEntityCategory: "brand" });
  assert.equal(mismatchedCategory.valid, false);

  const unverified = registry.registerEvidence({ ...affinity, id: "unverified", verified: false });
  assert.equal(unverified.valid, false);
  assert.equal(registry.listValidatedEvidence().length, 0);
});

test("graph edges reference validated evidence and retain brand/place distinction", () => {
  const graph = buildEvidenceGraph(registryWithEvidence());
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].kind, "provider-affinity");
  assert.equal(graph.edges[0].evidenceId, affinity.id);
  assert.equal(graph.edges[0].subjectEntityCategory, "brand");
  assert.equal(graph.edges[0].objectEntityCategory, "place");
  assert.equal("relationshipType" in graph.edges[0], false);
});

test("recommendations remain interpretations when evidence is unrelated", () => {
  const registry = registryWithEvidence();
  const recommendation = DecisionRecommendationSchema.parse({
    action: "Consider a London launch",
    rationale: "The evidence may inform cultural exploration.",
    confidence: "low",
    evidenceIds: [affinity.id],
    caveats: ["Qloo affinity is not commercial demand or causation."],
  });
  const assessment = assessRecommendationSupport(recommendation, [{
    claim: "The source brand has a commercial partnership with the place.",
    subjectEntityId: brand.id,
    objectEntityId: "place:unrelated",
    evidenceIds: [affinity.id],
  }], registry);
  assert.equal(assessment.classification, "interpretation");
  assert.equal(assessment.claims[0].classification, "interpretation");
  assert.equal(assessment.claims[0].unsupportedReason, "unrelated-evidence");
});

test("a specific claim is provider-backed only when its entity pair matches evidence", () => {
  const registry = registryWithEvidence();
  const recommendation = DecisionRecommendationSchema.parse({
    action: "Review London cultural affinity",
    rationale: "This is an evidence review, not a commercial conclusion.",
    confidence: "medium",
    evidenceIds: [affinity.id],
  });
  const assessment = assessRecommendationSupport(recommendation, [{
    claim: "Qloo reported an affinity between the source brand and this place.",
    subjectEntityId: brand.id,
    objectEntityId: place.id,
    evidenceIds: [affinity.id],
  }], registry);
  assert.equal(assessment.classification, "interpretation");
  assert.equal(assessment.claims[0].classification, "provider-backed");
});
