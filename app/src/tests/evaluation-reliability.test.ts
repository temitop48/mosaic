import assert from "node:assert/strict";
import test from "node:test";
import { DecisionEngine } from "@/agent/engine";
import type { CulturalEntity } from "@/core/entities/types";
import type { CulturalEvidence } from "@/core/evidence/types";
import type { CulturalIntelligenceProvider, ProviderCapabilities, ProviderResult } from "@/providers/interfaces/contracts";

const capabilities: ProviderCapabilities = { entitySearch: true, affinityDiscovery: true, geographicFiltering: true, affinityExplainability: true, explainability: false };
const entity: CulturalEntity = { id: "qloo:brand:signal", providerId: "qloo", name: "Signal Brand", category: "brand", sourceReference: "qloo:entity:signal", metadata: {} };
const validEvidence: CulturalEvidence = { kind: "affinity", id: "qloo:affinity:signal:place", subjectEntityId: entity.id, subjectEntityCategory: "brand", subjectEntityName: entity.name, objectEntityId: "qloo:place:1", objectEntityCategory: "place", objectEntityName: "Fixture Place", providerScore: 0.7, geographicContext: { city: "London" }, queryParameters: { "filter.location.query": "London" }, provenance: { providerId: "qloo", sourceReference: "qloo:insight:signal:place", retrievedAt: "2026-01-01T00:00:00.000Z" }, verified: true };

class FixtureProvider implements CulturalIntelligenceProvider {
  readonly id = "qloo";
  private readonly mode: "valid" | "provider-error" | "malformed" | "not-found";
  constructor(mode: "valid" | "provider-error" | "malformed" | "not-found") { this.mode = mode; }
  getCapabilities(): ProviderCapabilities { return capabilities; }
  async searchEntities(): Promise<ProviderResult<CulturalEntity[]>> {
    if (this.mode === "provider-error") return { ok: false, error: { code: "UPSTREAM_ERROR", providerId: this.id, message: "fixture provider failure" } };
    return { ok: true, data: this.mode === "not-found" ? [] : [entity] };
  }
  async discoverAffinity(): Promise<ProviderResult<CulturalEvidence[]>> {
    if (this.mode === "provider-error") return { ok: false, error: { code: "TIMEOUT", providerId: this.id, message: "fixture timeout" } };
    if (this.mode === "malformed") return { ok: true, data: [{ ...validEvidence, providerScore: undefined } as CulturalEvidence] };
    return { ok: true, data: [validEvidence] };
  }
  async explainEvidence(): Promise<ProviderResult<string>> { return { ok: false, error: { code: "UNSUPPORTED_CAPABILITY", providerId: this.id, message: "unsupported" } }; }
}

const scenario = { productConcept: "Coffee", launchLocation: "London", seedQueries: ["Signal Brand"], seedCategory: "brand" as const, targetTypes: ["urn:entity:place"] };

function research(provider: CulturalIntelligenceProvider) {
  let sequence = 0;
  return new DecisionEngine(provider, undefined, () => `evaluation:${++sequence}`);
}

test("provider errors become explicit partial research, never successful results", async () => {
  const result = await research(new FixtureProvider("provider-error")).research(scenario);
  assert.equal(result.status, "partial");
  assert.ok(result.errors.some((item) => item.code === "PROVIDER_FAILURE"));
  assert.equal(result.evidence.length, 0);
});

test("malformed provider observations are rejected instead of bypassing evidence validation", async () => {
  const result = await research(new FixtureProvider("malformed")).research(scenario);
  assert.equal(result.status, "partial");
  assert.ok(result.errors.some((item) => item.code === "EVIDENCE_VALIDATION_FAILURE"));
  assert.equal(result.evidence.length, 0);
});

test("unresolved entities do not produce invented evidence", async () => {
  const result = await research(new FixtureProvider("not-found")).research(scenario);
  assert.equal(result.status, "partial");
  assert.ok(result.errors.some((item) => item.code === "ENTITY_NOT_FOUND"));
  assert.equal(result.evidence.length, 0);
  assert.equal(result.graph.edges.length, 0);
});

test("identical mocked provider inputs produce deterministic research output", async () => {
  const first = await research(new FixtureProvider("valid")).research(scenario);
  const second = await research(new FixtureProvider("valid")).research(scenario);
  assert.deepEqual({ ...first, analysisId: "fixed" }, { ...second, analysisId: "fixed" });
  assert.equal(first.status, "completed");
  assert.equal(first.evidence[0]?.providerScore, 0.7);
});
