import assert from "node:assert/strict";
import test from "node:test";
import { DecisionEngine } from "@/agent/engine";
import { AgentResearchConfigSchema, buildAgentAuthorization, compatibleEntityIdentity, integrateBoundedAgentResearch } from "@/agent/decision/integration";
import type { AgentAuthorization } from "@/agent/decision/contracts";
import type { CulturalEntity } from "@/core/entities/types";
import type { AffinityEvidence } from "@/core/evidence/types";
import type { CulturalIntelligenceProvider } from "@/providers/interfaces/contracts";

const subject: CulturalEntity = { id: "qloo:brand:adidas", providerId: "qloo", name: "Adidas", category: "brand", sourceReference: "qloo:entity:adidas", metadata: {} };

function evidence(targetType: "brand" | "place", market: string, target: string): AffinityEvidence {
  return { kind: "affinity", id: `qloo:${targetType}:${market}:${target}`, subjectEntityId: subject.id, subjectEntityCategory: "brand", subjectEntityName: subject.name, objectEntityId: `qloo:${targetType}:${target}`, objectEntityCategory: targetType, objectEntityName: target, providerScore: 0.8, providerScoreScale: "qloo:affinity", queryParameters: { "filter.type": `urn:entity:${targetType}`, [targetType === "brand" ? "signal.location.query" : "filter.location.query"]: market, sort_by: "affinity" }, provenance: { providerId: "qloo", sourceReference: `qloo:insight:${market}:${target}`, retrievedAt: "2026-01-01T00:00:00.000Z" }, verified: true };
}

function provider(calls: Array<{ target: string; market: string }>): CulturalIntelligenceProvider {
  return {
    id: "qloo",
    getCapabilities: () => ({ entitySearch: true, affinityDiscovery: true, geographicFiltering: true, affinityExplainability: true, explainability: false }),
    searchEntities: async () => ({ ok: true, data: [subject] }),
    discoverAffinity: async (request) => {
      calls.push({ target: request.targetType, market: request.locationQuery ?? "" });
      const target = request.targetType === "urn:entity:place" ? `${request.locationQuery} Venue` : `${request.locationQuery} Brand`;
      return { ok: true, data: [evidence(request.targetType.endsWith(":place") ? "place" : "brand", request.locationQuery ?? "", target)] };
    },
    explainEvidence: async () => ({ ok: false, error: { code: "UNSUPPORTED_CAPABILITY", providerId: "qloo", message: "unsupported" } }),
  };
}

async function initialResearch(engine: DecisionEngine, targetTypes = ["urn:entity:brand"], seedCategory: "brand" | undefined = "brand") {
  const scenario = {
    productConcept: "Athletic brand",
    seedQueries: ["Adidas"],
    ...(seedCategory ? { seedCategory } : {}),
    seedEntityId: subject.id,
    targetTypes,
  };
  const [lagos, newYork] = await Promise.all([
    engine.research({ ...scenario, launchLocation: "Lagos" }),
    engine.research({ ...scenario, launchLocation: "New York" }),
  ]);
  return [{ market: "Lagos", result: lagos }, { market: "New York", result: newYork }];
}

function authorization(requestedTargetType?: string): AgentAuthorization {
  return {
    initialTargetType: "urn:entity:brand",
    allowedTargetTypes: ["urn:entity:brand", "urn:entity:place"],
    markets: ["Lagos", "New York"],
    objective: { kind: "geographic-cultural-comparison", requestedOutcome: "Compare cultural evidence", markets: ["Lagos", "New York"], allowedTargetTypes: ["urn:entity:brand", "urn:entity:place"], requestedTargetType },
  };
}

test("captures trusted initial operation usage and completed request descriptors", async () => {
  const calls: Array<{ target: string; market: string }> = [];
  const engine = new DecisionEngine(provider(calls), undefined, () => "analysis-id");
  const researches = await initialResearch(engine);
  const metadata = engine.getTrustedResearchMetadata(researches[0].result);
  assert.equal(metadata?.logicalOperationCount, 2);
  assert.equal(metadata?.completedRequests.length, 1);
  assert.equal(metadata?.completedRequests[0]?.subjectEntityId, subject.id);
  assert.equal(metadata?.completedRequests[0]?.market, "Lagos");
  assert.equal(metadata?.completedRequests[0]?.geographicStrategy, "signal.location.query");
  assert.equal(metadata?.resolvedSubjects[0]?.id, subject.id);
});

