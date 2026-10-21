import assert from "node:assert/strict";
import { test } from "node:test";
import { CulturalEntitySchema } from "@/core/entities/types";
import { AffinityEvidenceSchema } from "@/core/evidence/types";
import { ProviderRegistry } from "@/providers/registry";
import { QlooProvider, normalizeQlooEntities, QlooHttpClient } from "@/providers/qloo/adapter";
import { qlooConfigFromEnvironment, type QlooConfig } from "@/providers/qloo/config";

const config: QlooConfig = {
  apiKey: "test-only-key",
  baseUrl: "https://hackathon.api.qloo.com",
  searchPath: "/search",
  insightsPath: "/v2/insights",
  timeoutMs: 100,
};

function providerWithResponse(response: Response, capture?: (url: string, init: RequestInit) => void): QlooProvider {
  return new QlooProvider(config, async (url, init) => {
    capture?.(url, init);
    return response;
  }, () => "2026-01-01T00:00:00.000Z");
}

test("domain schemas require identity, scores, query parameters, and provenance", () => {
  assert.equal(CulturalEntitySchema.safeParse({ name: "missing id" }).success, false);
  const evidence = AffinityEvidenceSchema.parse({
    kind: "affinity",
    id: "qloo:insights:a:b",
    subjectEntityId: "a",
    subjectEntityCategory: "brand",
    objectEntityId: "b",
    objectEntityCategory: "place",
    providerScore: 0.82,
    queryParameters: { "filter.type": "urn:entity:place" },
    provenance: {
      providerId: "qloo",
      sourceReference: "qloo:insights:a:b",
      retrievedAt: "2026-01-01T00:00:00.000Z",
    },
  });
  assert.equal(evidence.provenance.providerId, "qloo");
  assert.equal(evidence.providerScore, 0.82);
});

test("provider registry exposes registered providers and rejects duplicates", () => {
  const provider = providerWithResponse(new Response(JSON.stringify({ entities: [] }), { status: 200 }));
  const registry = new ProviderRegistry();
  registry.register(provider);
  assert.equal(registry.get("qloo"), provider);
  assert.throws(() => registry.register(provider), /already registered/);
});

test("entity search uses X-Api-Key and normalizes verified Qloo fields", async () => {
  let requestedUrl = "";
  let requestedHeaders: Headers;
  const provider = providerWithResponse(
    new Response(JSON.stringify({ entities: [{
      entity_id: "qloo:place:1",
      name: "Fixture Place",
      types: ["urn:entity:place"],
      properties: { geocode: { country_code: "NG", name: "Lagos" } },
      popularity: 0.71,
      tags: ["urn:tag:food"],
    }] }), { status: 200 }),
    (url, init) => {
      requestedUrl = url;
      requestedHeaders = new Headers(init.headers);
    },
  );
  const result = await provider.searchEntities({
    query: "Fixture Place",
    category: "place",
    limit: 5,
    geography: { latitude: 6.5244, longitude: 3.3792 },
  });
  assert.equal(result.ok, true);
  assert.equal(requestedHeaders!.get("X-Api-Key"), "test-only-key");
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("query"), "Fixture Place");
  assert.equal(url.searchParams.get("types"), "urn:entity:place");
  assert.equal(url.searchParams.get("filter.location"), "6.5244,3.3792");
  if (result.ok) {
    assert.equal(result.data[0].id, "qloo:place:1");
    assert.equal(result.data[0].category, "place");
    assert.equal(result.data[0].geographicContext?.city, "Lagos");
    assert.equal(result.data[0].metadata.popularity, 0.71);
  }
});

