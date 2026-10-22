import test from "node:test";
import assert from "node:assert/strict";
import {
  CULTURAL_CONNECTIONS_LABEL,
  providerExplanationText,
  researchScopeForMarket,
  targetTypeLabel,
} from "@/components/mosaic/studio-model";
import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";

const evidence: CulturalEvidence = {
  kind: "affinity",
  id: "qloo:affinity:adidas:lagos",
  subjectEntityId: "FCEA7CA1-1D40-4680-B337-E74594D9BCF1",
  subjectEntityCategory: "brand",
  subjectEntityName: "Adidas",
  objectEntityId: "qloo:place:one",
  objectEntityCategory: "place",
  objectEntityName: "Example Place",
  providerScore: 0.82,
  providerScoreScale: "qloo:affinity",
  explainability: { "signal.interests.entities": [{ entity_id: "FCEA7CA1-1D40-4680-B337-E74594D9BCF1", score: 1 }] },
  queryParameters: {
    "filter.type": "urn:entity:place",
    "signal.interests.entities": "FCEA7CA1-1D40-4680-B337-E74594D9BCF1",
    "filter.location.query": "Lagos",
    "sort_by": "affinity",
  },
  provenance: {
    providerId: "qloo",
    sourceReference: "qloo:insights:adidas:place-one",
    retrievedAt: "2026-01-01T00:00:00.000Z",
  },
  geographicContext: { city: "Lagos" },
  verified: true,
};

const result = {
  status: "completed",
  dimension: "launchLocation",
  baselineScenario: { productConcept: "Athletic lifestyle brand", seedQueries: ["Adidas"], launchLocation: "Lagos" },
  alternativeScenario: { productConcept: "Athletic lifestyle brand", seedQueries: ["Adidas"], launchLocation: "New York" },
  baselineResearch: {
    scenario: { productConcept: "Athletic lifestyle brand", seedQueries: ["Adidas"], targetTypes: ["urn:entity:place"], launchLocation: "Lagos" },
    plan: { targetTypes: ["urn:entity:place"] },
    resolutions: [{ query: "Adidas", status: "resolved", candidates: [], entity: { id: evidence.subjectEntityId, providerId: "qloo", name: "Adidas", category: "brand", sourceReference: "qloo:entity:adidas", metadata: {} } }],
    evidence: [evidence],
  },
  alternativeResearch: undefined,
  comparison: {},
  limitations: [],
  errors: [],
  strategicInterpretationStatus: "not-requested",
} as unknown as CounterfactualResult;

test("uses the transparent cultural-connections label", () => {
  assert.equal(CULTURAL_CONNECTIONS_LABEL, "Top Cultural Connections");
});

test("discloses the effective provider scope without inferring from concept", () => {
  assert.equal(targetTypeLabel("urn:entity:place"), "place");
  assert.deepEqual(researchScopeForMarket(result, "baseline"), {
    signal: "Adidas",
    city: "Lagos",
    targetType: "place",
    provider: "qloo",
    ordering: "affinity",
  });
  assert.equal(evidence.queryParameters["filter.type"], "urn:entity:place");
  assert.equal(evidence.provenance.providerId, "qloo");
});

test("only displays explicit human-readable provider explanation fields", () => {
  assert.equal(providerExplanationText({ description: "Associated through Qloo's provider data." }), "Associated through Qloo's provider data.");
  assert.equal(providerExplanationText({ "signal.interests.entities": [{ entity_id: "source", score: 1 }] }), undefined);
  assert.equal(providerExplanationText(undefined), undefined);
});
