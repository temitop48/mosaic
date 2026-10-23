import assert from "node:assert/strict";
import test from "node:test";
import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";
import { createCounterfactualRequest, mapCounterfactualResponse, type StudioScenarioInput } from "@/components/mosaic/studio-model";
import { followUpEvidenceCount, followUpEvidenceGroups } from "@/components/mosaic/decision-brief-model";
import { loadSavedAnalyses, parseSavedAnalyses, saveAnalysis } from "@/components/mosaic/saved-analyses";

class MemoryStorage {
  private value: string | null = null;
  getItem() { return this.value; }
  setItem(_key: string, value: string) { this.value = value; }
}

const request: StudioScenarioInput = {
  productConcept: "Athletic lifestyle brand",
  seedQuery: "Adidas",
  baselineLocation: "Lagos",
  alternativeLocation: "New York",
  includeStrategicInterpretation: false,
  researchTarget: "urn:entity:brand",
  agentResearchEnabled: true,
  agentObjective: "geographic-cultural-comparison",
  agentFollowUpTarget: "urn:entity:place",
};

function evidence(market: string): CulturalEvidence {
  return {
    kind: "affinity",
    id: `qloo:${market}:place`,
    subjectEntityId: "qloo:brand:adidas",
    subjectEntityCategory: "brand",
    subjectEntityName: "Adidas",
    objectEntityId: `qloo:place:${market}`,
    objectEntityCategory: "place",
    objectEntityName: `${market} place`,
    providerScore: 0.72,
    providerScoreScale: "qloo-affinity",
    queryParameters: { "filter.type": "urn:entity:place", "filter.location.query": market, sort_by: "affinity" },
    provenance: { providerId: "qloo", sourceReference: `qloo:insight:${market}`, retrievedAt: "2026-01-01T00:00:00.000Z" },
    geographicContext: { city: market },
    verified: true,
  };
}

function brandEvidence(market: string): CulturalEvidence {
  return {
    kind: "affinity",
    id: `qloo:${market}:brand-follow-up`,
    subjectEntityId: "qloo:brand:starbucks",
    subjectEntityCategory: "brand",
    subjectEntityName: "Starbucks",
    objectEntityId: `qloo:brand:${market}`,
    objectEntityCategory: "brand",
    objectEntityName: `${market} brand`,
    providerScore: 0.61,
    providerScoreScale: "qloo-affinity",
    queryParameters: { "filter.type": "urn:entity:brand", "signal.location.query": market, sort_by: "affinity" },
    provenance: { providerId: "qloo", sourceReference: `qloo:insight:${market}:brand`, retrievedAt: "2026-01-01T00:00:00.000Z" },
    geographicContext: { city: market },
    verified: true,
  };
}

function result(): CounterfactualResult {
  const research = (market: string) => ({ analysisId: `analysis:${market}`, status: "completed" as const, scenario: { productConcept: request.productConcept, launchLocation: market, seedQueries: [request.seedQuery], targetTypes: ["urn:entity:brand"] }, resolutions: [], evidence: [evidence(market)], graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] });
  return { status: "completed", dimension: "launchLocation", baselineScenario: research("Lagos").scenario, alternativeScenario: research("New York").scenario, baselineResearch: research("Lagos"), alternativeResearch: research("New York"), comparison: { compared: true, baselineEvidenceCount: 1, alternativeEvidenceCount: 1, baselineGraphEdgeCount: 1, alternativeGraphEdgeCount: 1, sharedEntities: [], baselineOnlyEntities: [], alternativeOnlyEntities: [], sharedRelationships: [], baselineOnlyRelationships: [], alternativeOnlyRelationships: [], changedObservedRelationships: [], evidenceChanges: [], queryContexts: { baseline: [], alternative: [] }, geographicContexts: { baseline: [{ city: "Lagos" }], alternative: [{ city: "New York" }] }, limitations: [] }, limitations: [], errors: [], strategicInterpretationStatus: "not-requested" };
}

test("default and disabled requests omit agent configuration", () => {
  const base = { ...request, agentResearchEnabled: false };
  assert.equal("agentResearch" in createCounterfactualRequest(base), false);
  const legacy: StudioScenarioInput = { productConcept: base.productConcept, seedQuery: base.seedQuery, baselineLocation: base.baselineLocation, alternativeLocation: base.alternativeLocation, includeStrategicInterpretation: base.includeStrategicInterpretation };
  assert.equal("agentResearch" in createCounterfactualRequest(legacy), false);
});

test("enabled request sends only explicit objective and authorized dimensions", () => {
  const payload = createCounterfactualRequest(request) as ReturnType<typeof createCounterfactualRequest> & { agentResearch: { objective: { requestedTargetTypes: string[] }; authorizedTargetTypes: string[] } };
  assert.deepEqual(payload.agentResearch, {
    enabled: true,
    objective: { kind: "geographic-cultural-comparison", requestedTargetTypes: ["urn:entity:place"], requestedOutcome: "Investigate an explicitly requested additional cultural dimension" },
    authorizedTargetTypes: ["urn:entity:brand", "urn:entity:place"],
  });
  assert.equal((payload as { budget?: unknown }).budget, undefined);
  assert.equal((payload as { deadlineAtMs?: unknown }).deadlineAtMs, undefined);
});

