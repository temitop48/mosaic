import assert from "node:assert/strict";
import test from "node:test";
import type { CulturalEntity } from "@/core/entities/types";
import type { CulturalEvidence } from "@/core/evidence/types";
import type { CulturalIntelligenceProvider, ProviderCapabilities, ProviderResult } from "@/providers/interfaces/contracts";
import { DecisionEngine } from "@/agent/engine";
import { resolveEntityCandidates } from "@/agent/planning";
import { parseBlueprintModelOutput, type BlueprintModelInput, type ModelResult, type StructuredModelProvider } from "@/agent/model";
import { geminiConfigFromEnvironment } from "@/providers/gemini/config";
import { qlooConfigFromEnvironment } from "@/providers/qloo/config";

const capabilities: ProviderCapabilities = { entitySearch: true, affinityDiscovery: true, geographicFiltering: true, explainability: true };

const source: CulturalEntity = {
  id: "qloo:brand:source",
  providerId: "qloo",
  name: "Example Brand",
  category: "brand",
  sourceReference: "qloo:entity:qloo:brand:source",
  metadata: {},
};

const target: CulturalEntity = {
  id: "qloo:place:target",
  providerId: "qloo",
  name: "London Place",
  category: "place",
  geographicContext: { city: "London", countryCode: "GB" },
  sourceReference: "qloo:entity:qloo:place:target",
  metadata: {},
};

const evidence: CulturalEvidence = {
  kind: "affinity",
  id: "qloo:affinity:source:target:london",
  subjectEntityId: source.id,
  subjectEntityCategory: source.category,
  subjectEntityName: source.name,
  objectEntityId: target.id,
  objectEntityCategory: target.category,
  objectEntityName: target.name,
  providerScore: 0.81,
  providerScoreLabel: "affinity",
  providerScoreScale: "qloo:affinity",
  explainability: { "signal.interests.entities": [{ entity_id: source.id, score: 1 }] },
  geographicContext: { city: "London", countryCode: "GB" },
  queryParameters: { "filter.location.query": "London", "filter.type": "urn:entity:place" },
  provenance: { providerId: "qloo", sourceReference: "qloo:insights:source:target", retrievedAt: "2026-10-15T10:00:00.000Z" },
  verified: true,
};

class FakeProvider implements CulturalIntelligenceProvider {
  readonly id = "fake-provider";
  calls: { search: string[]; affinity: string[] } = { search: [], affinity: [] };
  private readonly searchResult: ProviderResult<CulturalEntity[]>;
  private readonly affinityResult: ProviderResult<CulturalEvidence[]>;
  private readonly providerCapabilities: ProviderCapabilities;
  constructor(
    searchResult: ProviderResult<CulturalEntity[]> = { ok: true, data: [source] },
    affinityResult: ProviderResult<CulturalEvidence[]> = { ok: true, data: [evidence] },
    providerCapabilities = capabilities,
  ) {
    this.searchResult = searchResult;
    this.affinityResult = affinityResult;
    this.providerCapabilities = providerCapabilities;
  }
  getCapabilities(): ProviderCapabilities { return this.providerCapabilities; }
  async searchEntities(request: { query: string }): Promise<ProviderResult<CulturalEntity[]>> {
    this.calls.search.push(request.query);
    return this.searchResult;
  }
  async discoverAffinity(request: { entityId: string; targetType: string; locationQuery?: string }): Promise<ProviderResult<CulturalEvidence[]>> {
    this.calls.affinity.push(`${request.entityId}|${request.targetType}|${request.locationQuery ?? ""}`);
    return this.affinityResult;
  }
  async explainEvidence(): Promise<ProviderResult<string>> { return { ok: false, error: { code: "UNSUPPORTED_CAPABILITY", providerId: this.id, message: "unsupported" } }; }
}

