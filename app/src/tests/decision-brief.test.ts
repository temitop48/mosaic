import assert from "node:assert/strict";
import test from "node:test";
import type { CulturalEvidence } from "@/core/evidence/types";
import type { StudioResearchResult } from "@/components/mosaic/studio-model";
import { decisionBriefAssessment, decisionBriefGeographicSummary, decisionBriefNextAction, followUpEvidenceGroups, followUpRationale, formatAffinityValue, geographicComparisonNotice, geographicInterpretationForResult, stopRationale } from "@/components/mosaic/decision-brief-model";
import type { AgentResearchResponse } from "@/components/mosaic/studio-model";

function evidence(id: string, city: string, target: "place" | "brand" = "place", strategy: "filter" | "signal" = "filter"): CulturalEvidence {
  const queryParameters: Record<string, string> = { "filter.type": `urn:entity:${target}`, sort_by: "affinity" };
  queryParameters[strategy === "filter" ? "filter.location.query" : "signal.location.query"] = city;
  return { kind: "affinity", id, subjectEntityId: "starbucks", subjectEntityCategory: "brand", subjectEntityName: "Starbucks", objectEntityId: id, objectEntityCategory: target, objectEntityName: `${target === "place" ? "Place" : "Brand"} ${id}`, providerScore: 0.8, providerScoreScale: "qloo:affinity", queryParameters, provenance: { providerId: "qloo", sourceReference: `qloo:${id}`, retrievedAt: "2026-01-01T00:00:00.000Z" }, verified: true };
}

function result(changed = true, target: "place" | "brand" = "place", strategy: "filter" | "signal" = target === "brand" ? "signal" : "filter"): StudioResearchResult {
  const baseline = evidence("london-a", "London", target, strategy);
  const alternative = evidence(changed ? "new-york-b" : "london-a", "New York", target, strategy);
  const targetType = `urn:entity:${target}`;
  return { status: "completed", dimension: "launchLocation", baselineScenario: { productConcept: "Coffee concept", launchLocation: "London", seedQueries: ["Starbucks"], targetTypes: [targetType] }, alternativeScenario: { productConcept: "Coffee concept", launchLocation: "New York", seedQueries: ["Starbucks"], targetTypes: [targetType] }, baselineResearch: { analysisId: "a", status: "completed", scenario: { productConcept: "Coffee concept", launchLocation: "London", seedQueries: ["Starbucks"], targetTypes: [targetType] }, resolutions: [], evidence: [baseline], graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] }, alternativeResearch: { analysisId: "b", status: "completed", scenario: { productConcept: "Coffee concept", launchLocation: "New York", seedQueries: ["Starbucks"], targetTypes: [targetType] }, resolutions: [], evidence: [alternative], graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] }, comparison: { compared: true, baselineEvidenceCount: 1, alternativeEvidenceCount: 1, baselineGraphEdgeCount: 1, alternativeGraphEdgeCount: 1, sharedEntities: [], baselineOnlyEntities: [], alternativeOnlyEntities: [], sharedRelationships: [], baselineOnlyRelationships: [], alternativeOnlyRelationships: [], changedObservedRelationships: changed ? [{ providerId: "qloo", subjectEntityId: "starbucks", subjectEntityCategory: "brand", objectEntityId: "new-york-b", objectEntityCategory: target, alternative: { evidenceId: alternative.id, providerId: "qloo", subjectEntityId: "starbucks", subjectEntityCategory: "brand", objectEntityId: alternative.objectEntityId, objectEntityCategory: target, providerScore: alternative.providerScore, queryParameters: alternative.queryParameters, retrievedAt: alternative.provenance.retrievedAt } }] : [], evidenceChanges: changed ? [{ changeType: "added-in-alternative", providerId: "qloo", subjectEntityId: "starbucks", subjectEntityCategory: "brand", objectEntityId: "new-york-b", objectEntityCategory: target, alternative: { evidenceId: alternative.id, providerId: "qloo", subjectEntityId: "starbucks", subjectEntityCategory: "brand", objectEntityId: alternative.objectEntityId, objectEntityCategory: target, providerScore: alternative.providerScore, queryParameters: alternative.queryParameters, retrievedAt: alternative.provenance.retrievedAt } }] : [], queryContexts: { baseline: [baseline.queryParameters], alternative: [alternative.queryParameters] }, geographicContexts: { baseline: [], alternative: [] }, limitations: [] }, limitations: [], errors: [], strategicInterpretationStatus: "not-requested" };
}

test("builds a supported verdict and geographic scope without commercial claims", () => {
  const value = result();
  const assessment = decisionBriefAssessment(value);
  assert.equal(assessment.conclusion, "geographic-differences-observed");
  assert.match(decisionBriefGeographicSummary(value), /London and New York/);
  assert.match(decisionBriefNextAction(value, assessment), /independent commercial research/);
});

test("reports no observed differentiation without implying identical markets", () => {
  const value = result(false);
  assert.equal(decisionBriefAssessment(value).conclusion, "no-observed-differences");
  assert.match(decisionBriefAssessment(value).summary, /does not establish identical cultural landscapes/);
});

