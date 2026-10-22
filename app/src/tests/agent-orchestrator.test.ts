import assert from "node:assert/strict";
import test from "node:test";
import type { CulturalEntity } from "@/core/entities/types";
import { EvidenceRegistry } from "@/core/evidence/registry";
import type { AffinityEvidence } from "@/core/evidence/types";
import type { AnalysisResult } from "@/agent/contracts";
import type { CulturalIntelligenceProvider, ProviderResult } from "@/providers/interfaces/contracts";
import type { ResearchBudget, ResearchObjective, ResearchRequestDescriptor } from "@/agent/decision/contracts";
import { executeBoundedResearch } from "@/agent/decision/orchestrator";

const subject: CulturalEntity = { id: "qloo:brand:adidas", providerId: "qloo", name: "Adidas", category: "brand", sourceReference: "qloo:entity:adidas", metadata: {} };
const objective: ResearchObjective = { kind: "geographic-cultural-comparison", requestedOutcome: "Compare cultural affinities", markets: ["Lagos", "New York"], allowedTargetTypes: ["urn:entity:brand", "urn:entity:place"], requestedTargetType: "urn:entity:place" };

function evidence(market: string, targetType: "brand" | "place", target: string): AffinityEvidence {
  const targetUrn = `urn:entity:${targetType}`;
  return { kind: "affinity", id: `evidence:${market}:${targetType}:${target}`, subjectEntityId: subject.id, subjectEntityCategory: "brand", subjectEntityName: subject.name, objectEntityId: `qloo:${targetType}:${target}`, objectEntityCategory: targetType, objectEntityName: target, providerScore: 0.8, providerScoreScale: "qloo:affinity", queryParameters: { "filter.type": targetUrn, [targetType === "brand" ? "signal.location.query" : "filter.location.query"]: market, sort_by: "affinity" }, provenance: { providerId: "qloo", sourceReference: `qloo:insight:${market}:${target}`, retrievedAt: "2026-01-01T00:00:00.000Z" }, verified: true };
}

function research(market: string, item: AffinityEvidence): AnalysisResult {
  return { analysisId: `analysis:${market}`, status: "completed", scenario: { productConcept: "Athletic brand", launchLocation: market, seedQueries: ["Adidas"], targetTypes: ["urn:entity:brand"] }, resolutions: [{ query: "Adidas", status: "resolved", entity: subject, candidates: [subject] }], evidence: [item], graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] };
}

function registryFor(items: AffinityEvidence[]): EvidenceRegistry {
  const registry = new EvidenceRegistry();
  registry.registerEntity(subject);
  for (const item of items) {
    registry.registerEntity({ id: item.objectEntityId, providerId: item.provenance.providerId, name: item.objectEntityName ?? item.objectEntityId, category: item.objectEntityCategory, sourceReference: `${item.provenance.providerId}:entity:${item.objectEntityId}`, metadata: {} });
    assert.equal(registry.registerEvidence(item).valid, true);
  }
  return registry;
}

function request(market: string, target: "brand" | "place"): ResearchRequestDescriptor {
  return { subjectEntityId: subject.id, targetEntityType: `urn:entity:${target}`, market, geographicStrategy: target === "brand" ? "signal.location.query" : "filter.location.query", explainability: true };
}

function budget(now: number, logicalOperationsUsed = 4): ResearchBudget {
  return { logicalOperationsUsed, providerAttemptsUsed: logicalOperationsUsed, maxLogicalOperations: 6, followUpRoundsUsed: 0, maxFollowUpRounds: 1, followUpAffinityByMarket: {}, maxFollowUpAffinityPerMarket: 1, deadlineAtMs: now + 120_000 };
}

function provider(response: (market: string) => ProviderResult<AffinityEvidence[]> | Promise<ProviderResult<AffinityEvidence[]>>, calls: string[] = []): CulturalIntelligenceProvider {
  return {
    id: "qloo",
    getCapabilities: () => ({ entitySearch: true, affinityDiscovery: true, geographicFiltering: true, explainability: false, affinityExplainability: true }),
    searchEntities: async () => ({ ok: true, data: [] }),
    discoverAffinity: async (input) => { calls.push(`${input.targetType}:${input.locationQuery}`); return response(input.locationQuery ?? ""); },
    explainEvidence: async () => ({ ok: false, error: { code: "UNSUPPORTED_CAPABILITY", providerId: "qloo", message: "unsupported" } }),
  };
}

function baseInput(overrides: Partial<Parameters<typeof executeBoundedResearch>[0]> = {}) {
  const initial = [evidence("Lagos", "brand", "nike"), evidence("New York", "brand", "puma")];
  const now = 1_000_000;
  return {
    objective,
    snapshots: [{ market: "Lagos", research: research("Lagos", initial[0]) }, { market: "New York", research: research("New York", initial[1]) }],
    registry: registryFor(initial),
    resolvedSubjects: [subject],
    budget: budget(now),
    completedRequests: [request("Lagos", "brand"), request("New York", "brand")],
    provider: provider((market) => ({ ok: true, data: [evidence(market, "place", market === "Lagos" ? "Lagos Venue" : "New York Venue")] })),
    followUpRequests: [request("Lagos", "place"), request("New York", "place")],
    supportedTargetTypes: ["urn:entity:brand", "urn:entity:place"],
    nowMs: () => now,
    providerTimeoutMs: 60_000,
    responseReserveMs: 5_000,
    ...overrides,
  };
}