class PairAwareModel implements StructuredModelProvider {
  readonly id = "pair-aware-test-model";
  async generateBlueprint(input: BlueprintModelInput): Promise<ModelResult> {
    const item = input.evidence[0] as typeof evidence;
    return parseBlueprintModelOutput({
      who: { claims: [{ text: "The provider reported this entity association.", classification: "verified-observation", evidenceIds: [item.id], subjectEntityId: item.subjectEntityId, objectEntityId: item.objectEntityId }] },
      where: { claims: [] }, withWhat: { claims: [] }, alongsideWhom: { claims: [] }, why: { claims: [] }, caveats: [],
    });
  }
}

class ModelWithFabricatedReference implements StructuredModelProvider {
  readonly id = "bad-test-model";
  async generateBlueprint(): Promise<ModelResult> {
    return parseBlueprintModelOutput({
      who: { claims: [{ text: "Unsupported claim", classification: "verified-observation", evidenceIds: ["fabricated:evidence"] }] },
      where: { claims: [] }, withWhat: { claims: [] }, alongsideWhom: { claims: [] }, why: { claims: [] }, caveats: [],
    });
  }
}

const scenario = { productConcept: "A launch", launchLocation: "London", seedQueries: ["Example Brand"], seedCategory: "brand" as const, targetTypes: ["urn:entity:place"] };
const engineFor = (provider: CulturalIntelligenceProvider, model: StructuredModelProvider = new PairAwareModel()) => new DecisionEngine(provider, model, () => "analysis:test");

test("validates structured scenarios and completes genuine provider-backed research", async () => {
  const provider = new FakeProvider();
  const result = await engineFor(provider).analyze(scenario);
  assert.equal(result.status, "completed");
  assert.equal(result.evidence[0]?.providerScore, 0.81);
  assert.equal(result.graph.edges.length, 1);
  assert.deepEqual(result.graph.nodes.map((node) => node.category), ["brand", "place"]);
  assert.deepEqual(provider.calls.affinity, [`${source.id}|urn:entity:place|London`]);
  assert.equal(result.blueprint?.who.claims[0]?.classification, "verified-observation");
});

test("accepts natural language but does not silently select an ambiguous entity", async () => {
  const provider = new FakeProvider({ ok: true, data: [source, { ...source, id: "qloo:brand:other", name: source.name }] });
  const result = await engineFor(provider).analyze({ text: 'Launch "Example Brand" in London' });
  assert.equal(result.status, "partial");
  assert.equal(result.resolutions[0]?.status, "ambiguous");
  assert.equal(provider.calls.affinity.length, 0);
});

test("reports no matching entity and empty affinity results explicitly", async () => {
  const missing = await engineFor(new FakeProvider({ ok: true, data: [] })).analyze(scenario);
  assert.equal(missing.resolutions[0]?.status, "not-found");
  assert.ok(missing.errors.some((item) => item.code === "ENTITY_NOT_FOUND"));
  const empty = await engineFor(new FakeProvider({ ok: true, data: [source] }, { ok: true, data: [] })).analyze(scenario);
  assert.ok(empty.errors.some((item) => item.code === "EMPTY_RESULTS"));
  assert.equal(empty.evidence.length, 0);
});

test("isolates evidence registries between analysis executions", async () => {
  const provider = new FakeProvider();
  const engine = engineFor(provider);
  const first = await engine.analyze(scenario);
  const second = await engine.analyze(scenario);
  assert.equal(first.evidence.length, 1);
  assert.equal(second.evidence.length, 1);
  assert.equal(second.blueprint?.who.claims[0]?.evidenceIds[0], evidence.id);
});

test("downgrades fabricated model evidence references", async () => {
  const result = await engineFor(new FakeProvider(), new ModelWithFabricatedReference()).analyze(scenario);
  assert.equal(result.status, "completed");
  const claim = result.blueprint?.who.claims[0];
  assert.equal(claim?.classification, "unverified-suggestion");
  assert.deepEqual(claim?.evidenceIds, []);
  assert.ok(result.limitations.some((item) => item.includes("fabricated")));
});

test("propagates provider failures without fabricating cultural results", async () => {
  const result = await engineFor(new FakeProvider(undefined, { ok: false, error: { code: "AUTHENTICATION_ERROR", providerId: "qloo", message: "unauthorized" } })).analyze(scenario);
  assert.equal(result.status, "partial");
  assert.equal(result.evidence.length, 0);
  assert.equal(result.graph.edges.length, 0);
  assert.equal(result.blueprint, undefined);
  assert.ok(result.errors.some((item) => item.code === "PROVIDER_FAILURE"));
});

