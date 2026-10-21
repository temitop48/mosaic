import assert from "node:assert/strict";
import test from "node:test";
import { DecisionRecommendationSchema } from "@/core/decisions/contracts";
import { buildEvidenceGraph } from "@/core/evidence/graph";
import { assessRecommendationSupport } from "@/core/evidence/recommendations";
import { EvidenceRegistry } from "@/core/evidence/registry";
import { validateEvidence } from "@/core/evidence/validation";
import type { CulturalEntity } from "@/core/entities/types";
import type { AffinityEvidence } from "@/core/evidence/types";

const source: CulturalEntity = { id: "qloo:brand:signal", providerId: "qloo", name: "Signal Brand", category: "brand", sourceReference: "qloo:entity:brand:signal", metadata: {} };
const place: CulturalEntity = { id: "qloo:place:london", providerId: "qloo", name: "London Place", category: "place", geographicContext: { city: "London" }, sourceReference: "qloo:entity:place:london", metadata: {} };
const affinity: AffinityEvidence = { kind: "affinity", id: "qloo:affinity:signal:london", subjectEntityId: source.id, subjectEntityCategory: source.category, subjectEntityName: source.name, objectEntityId: place.id, objectEntityCategory: place.category, objectEntityName: place.name, providerScore: 0.82, providerScoreScale: "qloo:affinity", geographicContext: { city: "London" }, queryParameters: { "filter.location.query": "London", "filter.type": "urn:entity:place" }, provenance: { providerId: "qloo", sourceReference: "qloo:insights:signal:london", retrievedAt: "2026-01-01T00:00:00.000Z" }, verified: true };

function registry(): EvidenceRegistry {
  const value = new EvidenceRegistry();
  value.registerEntities([source, place]);
  return value;
}

test("retains valid provider observations, IDs, score, and graph attribution", () => {
  const result = registry().registerEvidence(affinity);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  const stored = result.evidence;
  assert.equal(stored.provenance.providerId, "qloo");
  assert.equal(stored.subjectEntityId, source.id);
  assert.equal(stored.objectEntityId, place.id);
  assert.equal(stored.providerScore, 0.82);
  const evidenceRegistry = registry();
  evidenceRegistry.registerEvidence(affinity);
  const graph = buildEvidenceGraph(evidenceRegistry);
  assert.deepEqual(graph.edges[0] && { evidenceId: graph.edges[0].evidenceId, subjectEntityId: graph.edges[0].subjectEntityId, objectEntityId: graph.edges[0].objectEntityId, providerScore: graph.edges[0].providerScore }, { evidenceId: affinity.id, subjectEntityId: source.id, objectEntityId: place.id, providerScore: 0.82 });
});

test("rejects missing identities, fabricated scores, and provider/category mismatches", () => {
  const value = registry();
  assert.equal(value.registerEvidence({ ...affinity, id: "missing-object", objectEntityId: "qloo:place:invented" }).valid, false);
  assert.equal(value.registerEvidence({ ...affinity, id: "missing-score", providerScore: undefined }).valid, false);
  assert.equal(value.registerEvidence({ ...affinity, id: "wrong-provider", provenance: { ...affinity.provenance, providerId: "other-provider" } }).valid, false);
  assert.equal(validateEvidence({ ...affinity, verified: false }, [source, place]).valid, false);
  assert.equal(value.listValidatedEvidence().length, 0);
});

test("does not promote unsupported recommendation claims to provider-backed status", () => {
  const value = registry();
  value.registerEvidence(affinity);
  const recommendation = DecisionRecommendationSchema.parse({ action: "Review cultural affinity", rationale: "Evidence review only.", confidence: "low", evidenceIds: [affinity.id] });
  const assessment = assessRecommendationSupport(recommendation, [{ claim: "The provider reported a partnership.", subjectEntityId: source.id, objectEntityId: "qloo:place:unrelated", evidenceIds: [affinity.id] }], value);
  assert.equal(assessment.classification, "interpretation");
  assert.equal(assessment.claims[0]?.classification, "interpretation");
  assert.equal(assessment.claims[0]?.unsupportedReason, "unrelated-evidence");
});

test("preserves existing historical saved evidence metadata through validation boundaries", () => {
  const parsed = validateEvidence(affinity, [source, place]);
  assert.equal(parsed.valid, true);
  if (!parsed.valid) return;
  assert.deepEqual(parsed.evidence.provenance, affinity.provenance);
  assert.deepEqual(parsed.evidence.queryParameters, affinity.queryParameters);
  assert.deepEqual(parsed.evidence.geographicContext, affinity.geographicContext);
});
