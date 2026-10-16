import assert from "node:assert/strict";
import test from "node:test";
import type { CulturalEntity } from "@/core/entities/types";
import type { CulturalEvidence } from "@/core/evidence/types";
import type { CulturalIntelligenceProvider, ProviderCapabilities, ProviderResult } from "@/providers/interfaces/contracts";
import { DecisionEngine } from "@/agent/engine";
import { resolveEntityCandidates } from "@/agent/planning";
import { blueprintStructuralIssues, blueprintValidationPaths, diagnoseBlueprintEvidence, parseBlueprintModelOutput, type BlueprintModelInput, type ModelResult, type StructuredModelProvider } from "@/agent/model";
import { buildGeminiPrompt, compactEvidenceForPrompt, GEMINI_BLUEPRINT_RESPONSE_SCHEMA, GeminiModelProvider } from "@/providers/gemini/adapter";
import { buildGeminiGenerateContentEndpoint, geminiConfigFromEnvironment } from "@/providers/gemini/config";
import { qlooConfigFromEnvironment } from "@/providers/qloo/config";

const capabilities: ProviderCapabilities = { entitySearch: true, affinityDiscovery: true, geographicFiltering: true, affinityExplainability: true, explainability: false };

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
  calls: { search: string[]; affinity: string[]; explainability: boolean[] } = { search: [], affinity: [], explainability: [] };
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
  async discoverAffinity(request: { entityId: string; targetType: string; locationQuery?: string; explainability?: boolean }): Promise<ProviderResult<CulturalEvidence[]>> {
    this.calls.affinity.push(`${request.entityId}|${request.targetType}|${request.locationQuery ?? ""}`);
    this.calls.explainability.push(Boolean(request.explainability));
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
  assert.deepEqual(result.evidence[0]?.explainability, evidence.explainability);
  assert.deepEqual(result.graph.edges[0]?.explainability, evidence.explainability);
  assert.deepEqual(provider.calls.explainability, [true]);
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

const validBlueprintJson = JSON.stringify({
  who: { claims: [] }, where: { claims: [] }, withWhat: { claims: [] },
  alongsideWhom: { claims: [] }, why: { claims: [] }, caveats: [],
});

test("constructs the configured Gemini generateContent endpoint without a hardcoded model", () => {
  const config = geminiConfigFromEnvironment({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "models/gemini-configured" } as unknown as NodeJS.ProcessEnv);
  assert.equal(config?.model, "gemini-configured");
  assert.equal(config?.endpoint, "https://generativelanguage.googleapis.com/v1beta/models/gemini-configured:generateContent");
  assert.equal(buildGeminiGenerateContentEndpoint("https://example.test/v1beta/", "models/custom-model"), "https://example.test/v1beta/models/custom-model:generateContent");
});

test("sends the documented Gemini request shape and preserves valid structured output", async () => {
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;
  const provider = new GeminiModelProvider({ apiKey: "test-key", model: "custom-model", endpoint: "https://example.test/v1beta/models/custom-model:generateContent", timeoutMs: 1000 }, async (url, init) => {
    requestedUrl = url;
    requestedHeaders = new Headers(init.headers);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: validBlueprintJson }] } }] }), { status: 200 });
  });
  const result = await provider.generateBlueprint({ productConcept: "coffee", evidence: [] });
  assert.equal(result.ok, true);
  assert.equal(requestedUrl, "https://example.test/v1beta/models/custom-model:generateContent");
  assert.equal(requestedHeaders?.get("x-goog-api-key"), "test-key");
  assert.equal(requestedHeaders?.get("content-type"), "application/json");
});

test("sends a Gemini response schema matching the complete Mosaic blueprint contract", async () => {
  const provider = new GeminiModelProvider({ apiKey: "test-key", model: "custom-model", endpoint: "https://example.test/generate", timeoutMs: 1000 }, async (_url, init) => {
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body.generationConfig.responseSchema.required, ["who", "where", "withWhat", "alongsideWhom", "why", "caveats"]);
    assert.equal(body.generationConfig.responseSchema.type, "OBJECT");
    assert.deepEqual(body.generationConfig.responseSchema.properties.where.required, ["claims"]);
    assert.equal(body.generationConfig.responseSchema.properties.where.properties.claims.type, "ARRAY");
    assert.deepEqual(body.generationConfig.responseSchema.properties.where.properties.claims.items.required, ["text", "classification", "evidenceIds"]);
    assert.equal(body.generationConfig.responseSchema.properties.where.properties.claims.items.properties.evidenceIds.type, "ARRAY");
    assert.equal(body.generationConfig.responseSchema.properties.where.properties.claims.items.properties.evidenceIds.items.type, "STRING");
    assert.deepEqual(body.generationConfig.responseSchema.properties.where.properties.claims.items.properties.classification.enum, ["verified-observation", "interpretation", "unverified-suggestion"]);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: validBlueprintJson }] } }] }), { status: 200 });
  });
  const result = await provider.generateBlueprint({ productConcept: "coffee", evidence: [] });
  assert.equal(result.ok, true);
  assert.equal(GEMINI_BLUEPRINT_RESPONSE_SCHEMA.type, "OBJECT");
});