test("an enabled request without an additional dimension remains explicit but does not request a follow-up", () => {
  const payload = createCounterfactualRequest({ ...request, agentFollowUpTarget: "none" }) as ReturnType<typeof createCounterfactualRequest> & { agentResearch: { objective: { requestedTargetTypes: string[] }; authorizedTargetTypes: string[] } };
  assert.deepEqual(payload.agentResearch?.objective.requestedTargetTypes, []);
  assert.deepEqual(payload.agentResearch?.authorizedTargetTypes, ["urn:entity:brand"]);
});

test("mapped agent response is additive and preserves follow-up evidence", () => {
  const source = result();
  const mapped = mapCounterfactualResponse({ ...source, agentResearch: { status: "partial", stopReason: "provider-failure", followUpEvidence: [evidence("Lagos")] } });
  assert.equal(mapped?.agentResearch?.status, "partial");
  assert.equal(mapped?.agentResearch?.followUpEvidence?.[0]?.provenance.providerId, "qloo");
  assert.equal(mapped?.baselineResearch?.evidence[0]?.id, source.baselineResearch?.evidence[0]?.id);
});

test("agent fields round-trip in saved research while legacy entries remain readable", () => {
  const storage = new MemoryStorage();
  const source = result();
  const withAgent = { ...source, agentResearch: { status: "stopped" as const, stopReason: "evidence-sufficient" as const, followUpEvidence: [] } };
  assert.equal(saveAnalysis(request, withAgent, storage).ok, true);
  const reopened = loadSavedAnalyses(storage);
  assert.equal(reopened[0]?.result.agentResearch?.status, "stopped");
  const legacy = JSON.stringify([{ id: "legacy", title: "Legacy", request: { ...request, agentResearchEnabled: undefined, agentObjective: undefined, agentFollowUpTarget: undefined }, result: source, createdAt: "2026-01-01T00:00:00.000Z", schemaVersion: 1 }]);
  assert.equal(parseSavedAnalyses(legacy).length, 1);
  assert.equal(parseSavedAnalyses(legacy)[0]?.result.agentResearch, undefined);
});

test("groups completed Brand-to-Place follow-up evidence by dimension and market", () => {
  const source = result() as CounterfactualResult & { agentResearch?: NonNullable<ReturnType<typeof mapCounterfactualResponse>>["agentResearch"] };
  source.agentResearch = { status: "completed", followUpEvidence: [evidence("Lagos"), evidence("New York")] };
  const groups = followUpEvidenceGroups(source);
  assert.deepEqual(groups.map((group) => [group.targetLabel, group.market]), [["place", "Lagos"], ["place", "New York"]]);
  assert.equal(followUpEvidenceCount(source), 2);
  assert.equal(groups[0]?.evidence[0]?.providerScore, 0.72);
  assert.equal(groups[0]?.evidence[0]?.provenance.sourceReference, "qloo:insight:Lagos");
  assert.equal(source.baselineResearch?.evidence[0]?.id, "qloo:Lagos:place");
});

test("groups Place-to-Brand follow-up evidence without merging the primary graph", () => {
  const source = result() as CounterfactualResult & { agentResearch?: NonNullable<ReturnType<typeof mapCounterfactualResponse>>["agentResearch"] };
  source.agentResearch = { status: "completed", followUpEvidence: [brandEvidence("London"), brandEvidence("New York")] };
  const groups = followUpEvidenceGroups(source);
  assert.deepEqual(groups.map((group) => group.targetLabel), ["brand", "brand"]);
  assert.deepEqual(groups.map((group) => group.market), ["London", "New York"]);
  assert.equal(groups[0]?.strategy, "location-signal");
  assert.equal(groups[0]?.evidence[0]?.objectEntityName, "London brand");
  assert.equal(source.baselineResearch?.evidence[0]?.objectEntityCategory, "place");
});

test("invalid or unverified follow-up observations are not presented as findings", () => {
  const invalid = { ...evidence("Lagos"), verified: false };
  const source = result() as CounterfactualResult & { agentResearch?: NonNullable<ReturnType<typeof mapCounterfactualResponse>>["agentResearch"] };
  source.agentResearch = { status: "partial", followUpEvidence: [invalid, evidence("New York")] };
  const groups = followUpEvidenceGroups(source);
  assert.equal(followUpEvidenceCount(source), 1);
  assert.deepEqual(groups.map((group) => group.market), ["New York"]);
});

test("stopped, unavailable, and disabled states expose no invented follow-up observations", () => {
  const stopped = result() as CounterfactualResult & { agentResearch?: NonNullable<ReturnType<typeof mapCounterfactualResponse>>["agentResearch"] };
  stopped.agentResearch = { status: "stopped", stopReason: "evidence-sufficient", followUpEvidence: [] };
  assert.deepEqual(followUpEvidenceGroups(stopped), []);
  const unavailable = { ...stopped, agentResearch: { status: "unavailable" as const, followUpEvidence: [evidence("Lagos")] } };
  assert.deepEqual(followUpEvidenceGroups(unavailable), []);
  assert.deepEqual(followUpEvidenceGroups(result()), []);
});

test("saved agent evidence remains available to the shared presentation model after reopening", () => {
  const storage = new MemoryStorage();
  const source = { ...result(), agentResearch: { status: "completed" as const, followUpEvidence: [evidence("Lagos")] } };
  assert.equal(saveAnalysis(request, source, storage).ok, true);
  const reopened = loadSavedAnalyses(storage)[0]?.result;
  assert.equal(reopened ? followUpEvidenceCount(reopened) : 0, 1);
  assert.equal(reopened ? followUpEvidenceGroups(reopened)[0]?.market : undefined, "Lagos");
});