test("entity-based affinity preserves scores, explainability, geography, and query parameters", async () => {
  let requestedUrl = "";
  const provider = providerWithResponse(
    new Response(JSON.stringify({
      success: true,
      results: { entities: [{
        entity_id: "qloo:place:1",
        name: "Fixture Place",
        query: {
          affinity: 0.82,
          explainability: { "signal.interests.entities": [{ entity_id: "seed-1", score: 1 }] },
        },
      }] },
      query: { explainability: { warning: null } },
    }), { status: 200 }),
    (url) => { requestedUrl = url; },
  );
  const result = await provider.discoverAffinity({
    entityId: "seed-1",
    sourceEntityCategory: "brand",
    sourceEntityName: "Starbucks",
    targetType: "urn:entity:place",
    locationQuery: "London",
    geography: { city: "London" },
    limit: 20,
    explainability: true,
  });
  assert.equal(result.ok, true);
  const url = new URL(requestedUrl);
  assert.equal(url.pathname, "/v2/insights");
  assert.equal(url.searchParams.get("filter.type"), "urn:entity:place");
  assert.equal(url.searchParams.get("filter.location.query"), "London");
  assert.equal(url.searchParams.get("signal.interests.entities"), "seed-1");
  assert.equal(url.searchParams.get("feature.explainability"), "true");
  if (result.ok) {
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].providerScore, 0.82);
    assert.equal(result.data[0].subjectEntityCategory, "brand");
    assert.equal(result.data[0].subjectEntityName, "Starbucks");
    assert.equal(result.data[0].objectEntityCategory, "place");
    assert.equal(result.data[0].objectEntityName, "Fixture Place");
    assert.deepEqual(result.data[0].explainability, {
      "signal.interests.entities": [{ entity_id: "seed-1", score: 1 }],
    });
    assert.equal(result.data[0].geographicContext?.city, "London");
    assert.equal(result.data[0].queryParameters["sort_by"], "affinity");
    assert.equal(result.data[0].provenance.sourceReference, "qloo:insights:seed-1:qloo:place:1");
  }
});

test("malformed insight entities without actual affinity scores are discarded", async () => {
  const provider = providerWithResponse(new Response(JSON.stringify({ results: { entities: [
    { entity_id: "missing-score", name: "No Score", popularity: 0.99 },
    { entity_id: "bad-score", name: "Bad Score", query: { affinity: "high" } },
  ] }, query: {} , success: true }), { status: 200 }));
  const result = await provider.discoverAffinity({ entityId: "seed-1", sourceEntityCategory: "brand", targetType: "urn:entity:brand" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.length, 0);
});

test("malformed JSON is reported as an invalid provider response", async () => {
  const provider = providerWithResponse(new Response("{not-json", { status: 200 }));
  const result = await provider.searchEntities({ query: "malformed" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "INVALID_RESPONSE");
});

test("HTTP errors are returned as structured provider errors", async () => {
  const unauthorized = await providerWithResponse(new Response("", { status: 401 })).searchEntities({ query: "x" });
  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) assert.equal(unauthorized.error.code, "AUTHENTICATION_ERROR");

  const rateLimited = await providerWithResponse(new Response("", { status: 429, headers: { "retry-after": "3" } })).searchEntities({ query: "x" });
  assert.equal(rateLimited.ok, false);
  if (!rateLimited.ok) {
    assert.equal(rateLimited.error.code, "RATE_LIMITED");
    assert.equal(rateLimited.error.retryAfterMs, 3000);
  }

  const upstream = await providerWithResponse(new Response("", { status: 500 })).searchEntities({ query: "x" });
  assert.equal(upstream.ok, false);
  if (!upstream.ok) assert.equal(upstream.error.code, "UPSTREAM_ERROR");
});

test("request timeouts are surfaced without exposing headers", async () => {
  const http = new QlooHttpClient(() => new Promise<Response>(() => undefined), 5);
  const provider = new QlooProvider(config, http);
  const result = await provider.searchEntities({ query: "slow" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "TIMEOUT");
});

test("accepts a response slower than the legacy 10-second timeout when configured longer", async () => {
  const http = new QlooHttpClient(
    () => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response(JSON.stringify({ entities: [] }), { status: 200 })), 13)),
    25,
    2,
    0,
    60,
  );
  const provider = new QlooProvider({ ...config, timeoutMs: 25, overallTimeoutMs: 60 }, http);
  const result = await provider.searchEntities({ query: "slow-but-valid" });
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics?.[0]?.attempts, 1);
});