test("reports precise blueprint validation paths for missing sections and invalid claims", () => {
  const valid = JSON.parse(validBlueprintJson) as Record<string, unknown>;
  assert.deepEqual(blueprintValidationPaths({ ...valid, where: {} }), ["where.claims"]);
  assert.deepEqual(blueprintValidationPaths({ ...valid, who: { claims: [{ text: "claim", classification: "unsupported", evidenceIds: ["evidence:1"] }] } }), ["who.claims[0].classification"]);
  assert.deepEqual(blueprintValidationPaths({ ...valid, who: { claims: [{ text: "claim", classification: "interpretation" }] } }), ["who.claims[0].evidenceIds"]);
  assert.equal(parseBlueprintModelOutput(valid).ok, true);
});

test("accepts exact evidence identifiers from the corresponding research set", () => {
  const valid = JSON.parse(validBlueprintJson);
  const blueprint = {
    ...valid,
    who: { claims: [{ text: "The provider reported this association.", classification: "verified-observation", evidenceIds: [evidence.id], subjectEntityId: evidence.subjectEntityId, objectEntityId: evidence.objectEntityId }] },
  };
  const diagnostics = diagnoseBlueprintEvidence(blueprint, [evidence]);
  assert.deepEqual(diagnostics, { structuralPaths: [], unknownEvidencePaths: [], unsupportedVerifiedClaimPaths: [] });
});

test("distinguishes invented, missing, empty, and invalid evidence references", () => {
  const valid = JSON.parse(validBlueprintJson);
  const invented = { ...valid, who: { claims: [{ text: "Claim", classification: "interpretation", evidenceIds: ["invented:evidence"] }] } };
  assert.deepEqual(diagnoseBlueprintEvidence(invented, [evidence]).unknownEvidencePaths, ["who.claims[0].evidenceIds[0]"]);
  const missing = { ...valid, where: { claims: [{ text: "Claim", classification: "interpretation" }] } };
  assert.deepEqual(diagnoseBlueprintEvidence(missing, [evidence]).structuralPaths, ["where.claims[0].evidenceIds"]);
  const empty = { ...valid, withWhat: { claims: [{ text: "Suggestion", classification: "unverified-suggestion", evidenceIds: [] }] } };
  assert.deepEqual(diagnoseBlueprintEvidence(empty, [evidence]), { structuralPaths: [], unknownEvidencePaths: [], unsupportedVerifiedClaimPaths: [] });
  const invalidType = { ...valid, why: { claims: [{ text: "Claim", classification: "interpretation", evidenceIds: [123] }] } };
  assert.deepEqual(diagnoseBlueprintEvidence(invalidType, [evidence]).structuralPaths, ["why.claims[0].evidenceIds[0]"]);
});

test("reports sanitized evidenceIds value-shape diagnostics", () => {
  const valid = JSON.parse(validBlueprintJson);
  const cases = [
    [{ ...valid, who: { claims: [{ text: "x", classification: "interpretation" }] } }, "who.claims[0].evidenceIds", "missing"],
    [{ ...valid, who: { claims: [{ text: "x", classification: "interpretation", evidenceIds: null }] } }, "who.claims[0].evidenceIds", "null"],
    [{ ...valid, who: { claims: [{ text: "x", classification: "interpretation", evidenceIds: "evidence:1" }] } }, "who.claims[0].evidenceIds", "expected-array"],
    [{ ...valid, who: { claims: [{ text: "x", classification: "interpretation", evidenceIds: ["evidence:1", 3] }] } }, "who.claims[0].evidenceIds[1]", "non-string-item"],
  ] as const;
  for (const [input, path, issue] of cases) {
    assert.ok(blueprintStructuralIssues(input).some((item) => item.path === path && item.issue === issue));
  }
  assert.ok(blueprintStructuralIssues({ ...valid, where: { claims: "not-an-array" } }).some((item) => item.path === "where.claims" && item.issue === "expected-array"));
  assert.ok(blueprintStructuralIssues({ ...valid, withWhat: "not-an-object" }).some((item) => item.path === "withWhat" && item.issue === "expected-object"));
});

