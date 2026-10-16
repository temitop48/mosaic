import assert from "node:assert/strict";
import test from "node:test";
import { DecisionEngine } from "@/agent/engine";
import { CounterfactualResearchEngine } from "@/core/counterfactuals/engine";
import type { CulturalEntity } from "@/core/entities/types";
import type { CulturalEvidence } from "@/core/evidence/types";
import type { CulturalIntelligenceProvider, ProviderCapabilities, ProviderResult } from "@/providers/interfaces/contracts";

const capabilities: ProviderCapabilities = { entitySearch: true, affinityDiscovery: true, geographicFiltering: true, affinityExplainability: true, explainability: false };
const source: CulturalEntity = { id: "qloo:brand:source", providerId: "qloo", name: "Example Brand", category: "brand", sourceReference: "qloo:entity:qloo:brand:source", metadata: {} };

function evidence(location: string, targetId: string, score: number): CulturalEvidence {
  return {
    kind: "affinity", id: `qloo:affinity:${location}:${targetId}`, subjectEntityId: source.id, subjectEntityCategory: "brand", subjectEntityName: source.name, objectEntityId: targetId, objectEntityCategory: "place", objectEntityName: targetId,
    providerScore: score, providerScoreLabel: "affinity", providerScoreScale: "qloo:affinity", explainability: { "signal.interests.entities": [{ entity_id: source.id, score: 1 }] }, geographicContext: { city: location, countryCode: "US" },
    queryParameters: { "filter.location.query": location, "filter.type": "urn:entity:place", "signal.interests.entities": source.id }, provenance: { providerId: "qloo", sourceReference: `qloo:insights:${location}:${targetId}`, retrievedAt: "2026-01-01T00:00:00.000Z" }, verified: true,
  };
}

class CounterfactualProvider implements CulturalIntelligenceProvider {
  readonly id = "qloo";
  readonly calls: string[] = [];
  private readonly mode: "normal" | "empty-new-york" | "fail-new-york";
  constructor(mode: "normal" | "empty-new-york" | "fail-new-york" = "normal") { this.mode = mode; }
  getCapabilities(): ProviderCapabilities { return capabilities; }
  async searchEntities(): Promise<ProviderResult<CulturalEntity[]>> { return { ok: true, data: [source] }; }
  async discoverAffinity(request: { locationQuery?: string }): Promise<ProviderResult<CulturalEvidence[]>> {
    const location = request.locationQuery ?? "";
    this.calls.push(location);
    if (location === "New York" && this.mode === "fail-new-york") return { ok: false, error: { code: "UPSTREAM_ERROR", providerId: this.id, message: "fixture failure" } };
    if (location === "New York" && this.mode === "empty-new-york") return { ok: true, data: [] };
    return location === "London"
      ? { ok: true, data: [evidence("London", "qloo:place:shared", 0.82), evidence("London", "qloo:place:london-only", 0.71)] }
      : { ok: true, data: [evidence("New York", "qloo:place:shared", 0.61), evidence("New York", "qloo:place:new-york-only", 0.77)] };
  }
  async explainEvidence(): Promise<ProviderResult<string>> { return { ok: false, error: { code: "UNSUPPORTED_CAPABILITY", providerId: this.id, message: "unsupported" } }; }
}

function engineFor(provider: CulturalIntelligenceProvider): CounterfactualResearchEngine {
  return new CounterfactualResearchEngine(new DecisionEngine(provider, undefined, (() => { let index = 0; return () => `analysis:${++index}`; })()));
}

const request = { baseline: { productConcept: "Coffee launch", launchLocation: "London", seedQueries: ["Example Brand"], seedCategory: "brand" as const, requestedOutcome: "Compare cultural associations", targetTypes: ["urn:entity:place"] }, modification: { dimension: "launchLocation", originalValue: "London", alternativeValue: "New York" } };