test("authorization alone does not trigger an additional query", async () => {
  const calls: Array<{ target: string; market: string }> = [];
  const engine = new DecisionEngine(provider(calls));
  const researches = await initialResearch(engine);
  const initialCallCount = calls.length;
  const result = await integrateBoundedAgentResearch({ engine, provider: provider(calls), authorization: authorization(), researches, deadlineAtMs: Date.now() + 120_000 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.execution.status, "stopped");
  assert.equal(calls.length, initialCallCount);
  assert.equal(result.execution.trace.budget.logicalOperationsUsed, 4);
});

test("explicitly requested authorized dimension executes with market isolation", async () => {
  const initialCalls: Array<{ target: string; market: string }> = [];
  const engine = new DecisionEngine(provider(initialCalls));
  const researches = await initialResearch(engine);
  const followUpCalls: Array<{ target: string; market: string }> = [];
  const result = await integrateBoundedAgentResearch({ engine, provider: provider(followUpCalls), authorization: authorization("urn:entity:place"), researches, deadlineAtMs: Date.now() + 120_000 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.execution.status, "completed");
  assert.deepEqual(followUpCalls, [{ target: "urn:entity:place", market: "Lagos" }, { target: "urn:entity:place", market: "New York" }]);
  assert.equal(result.execution.followUpEvidence.length, 2);
  assert.equal(result.execution.initialSnapshots[0].research?.evidence.length, 1);
  assert.equal(result.execution.snapshots[0].research?.evidence.length, 2);
  assert.equal(result.execution.trace.budget.logicalOperationsUsed, 6);
});

test("accepts the same provider entity resolved with volatile metadata in both markets", async () => {
  let searchCount = 0;
  const initialProvider = provider([]);
  const volatileProvider: CulturalIntelligenceProvider = {
    ...initialProvider,
    searchEntities: async () => ({
      ok: true,
      data: [{ ...subject, metadata: { normalizedAt: `run-${++searchCount}` } }],
    }),
  };
  const engine = new DecisionEngine(volatileProvider);
  const researches = await initialResearch(engine);
  const result = await integrateBoundedAgentResearch({
    engine,
    provider: provider([]),
    authorization: authorization("urn:entity:place"),
    researches,
    deadlineAtMs: Date.now() + 120_000,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.execution.status, "completed");
  assert.equal(result.execution.followUpEvidence.length, 2);
});

test("rejects a same-ID entity with conflicting provider identity", async () => {
  let searchCount = 0;
  const initialProvider = provider([]);
  const conflictingProvider: CulturalIntelligenceProvider = {
    ...initialProvider,
    searchEntities: async () => ({
      ok: true,
      data: [{ ...subject, providerId: ++searchCount === 1 ? "qloo" : "other-provider" }],
    }),
  };
  const engine = new DecisionEngine(conflictingProvider);
  const researches = await initialResearch(engine);
  const result = await integrateBoundedAgentResearch({
    engine,
    provider: provider([]),
    authorization: authorization("urn:entity:place"),
    researches,
    deadlineAtMs: Date.now() + 120_000,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "INVALID_RESEARCH_STATE");
  assert.match(result.message, /Entity identity collision/);
});

test("rejects conflicting category and required metadata identities", () => {
  assert.equal(compatibleEntityIdentity(subject, { ...subject, category: "place" }), false);
  assert.equal(compatibleEntityIdentity(subject, { ...subject, sourceReference: "qloo:entity:other" }), false);
});

test("rejects authorization that omits the requested target", async () => {
  const calls: Array<{ target: string; market: string }> = [];
  const engine = new DecisionEngine(provider(calls));
  const researches = await initialResearch(engine);
  const result = await integrateBoundedAgentResearch({ engine, provider: provider(calls), authorization: { ...authorization("urn:entity:place"), allowedTargetTypes: ["urn:entity:brand"], objective: { ...authorization("urn:entity:place").objective, allowedTargetTypes: ["urn:entity:brand"] } }, researches, deadlineAtMs: Date.now() + 120_000 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "INVALID_AUTHORIZATION");
});

test("refuses an unavailable trusted metadata result instead of fabricating usage", async () => {
  const calls: Array<{ target: string; market: string }> = [];
  const engine = new DecisionEngine(provider(calls));
  const researches = await initialResearch(engine);
  const foreignEngine = new DecisionEngine(provider(calls));
  const result = await integrateBoundedAgentResearch({ engine: foreignEngine, provider: provider(calls), authorization: authorization("urn:entity:place"), researches, deadlineAtMs: Date.now() + 120_000 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "TRUSTED_METADATA_UNAVAILABLE");
});

test("enforces actual operation budget and deadline before follow-up calls", async () => {
  const calls: Array<{ target: string; market: string }> = [];
  const engine = new DecisionEngine(provider(calls));
  const researches = await initialResearch(engine);
  const original = engine.getTrustedResearchMetadata(researches[0].result);
  assert.ok(original);
  const tooMany = { ...researches[0].result, scenario: { ...researches[0].result.scenario, seedQueries: ["Adidas", "Adidas 2", "Adidas 3"] } };
  // The result is not accepted as trusted metadata for a different object.
  const invalid = await integrateBoundedAgentResearch({ engine: new DecisionEngine(provider(calls)), provider: provider(calls), authorization: authorization("urn:entity:place"), researches: [{ ...researches[0], result: tooMany }, researches[1]], deadlineAtMs: Date.now() + 120_000 });
  assert.equal(invalid.ok, false);
  const deadline = await integrateBoundedAgentResearch({ engine, provider: provider(calls), authorization: authorization("urn:entity:place"), researches, deadlineAtMs: Date.now() + 1_000, nowMs: () => Date.now() });
  assert.equal(deadline.ok, true);
  if (deadline.ok) {
    assert.equal(deadline.execution.status, "partial");
    assert.equal(deadline.execution.assessment.decision.stopReason, "execution-time-budget");
  }
});

test("preserves initial results when the optional follow-up fails", async () => {
  const calls: Array<{ target: string; market: string }> = [];
  const engine = new DecisionEngine(provider(calls));
  const researches = await initialResearch(engine);
  const failingProvider = { ...provider(calls), discoverAffinity: async () => ({ ok: false as const, error: { code: "TIMEOUT" as const, providerId: "qloo", message: "timeout" } }) };
  const result = await integrateBoundedAgentResearch({ engine, provider: failingProvider, authorization: authorization("urn:entity:place"), researches, deadlineAtMs: Date.now() + 120_000 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.execution.status, "partial");
  assert.equal(result.execution.followUpEvidence.length, 0);
  assert.equal(result.execution.initialSnapshots[0].research?.evidence.length, 1);
});

test("agent request configuration is disabled by default and rejects untrusted execution metadata", () => {
  assert.equal(AgentResearchConfigSchema.safeParse(undefined).success, false);
  const disabled = AgentResearchConfigSchema.safeParse({ enabled: false });
  assert.equal(disabled.success, true);
  const injected = AgentResearchConfigSchema.safeParse({ enabled: true, objective: { kind: "cultural-positioning", requestedTargetTypes: ["urn:entity:place"], budget: 1 }, authorizedTargetTypes: ["urn:entity:brand", "urn:entity:place"], deadlineAtMs: 123, completedRequests: [] });
  assert.equal(injected.success, false);
});

test("enabled authorization requires an explicit supported target", () => {
  const missing = buildAgentAuthorization({ enabled: true }, "urn:entity:brand", ["Lagos"]);
  assert.equal(missing.ok, false);
  const unsupported = buildAgentAuthorization({ enabled: true, objective: { kind: "cultural-positioning", requestedTargetTypes: ["urn:entity:movie"] }, authorizedTargetTypes: ["urn:entity:brand", "urn:entity:movie"] }, "urn:entity:brand", ["Lagos"]);
  assert.equal(unsupported.ok, false);
});