test("does not allow evidence from another analysis or unrelated verified claims", () => {
  const valid = JSON.parse(validBlueprintJson);
  const unrelatedEvidence = { ...evidence, id: "other-analysis:evidence" };
  const unrelatedReference = { ...valid, who: { claims: [{ text: "Claim", classification: "interpretation", evidenceIds: [unrelatedEvidence.id] }] } };
  assert.deepEqual(diagnoseBlueprintEvidence(unrelatedReference, [evidence]).unknownEvidencePaths, ["who.claims[0].evidenceIds[0]"]);
  const unsupportedVerified = { ...valid, where: { claims: [{ text: "Unsupported", classification: "verified-observation", evidenceIds: [evidence.id], subjectEntityId: "wrong:source", objectEntityId: evidence.objectEntityId }] } };
  assert.deepEqual(diagnoseBlueprintEvidence(unsupportedVerified, [evidence]).unsupportedVerifiedClaimPaths, ["where.claims[0].classification"]);
  const interpretation = { ...valid, why: { claims: [{ text: "Hypothesis", classification: "interpretation", evidenceIds: [] }] } };
  assert.deepEqual(diagnoseBlueprintEvidence(interpretation, [evidence]).unsupportedVerifiedClaimPaths, []);
});

test("accepts required empty claims arrays but rejects incomplete blueprint sections", () => {
  const valid = JSON.parse(validBlueprintJson);
  assert.equal(parseBlueprintModelOutput(valid).ok, true);
  assert.equal(parseBlueprintModelOutput({ ...valid, alongsideWhom: {} }).ok, false);
});

test("classifies Gemini model-not-found responses separately from invalid output", async () => {
  const provider = new GeminiModelProvider({ apiKey: "test-key", model: "missing-model", endpoint: "https://example.test/v1beta/models/missing-model:generateContent", timeoutMs: 1000 }, async () => new Response("", { status: 404 }));
  const result = await provider.generateBlueprint({ productConcept: "coffee", evidence: [] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "MODEL_NOT_FOUND");
});

test("classifies malformed Gemini structured output as invalid output", async () => {
  const provider = new GeminiModelProvider({ apiKey: "test-key", model: "custom-model", endpoint: "https://example.test/v1beta/models/custom-model:generateContent", timeoutMs: 1000 }, async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not-json" }] } }] }), { status: 200 }));
  const result = await provider.generateBlueprint({ productConcept: "coffee", evidence: [] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "MODEL_INVALID_OUTPUT");
});

test("compacts model evidence without changing identities, scores or explainability", () => {
  const compact = compactEvidenceForPrompt([evidence]);
  assert.deepEqual(compact[0], {
    evidenceId: evidence.id,
    providerId: "qloo",
    source: { id: source.id, category: "brand", name: source.name },
    target: { id: target.id, category: "place", name: target.name },
    providerScore: 0.81,
    providerScoreLabel: "affinity",
    providerScoreScale: "qloo:affinity",
    explainability: evidence.explainability,
    geography: evidence.geographicContext,
    queryParameters: evidence.queryParameters,
    retrievedAt: evidence.provenance.retrievedAt,
    sourceReference: evidence.provenance.sourceReference,
  });
  assert.ok(!buildGeminiPrompt({ productConcept: "coffee", evidence: [evidence] }).includes("metadata"));
});

test("retries transient Gemini upstream responses within the configured attempt limit", async () => {
  let calls = 0;
  const provider = new GeminiModelProvider({ apiKey: "test-key", model: "custom-model", endpoint: "https://example.test/generate", timeoutMs: 1000, overallTimeoutMs: 5000, maxAttempts: 2, retryBaseDelayMs: 0 }, async () => {
    calls += 1;
    return new Response("", { status: 503 });
  }, async () => undefined);
  const result = await provider.generateBlueprint({ productConcept: "coffee", evidence: [] });
  assert.equal(calls, 2);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "MODEL_UPSTREAM_ERROR");
    assert.equal(result.error.status, 503);
  }
});

test("does not retry non-transient model configuration failures", async () => {
  let calls = 0;
  const provider = new GeminiModelProvider({ apiKey: "test-key", model: "missing-model", endpoint: "https://example.test/generate", timeoutMs: 1000, maxAttempts: 3 }, async () => {
    calls += 1;
    return new Response("", { status: 404 });
  }, async () => undefined);
  const result = await provider.generateBlueprint({ productConcept: "coffee", evidence: [] });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "MODEL_NOT_FOUND");
});