test("enforces the overall Qloo deadline and does not retry beyond the attempt budget", async () => {
  let requests = 0;
  const http = new QlooHttpClient(
    () => {
      requests += 1;
      return new Promise<Response>(() => undefined);
    },
    10,
    2,
    0,
    40,
  );
  const provider = new QlooProvider({ ...config, timeoutMs: 10, overallTimeoutMs: 40 }, http);
  const result = await provider.searchEntities({ query: "deadline" });
  assert.equal(result.ok, false);
  assert.equal(requests, 2);
  if (!result.ok) assert.equal(result.error.code, "TIMEOUT");
  assert.equal(result.diagnostics?.[0]?.attempts, 2);
});

test("keeps existing Qloo environment names compatible while applying safe defaults", () => {
  const parsed = qlooConfigFromEnvironment({ QLOO_API_KEY: "test-key", QLOO_TIMEOUT_MS: "25000" });
  assert.equal(parsed.timeoutMs, 25_000);
  assert.equal(parsed.overallTimeoutMs, 60_000);
  assert.equal(parsed.maxAttempts, undefined);
  assert.throws(() => qlooConfigFromEnvironment({ QLOO_API_KEY: "test-key", QLOO_TIMEOUT_MS: "0" }), /expected number to be >0/);
  assert.throws(() => qlooConfigFromEnvironment({ QLOO_API_KEY: "test-key", QLOO_TIMEOUT_MS: "25000", QLOO_OVERALL_TIMEOUT_MS: "10000" }), /at least the per-request timeout/);
});

test("retries transient Qloo responses and returns sanitized diagnostics", async () => {
  let requests = 0;
  const provider = new QlooProvider({ ...config, retryBaseDelayMs: 0 }, async () => {
    requests += 1;
    return requests === 1
      ? new Response("", { status: 503 })
      : new Response(JSON.stringify({ entities: [] }), { status: 200 });
  });
  const result = await provider.searchEntities({ query: "retryable" });
  assert.equal(result.ok, true);
  assert.equal(requests, 2);
  assert.equal(result.diagnostics?.length, 1);
  assert.deepEqual(result.diagnostics?.[0], {
    providerId: "qloo",
    operation: "entity-search",
    outcome: "success",
    status: 200,
    attempts: 2,
    retryCount: 1,
    durationMs: result.diagnostics?.[0]?.durationMs,
    timeoutMs: 100,
  });
  assert.equal("url" in (result.diagnostics?.[0] ?? {}), false);
});

test("unsupported insight target types are rejected before making a request", async () => {
  let requests = 0;
  const provider = new QlooProvider(config, async () => {
    requests += 1;
    return new Response(JSON.stringify({}), { status: 200 });
  });
  const result = await provider.discoverAffinity({ entityId: "seed-1", sourceEntityCategory: "brand", targetType: "urn:audience:unknown" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "CONFIGURATION_ERROR");
  assert.equal(requests, 0);
});

test("explainability remains explicit when requested as a standalone unsupported operation", async () => {
  const provider = providerWithResponse(new Response(JSON.stringify({}), { status: 200 }));
  assert.equal(provider.getCapabilities().affinityDiscovery, true);
  assert.equal(provider.getCapabilities().explainability, false);
  const result = await provider.explainEvidence({ evidenceId: "qloo:evidence:1" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "UNSUPPORTED_CAPABILITY");
});

test("entity normalization discards unidentified records without inventing values", () => {
  const entities = normalizeQlooEntities({ entities: [
    { entity_id: "qloo:1", name: "Fixture Artist", types: ["urn:entity:artist"] },
    { name: "Invalid" },
  ] }, "2026-01-01T00:00:00.000Z");
  assert.equal(entities.length, 1);
  assert.equal(entities[0].category, "person");
  assert.equal("score" in entities[0], false);
});