test("incomplete research receives an evidence limitation and no unsupported verdict", () => {
  const value = { ...result(), status: "partial" as const, alternativeResearch: undefined };
  const assessment = decisionBriefAssessment(value);
  assert.equal(assessment.conclusion, "comparison-incomplete");
  assert.match(decisionBriefGeographicSummary(value), /incomplete/);
});

test("qualifies different filtered Places as location-specific coverage", () => {
  const value = result(true, "place", "filter");
  assert.deepEqual(geographicInterpretationForResult(value), { target: "urn:entity:place", strategy: "location-filter", placeInventory: true });
  assert.match(decisionBriefAssessment(value).summary, /supports a comparison/);
  assert.match(decisionBriefGeographicSummary(value), /geographic filters/);
  assert.match(geographicComparisonNotice(value), /not.*market winner/);
});

test("keeps shared filtered Place observations descriptive rather than cultural", () => {
  const value = result(false, "place", "filter");
  assert.match(decisionBriefAssessment(value).summary, /no observed differentiation/);
  assert.match(decisionBriefGeographicSummary(value), /place evidence/);
  assert.match(geographicComparisonNotice(value), /location-specific evidence coverage/);
});

test("describes Brand changes as location-conditioned provider relationships", () => {
  const value = result(true, "brand", "signal");
  assert.deepEqual(geographicInterpretationForResult(value), { target: "urn:entity:brand", strategy: "location-signal", placeInventory: false });
  assert.match(decisionBriefAssessment(value).summary, /supports a comparison/);
  assert.match(decisionBriefGeographicSummary(value), /location signals/);
  assert.match(geographicComparisonNotice(value), /not.*market winner/);
});

test("keeps identical Brand observations conservative", () => {
  const value = result(false, "brand", "signal");
  assert.match(decisionBriefAssessment(value).summary, /no observed differentiation/);
  assert.match(geographicComparisonNotice(value), /location-conditioned brand affinities/);
});

test("uses conservative language when geographic strategy metadata is incomplete", () => {
  const value = result(true, "place", "filter");
  for (const item of [...(value.baselineResearch?.evidence ?? []), ...(value.alternativeResearch?.evidence ?? [])]) {
    if (item.kind === "affinity") delete item.queryParameters["filter.location.query"];
  }
  assert.equal(geographicInterpretationForResult(value).strategy, "unverified");
  assert.match(decisionBriefGeographicSummary(value), /could not support a stronger interpretation/);
  assert.match(geographicComparisonNotice(value), /geographically separate provider result sets/);
});

test("shares the same interpretation contract for Studio and Canvas presentation", () => {
  const value = result(true, "place", "filter");
  const notice = geographicComparisonNotice(value);
  assert.match(notice, /location-specific evidence coverage/);
  assert.match(decisionBriefGeographicSummary(value), /location-specific evidence coverage/);
});

function agent(overrides: Partial<AgentResearchResponse> = {}): AgentResearchResponse {
  return {
    status: "completed",
    followUpEvidence: [],
    trace: {
      objective: { kind: "local-entity-discovery", requestedOutcome: "Places", markets: ["London"], allowedTargetTypes: ["urn:entity:place"] },
      gaps: [{ type: "requested-dimension", trigger: "Places were authorized", whyItMatters: "The primary Brand research does not cover Places.", actionable: true, evidenceIds: ["brand-1"], allowedActions: ["FOLLOW_UP_APPROVED"] }],
      decision: { action: "STOP", reason: "The available validated evidence is sufficient for the supported cultural assessment.", supportingEvidenceIds: [], stopReason: "evidence-sufficient" },
      steps: [{ index: 0, action: "ASSESS", reason: "Initial evidence assessed.", supportingEvidenceIds: [], budgetBefore: {} as never, budgetAfter: {} as never, outcome: "Initial evidence assessed." }],
      budget: {} as never,
      stopReason: "evidence-sufficient",
    },
    ...overrides,
  };
}

test("uses follow-up rationale without substituting the final STOP rationale", () => {
  const value = agent();
  assert.match(followUpRationale(value, "Places"), /authorized Places.*missing research dimension/);
  assert.doesNotMatch(followUpRationale(value, "Places"), /available validated evidence is sufficient/);
  assert.match(stopRationale(value) ?? "", /available validated evidence is sufficient/);
});

test("presents completed, partial, stopped, and missing-rationale follow-up states conservatively", () => {
  assert.match(followUpRationale(agent({ status: "completed", followUpEvidence: [evidence("place-1", "London")] }), "Places"), /authorized Places/);
  assert.match(followUpRationale(agent({ status: "partial", followUpEvidence: [evidence("place-2", "London")] }), "Places"), /authorized Places/);
  assert.match(followUpRationale(agent({ status: "stopped", followUpEvidence: [] })), /No follow-up was executed/);
  assert.match(followUpRationale({ status: "partial", followUpEvidence: [] }), /not retained/);
});

test("formats affinity for display while retaining the original evidence value", () => {
  const original = 0.72194;
  const value = result() as StudioResearchResult & { agentResearch: AgentResearchResponse };
  value.agentResearch = agent({ followUpEvidence: [ { ...evidence("place-precision", "London"), providerScore: original } ] });
  assert.equal(followUpEvidenceGroups(value)[0]?.evidence[0]?.providerScore, original);
  assert.equal(formatAffinityValue(original), "0.722");
});