test("classifies an adapter timeout separately from invalid model output", async () => {
  const provider = new GeminiModelProvider({ apiKey: "test-key", model: "custom-model", endpoint: "https://example.test/generate", timeoutMs: 1000 }, async () => {
    const cause = new Error("aborted");
    cause.name = "AbortError";
    throw cause;
  });
  const result = await provider.generateDiagnostic("Return JSON", "application/json");
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "MODEL_TIMEOUT");
});

test("supports minimal structured output through the diagnostic adapter path", async () => {
  const provider = new GeminiModelProvider({ apiKey: "test-key", model: "custom-model", endpoint: "https://example.test/generate", timeoutMs: 1000 }, async (_url, init) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 });
  });
  const result = await provider.generateDiagnostic("Return {ok:true}", "application/json");
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.text ?? ""), { ok: true });
});

test("forwards the configured documented thinking level without inventing minimal support", async () => {
  const provider = new GeminiModelProvider({ apiKey: "test-key", model: "gemini-3.8-flash", endpoint: "https://example.test/generate", timeoutMs: 1000, thinkingLevel: "low" }, async (_url, init) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: "low" });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: validBlueprintJson }] } }] }), { status: 200 });
  });
  const result = await provider.generateBlueprint({ productConcept: "coffee", evidence: [] });
  assert.equal(result.ok, true);
});

test("recovers once from a transient 503 and returns the validated blueprint", async () => {
  let calls = 0;
  const provider = new GeminiModelProvider({ apiKey: "test-key", model: "custom-model", endpoint: "https://example.test/generate", timeoutMs: 1000, maxAttempts: 2, retryBaseDelayMs: 0 }, async () => {
    calls += 1;
    return calls === 1
      ? new Response("", { status: 503 })
      : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: validBlueprintJson }] } }] }), { status: 200 });
  }, async () => undefined);
  const result = await provider.generateBlueprint({ productConcept: "coffee", evidence: [] });
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
});

test("retries a transient timeout only within the bounded attempt budget", async () => {
  let calls = 0;
  const provider = new GeminiModelProvider({ apiKey: "test-key", model: "custom-model", endpoint: "https://example.test/generate", timeoutMs: 1000, overallTimeoutMs: 5000, maxAttempts: 2, retryBaseDelayMs: 0 }, async () => {
    calls += 1;
    if (calls === 1) {
      const cause = new Error("aborted");
      cause.name = "AbortError";
      throw cause;
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: validBlueprintJson }] } }] }), { status: 200 });
  }, async () => undefined);
  const result = await provider.generateBlueprint({ productConcept: "coffee", evidence: [] });
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
});

test("enforces the overall deadline and does not retry indefinitely", async () => {
  let calls = 0;
  const provider = new GeminiModelProvider({ apiKey: "test-key", model: "custom-model", endpoint: "https://example.test/generate", timeoutMs: 5, overallTimeoutMs: 5, maxAttempts: 10, retryBaseDelayMs: 10 }, async () => {
    calls += 1;
    const cause = new Error("aborted");
    cause.name = "AbortError";
    throw cause;
  }, async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const result = await provider.generateBlueprint({ productConcept: "coffee", evidence: [] });
  assert.ok(calls <= 2);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "MODEL_TIMEOUT");
});

test("classifies an empty successful response as invalid model output", async () => {
  const provider = new GeminiModelProvider({ apiKey: "test-key", model: "custom-model", endpoint: "https://example.test/generate", timeoutMs: 1000 }, async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
  const result = await provider.generateBlueprint({ productConcept: "coffee", evidence: [] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "MODEL_INVALID_OUTPUT");
});

test("classifies malformed JSON in a successful Gemini response as invalid output", async () => {
  const provider = new GeminiModelProvider({ apiKey: "test-key", model: "custom-model", endpoint: "https://example.test/generate", timeoutMs: 1000 }, async () => new Response("{not-json", { status: 200 }));
  const result = await provider.generateBlueprint({ productConcept: "coffee", evidence: [] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "MODEL_INVALID_OUTPUT");
});
