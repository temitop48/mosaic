import assert from "node:assert/strict";
import { test } from "node:test";
import { CulturalEntitySchema } from "@/core/entities/types";
import { AffinityEvidenceSchema } from "@/core/evidence/types";
import { ProviderRegistry } from "@/providers/registry";
import { QlooProvider, normalizeQlooEntities } from "@/providers/qloo/adapter";
import type { QlooConfig } from "@/providers/qloo/config";

const config: QlooConfig = {
  apiKey: "test-only-key",
  baseUrl: "https://hackathon.api.qloo.com",
  searchPath: "/search",
  affinityPath: "/affinity",
};

test("domain schemas require identity and provenance", () => {
  assert.equal(CulturalEntitySchema.safeParse({ name: "missing id" }).success, false);
  const evidence = AffinityEvidenceSchema.parse({
    kind: "affinity",
    subjectEntityId: "a",
    objectEntityId: "b",
    provenance: {
      providerId: "qloo",
      sourceReference: "qloo:fixture:1",
      retrievedAt: "2026-01-01T00:00:00.000Z",
    },
  });
  assert.equal(evidence.provenance.providerId, "qloo");
  assert.equal(evidence.provenance.sourceReference, "qloo:fixture:1");
});

test("provider registry exposes registered providers", () => {
  const provider = new QlooProvider(config, async () =>
    new Response(JSON.stringify({ results: [] }), { status: 200 }),
  );
  const registry = new ProviderRegistry();
  registry.register(provider);
  assert.equal(registry.get("qloo"), provider);
  assert.deepEqual(registry.list().map((item) => item.id), ["qloo"]);
});

test("unsupported capability is explicit and no request is made", async () => {
  let requests = 0;
  const provider = new QlooProvider(config, async () => {
    requests += 1;
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  });
  assert.equal(provider.getCapabilities().explainability, false);
  const result = await provider.explainEvidence({ evidenceId: "qloo:evidence:1" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "UNSUPPORTED_CAPABILITY");
  assert.equal(requests, 0);
});

test("unverified Qloo affinity is explicit and no request is made", async () => {
  let requests = 0;
  const provider = new QlooProvider(config, async () => {
    requests += 1;
    return new Response(JSON.stringify({ affinities: [] }), { status: 200 });
  });
  assert.equal(provider.getCapabilities().affinityDiscovery, false);
  const result = await provider.discoverAffinity({ entityId: "qloo:1" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "UNSUPPORTED_CAPABILITY");
  assert.equal(requests, 0);
});

test("Qloo search forwards supported filters and preserves provenance", async () => {
  let requestedUrl = "";
  const provider = new QlooProvider(
    config,
    async (url, init) => {
      requestedUrl = url;
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-only-key");
      return new Response(JSON.stringify({ results: [{ id: "qloo:1", name: "Fixture Place" }] }), {
        status: 200,
      });
    },
    () => "2026-01-01T00:00:00.000Z",
  );
  const result = await provider.searchEntities({
    query: "Fixture Place",
    category: "place",
    limit: 5,
    geography: {
      countryCode: "NG",
      region: "Lagos",
      city: "Lagos",
      latitude: 6.5244,
      longitude: 3.3792,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(new URL(requestedUrl).searchParams.get("country_code"), "NG");
  assert.equal(new URL(requestedUrl).searchParams.get("latitude"), "6.5244");
  if (result.ok) {
    assert.equal(result.data[0].sourceReference, "qloo:entity:qloo:1");
    assert.equal(result.data[0].metadata.normalizedAt, "2026-01-01T00:00:00.000Z");
  }
});

test("clearly labeled Qloo fixture normalizes without inventing scores", () => {
  const entities = normalizeQlooEntities(
    {
      results: [
        { id: "qloo:1", name: "Fixture Artist", category: "artist", source: "fixture:qloo:1" },
        { id: "qloo:2", name: "Fixture Place", category: "place", location: { city: "Lagos" } },
        { id: 3, name: "Invalid" },
      ],
    },
    "2026-01-01T00:00:00.000Z",
  );
  assert.equal(entities.length, 2);
  assert.equal(entities[0].category, "unknown");
  assert.equal(entities[1].sourceReference, "qloo:entity:qloo:2");
  assert.equal("score" in entities[0], false);
});