test("rejects unsupported provider capabilities before making calls", async () => {
  const provider = new FakeProvider(undefined, undefined, { ...capabilities, affinityDiscovery: false });
  const result = await engineFor(provider).analyze(scenario);
  assert.equal(result.status, "failed");
  assert.equal(result.errors[0]?.code, "UNSUPPORTED_CAPABILITY");
  assert.equal(provider.calls.search.length, 0);
});

test("returns model validation failures explicitly", async () => {
  const invalid = parseBlueprintModelOutput({ who: {} });
  assert.equal(invalid.ok, false);
});

test("handles missing provider configuration without exposing credentials", () => {
  const emptyEnvironment = {} as NodeJS.ProcessEnv;
  assert.equal(geminiConfigFromEnvironment(emptyEnvironment), undefined);
  assert.throws(() => qlooConfigFromEnvironment(emptyEnvironment), /Invalid input/);
});

test("propagates unsupported cultural target responses", async () => {
  const provider = new FakeProvider(undefined, { ok: false, error: { code: "UNSUPPORTED_CAPABILITY", providerId: "qloo", message: "Target type is unsupported" } });
  const result = await engineFor(provider).analyze(scenario);
  assert.equal(result.status, "partial");
  assert.ok(result.errors.some((item) => item.code === "UNSUPPORTED_CAPABILITY"));
});

test("resolves a unique exact-name brand while preserving provider identity", () => {
  const result = resolveEntityCandidates("Starbucks", [{ ...source, id: "brand:starbucks", name: "Starbucks", category: "brand" }], { category: "brand" });
  assert.equal(result.status, "resolved");
  assert.equal(result.entity?.id, "brand:starbucks");
  assert.equal(result.entity?.category, "brand");
});

test("prefers the requested brand when place and brand names are identical", () => {
  const place = { ...target, id: "place:starbucks", name: "Starbucks" };
  const brand = { ...source, id: "brand:starbucks", name: "Starbucks" };
  const result = resolveEntityCandidates("Starbucks", [place, brand], { category: "brand" });
  assert.equal(result.status, "resolved");
  assert.equal(result.entity?.id, brand.id);
  assert.equal(result.entity?.category, "brand");
});

test("preserves ambiguity for multiple equally valid brand candidates", () => {
  const first = { ...source, id: "brand:one", name: "Starbucks", metadata: { popularity: 0.2 } };
  const second = { ...source, id: "brand:two", name: "Starbucks", metadata: { popularity: 0.99 } };
  const result = resolveEntityCandidates("Starbucks", [first, second], { category: "brand" });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.entity, undefined);
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), [first.id, second.id]);
});

test("does not select a non-exact or popularity-ranked fallback", () => {
  const result = resolveEntityCandidates("Starbucks", [{ ...source, id: "brand:reserve", name: "Starbucks Reserve", metadata: { popularity: 1 } }], { category: "brand" });
  assert.equal(result.status, "not-found");
  assert.equal(result.entity, undefined);
});

test("resolves an explicitly selected provider entity only when identity and category match", () => {
  const selected = { ...source, id: "brand:selected", name: "Starbucks - London" };
  const result = resolveEntityCandidates("Starbucks", [selected], { category: "brand", selectedEntityId: selected.id });
  assert.equal(result.status, "resolved");
  assert.equal(result.entity?.id, selected.id);
  assert.equal(result.entity?.category, "brand");
  const wrongCategory = resolveEntityCandidates("Starbucks", [{ ...target, id: selected.id, name: selected.name }], { category: "brand", selectedEntityId: selected.id });
  assert.equal(wrongCategory.status, "not-found");
});

test("returns no-match rather than inventing a fallback identity", () => {
  const result = resolveEntityCandidates("Starbucks", [{ ...source, id: "brand:other", name: "Other Brand" }], { category: "brand" });
  assert.equal(result.status, "not-found");
  assert.equal(result.entity, undefined);
});