test("complete research stops without a follow-up", async () => {
  const calls: string[] = [];
  const input = baseInput({ objective: { ...objective, requestedTargetType: "urn:entity:brand" }, followUpRequests: [], provider: provider(() => ({ ok: true, data: [] }), calls) });
  const result = await executeBoundedResearch(input);
  assert.equal(result.status, "stopped");
  assert.equal(result.assessment.decision.stopReason, "evidence-sufficient");
  assert.deepEqual(calls, []);
});

test("executes an explicitly authorized follow-up for each market", async () => {
  const calls: string[] = [];
  const result = await executeBoundedResearch(baseInput({ provider: provider((market) => ({ ok: true, data: [evidence(market, "place", market)] }), calls) }));
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["urn:entity:place:Lagos", "urn:entity:place:New York"]);
  assert.equal(result.followUpEvidence.length, 2);
  assert.equal(result.snapshots[0].research?.evidence.length, 2);
  assert.equal(result.initialSnapshots[0].research?.evidence.length, 1);
  assert.equal(result.trace.steps.some((item) => item.action === "PROVIDER_OPERATION"), true);
  assert.equal(result.trace.steps.some((item) => item.action === "VALIDATE_EVIDENCE"), true);
});

test("blocks an unauthorized target dimension without a provider call", async () => {
  const calls: string[] = [];
  const input = baseInput({ objective: { ...objective, allowedTargetTypes: ["urn:entity:brand"] }, provider: provider(() => ({ ok: true, data: [] }), calls) });
  const result = await executeBoundedResearch(input);
  assert.equal(result.status, "stopped");
  assert.deepEqual(calls, []);
  assert.equal(result.assessment.decision.stopReason, "unsupported-capability");
});

test("blocks duplicate requests, exhausted budgets, and exhausted deadlines", async () => {
  const calls: string[] = [];
  const duplicate = await executeBoundedResearch(baseInput({ completedRequests: [request("Lagos", "brand"), request("New York", "brand"), request("Lagos", "place")], provider: provider(() => ({ ok: true, data: [] }), calls) }));
  assert.deepEqual(calls, []);
  assert.equal(duplicate.assessment.decision.stopReason, "duplicate-request-blocked");
  const exhausted = await executeBoundedResearch(baseInput({ budget: { ...budget(1_000_000), logicalOperationsUsed: 6 }, provider: provider(() => ({ ok: true, data: [] }), calls) }));
  assert.equal(exhausted.assessment.decision.stopReason, "budget-exhausted");
  const deadline = await executeBoundedResearch(baseInput({ budget: { ...budget(1_000_000), deadlineAtMs: 1_060_000 }, provider: provider(() => ({ ok: true, data: [] }), calls) }));
  assert.equal(deadline.assessment.decision.stopReason, "execution-time-budget");
});

test("preserves initial evidence after provider timeout or exception", async () => {
  const timeout = await executeBoundedResearch(baseInput({ provider: provider(() => ({ ok: false, error: { code: "TIMEOUT", providerId: "qloo", message: "Timed out" } })) }));
  assert.equal(timeout.status, "partial");
  assert.equal(timeout.followUpEvidence.length, 0);
  assert.equal(timeout.snapshots[0].research?.evidence.length, 1);
  assert.equal(timeout.errors[0]?.code, "TIMEOUT");
  const exception = await executeBoundedResearch(baseInput({ provider: provider(() => { throw new Error("network failure"); }) }));
  assert.equal(exception.status, "partial");
  assert.equal(exception.assessment.decision.stopReason, "provider-failure");
});

test("marks mixed valid and invalid provider observations as partial", async () => {
  const valid = evidence("Lagos", "place", "valid");
  const invalid = { ...valid, id: "invalid", objectEntityId: "wrong", queryParameters: { ...valid.queryParameters, "filter.location.query": "New York" } };
  const result = await executeBoundedResearch(baseInput({ followUpRequests: [request("Lagos", "place")], provider: provider(() => ({ ok: true, data: [valid, invalid] })) }));
  assert.equal(result.status, "partial");
  assert.equal(result.followUpEvidence.length, 1);
  assert.equal(result.snapshots[0].research?.evidence.length, 2);
  assert.equal(result.errors[0]?.code, "EVIDENCE_VALIDATION_FAILURE");
});

test("requires a resolved subject before executing a follow-up", async () => {
  const result = await executeBoundedResearch(baseInput({ resolvedSubjects: [] }));
  assert.equal(result.status, "partial");
  assert.equal(result.assessment.decision.stopReason, "entity-resolution-required");
});

test("keeps traces deterministic and does not mutate caller snapshots", async () => {
  const input = baseInput();
  const before = JSON.stringify(input.snapshots);
  const first = await executeBoundedResearch(input);
  const second = await executeBoundedResearch(baseInput());
  assert.equal(JSON.stringify(input.snapshots), before);
  assert.deepEqual(first.trace.steps.map((item) => ({ action: item.action, outcome: item.outcome, stopReason: item.stopReason })), second.trace.steps.map((item) => ({ action: item.action, outcome: item.outcome, stopReason: item.stopReason })));
});