test("runs separate London and New York provider research while preserving unchanged scenario fields", async () => {
  const provider = new CounterfactualProvider();
  const result = await engineFor(provider).compare(request);
  assert.equal(result.status, "completed");
  assert.deepEqual(provider.calls, ["London", "New York"]);
  assert.equal(result.baselineScenario.productConcept, request.baseline.productConcept);
  assert.deepEqual(result.baselineScenario.seedQueries, request.baseline.seedQueries);
  assert.deepEqual(result.alternativeScenario.seedQueries, request.baseline.seedQueries);
  assert.equal(result.alternativeScenario.launchLocation, "New York");
  assert.equal(result.baselineResearch?.evidence.length, 2);
  assert.equal(result.alternativeResearch?.evidence.length, 2);
  assert.equal(result.comparison.compared, true);
  assert.equal(result.comparison.sharedEntities.some((item) => item.id === "qloo:place:shared" && item.category === "place"), true);
  assert.equal(result.comparison.baselineOnlyEntities.some((item) => item.id === "qloo:place:london-only"), true);
  assert.equal(result.comparison.alternativeOnlyEntities.some((item) => item.id === "qloo:place:new-york-only"), true);
  assert.equal(result.comparison.sharedRelationships.length, 1);
  assert.equal(result.comparison.changedObservedRelationships.length, 1);
  assert.equal(result.comparison.sharedRelationships[0]?.baseline?.providerScore, 0.82);
  assert.equal(result.comparison.sharedRelationships[0]?.alternative?.providerScore, 0.61);
  assert.equal(result.comparison.geographicContexts.baseline[0]?.city, "London");
  assert.equal(result.comparison.geographicContexts.alternative[0]?.city, "New York");
});

test("matches identities by provider, category and ID rather than display name", async () => {
  class DuplicateNameProvider extends CounterfactualProvider {
    override async discoverAffinity(request: { locationQuery?: string }): Promise<ProviderResult<CulturalEvidence[]>> {
      const result = await super.discoverAffinity(request);
      if (!result.ok) return result;
      return { ok: true, data: result.data.map((item) => item.kind === "affinity" ? { ...item, objectEntityName: "Same Display Name" } : item) };
    }
  }
  const result = await engineFor(new DuplicateNameProvider()).compare(request);
  assert.equal(result.comparison.sharedRelationships.length, 1);
  assert.equal(result.comparison.sharedEntities.filter((item) => item.name === "Same Display Name").length, 1);
});

test("deduplicates repeated query contexts while keeping provider observations intact", async () => {
  class RepeatedContextProvider extends CounterfactualProvider {
    override async discoverAffinity(request: { locationQuery?: string }): Promise<ProviderResult<CulturalEvidence[]>> {
      const result = await super.discoverAffinity(request);
      if (!result.ok) return result;
      return { ok: true, data: [...result.data, ...result.data] };
    }
  }
  const result = await engineFor(new RepeatedContextProvider()).compare(request);
  assert.equal(result.status, "completed");
  assert.equal(result.comparison.baselineEvidenceCount, 2);
  assert.equal(result.comparison.alternativeEvidenceCount, 2);
  assert.equal(result.comparison.queryContexts.baseline.length, 1);
  assert.equal(result.comparison.queryContexts.alternative.length, 1);
});

test("does not fabricate a comparison when alternative evidence is empty", async () => {
  const result = await engineFor(new CounterfactualProvider("empty-new-york")).compare(request);
  assert.equal(result.status, "partial");
  assert.equal(result.comparison.compared, false);
  assert.equal(result.comparison.sharedEntities.length, 0);
  assert.ok(result.errors.some((item) => item.code === "INSUFFICIENT_EVIDENCE"));
  assert.equal(result.alternativeResearch?.evidence.length, 0);
});

test("propagates partial Qloo failures without synthetic alternative evidence", async () => {
  const result = await engineFor(new CounterfactualProvider("fail-new-york")).compare(request);
  assert.equal(result.status, "partial");
  assert.equal(result.alternativeResearch?.evidence.length, 0);
  assert.ok(result.errors.some((item) => item.code === "RESEARCH_FAILURE"));
});

test("rejects unsupported dimensions and mismatched original locations", async () => {
  const unsupported = await engineFor(new CounterfactualProvider()).compare({ ...request, modification: { ...request.modification, dimension: "audience" } });
  assert.equal(unsupported.status, "failed");
  assert.equal(unsupported.errors[0]?.code, "UNSUPPORTED_DIMENSION");
  const mismatch = await engineFor(new CounterfactualProvider()).compare({ ...request, modification: { ...request.modification, originalValue: "Paris" } });
  assert.equal(mismatch.status, "failed");
  assert.equal(mismatch.errors[0]?.code, "INVALID_REQUEST");
});
