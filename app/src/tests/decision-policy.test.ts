import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisResult } from "@/agent/contracts";
import { assessDecision } from "@/agent/decision/assessment";
import { classifyEvidenceGaps, decideNextAction, requestFingerprint } from "@/agent/decision/policy";
import type { ResearchObjective, ResearchRequestDescriptor } from "@/agent/decision/contracts";
import type { AffinityEvidence } from "@/core/evidence/types";

const objective: ResearchObjective = { kind: "geographic-cultural-comparison", requestedOutcome: "Compare cultural affinities", markets: ["Lagos", "New York"], allowedTargetTypes: ["urn:entity:brand"], requestedTargetType: "urn:entity:brand" };

function evidence(market: string, target = "target-1", score = 0.8): AffinityEvidence {
  return { kind: "affinity", id: `evidence:${market}:${target}`, subjectEntityId: "signal-1", subjectEntityCategory: "brand", objectEntityId: target, objectEntityCategory: "brand", providerScore: score, providerScoreScale: "qloo:affinity", queryParameters: { "filter.type": "urn:entity:brand", "signal.location.query": market, sort_by: "affinity" }, provenance: { providerId: "qloo", sourceReference: `qloo:${market}:${target}`, retrievedAt: "2026-01-01T00:00:00.000Z" }, verified: true };
}

function research(market: string, items: AffinityEvidence[], status: AnalysisResult["status"] = "completed"): AnalysisResult {
  return { analysisId: `analysis:${market}`, status, scenario: { productConcept: "Athletic brand", launchLocation: market, seedQueries: ["Adidas"], targetTypes: ["urn:entity:brand"] }, resolutions: [], evidence: items, graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] };
}

const snapshots = (left: AffinityEvidence[], right: AffinityEvidence[]) => [{ market: "Lagos", research: research("Lagos", left) }, { market: "New York", research: research("New York", right) }];

test("assesses complete differing markets without comparing scores as opportunity", () => {
  const result = assessDecision({ objective, snapshots: snapshots([evidence("Lagos", "lagos-target")], [evidence("New York", "new-york-target")]) });
  assert.equal(result.status, "supported");
  assert.equal(result.conclusion, "geographic-differences-observed");
  assert.match(result.summary, /Different provider-backed/);
});

test("reports identical complete observations without automatic follow-up", () => {
  const same = snapshots([evidence("Lagos")], [evidence("New York")]);
  const result = assessDecision({ objective, snapshots: same });
  assert.equal(result.conclusion, "no-observed-differences");
  assert.equal(result.decision.action, "STOP");
  assert.equal(result.decision.stopReason, "no-actionable-gap");
});

test("detects missing, partial, invalid and missing-provenance evidence", () => {
  const missing = classifyEvidenceGaps({ objective, snapshots: [{ market: "Lagos", research: research("Lagos", [evidence("Lagos")]) }, { market: "New York" }] });
  assert.ok(missing.some((gap) => gap.type === "missing-market-evidence"));
  const partial = classifyEvidenceGaps({ objective, snapshots: snapshots([evidence("Lagos")], [evidence("New York")]).map((item) => item.market === "New York" ? { ...item, research: research("New York", [evidence("New York")], "partial") } : item) });
  assert.ok(partial.some((gap) => gap.type === "partial-research"));
  const invalid = classifyEvidenceGaps({ objective, snapshots: snapshots([evidence("Lagos")], [evidence("New York")]).map((item) => item.market === "Lagos" ? { ...item, research: research("Lagos", [{ ...evidence("Lagos"), providerScore: undefined } as never]) } : item) });
  assert.ok(invalid.some((gap) => gap.type === "invalid-evidence"));
  const noProvenance = classifyEvidenceGaps({ objective, snapshots: snapshots([evidence("Lagos")], [evidence("New York")]).map((item) => item.market === "Lagos" ? { ...item, research: research("Lagos", [{ ...evidence("Lagos"), queryParameters: {} }]) } : item) });
  assert.ok(noProvenance.some((gap) => gap.type === "query-provenance"));
});

test("rejects unsupported commercial and audience questions", () => {
  for (const kind of ["unsupported-commercial", "unsupported-audience"] as const) {
    const result = assessDecision({ objective: { ...objective, kind, requestedOutcome: "Predict market demand" }, snapshots: snapshots([evidence("Lagos")], [evidence("New York")]) });
    assert.equal(result.status, "unsupported");
    assert.equal(result.decision.stopReason, "unsupported-conclusion");
  }
});

test("approves only explicit, authorized and materially different target follow-up", () => {
  const followUp: ResearchRequestDescriptor = { subjectEntityId: "signal-1", targetEntityType: "urn:entity:place", market: "Lagos", geographicStrategy: "filter.location.query", explainability: true };
  const explicit: ResearchObjective = { ...objective, allowedTargetTypes: ["urn:entity:brand", "urn:entity:place"], requestedTargetType: "urn:entity:place" };
  const decision = decideNextAction({ objective: explicit, snapshots: snapshots([evidence("Lagos")], [evidence("New York")]), proposedFollowUp: followUp });
  assert.equal(decision.action, "FOLLOW_UP_APPROVED");
  assert.equal(decision.requestFingerprint, requestFingerprint(followUp));
  const implicit = decideNextAction({ objective, snapshots: snapshots([evidence("Lagos")], [evidence("New York")]), proposedFollowUp: followUp });
  assert.equal(implicit.action, "STOP");
});

test("blocks duplicate requests, budgets and deadlines", () => {
  const request: ResearchRequestDescriptor = { subjectEntityId: "signal-1", targetEntityType: "urn:entity:place", market: "Lagos", geographicStrategy: "filter.location.query", explainability: true };
  const input = { objective: { ...objective, allowedTargetTypes: ["urn:entity:brand", "urn:entity:place"], requestedTargetType: "urn:entity:place" }, snapshots: snapshots([evidence("Lagos")], [evidence("New York")]), proposedFollowUp: request };
  assert.equal(decideNextAction({ ...input, completedRequests: [request] }).action, "STOP");
  assert.equal(decideNextAction({ ...input, budget: { logicalOperationsUsed: 6 } }).stopReason, "budget-exhausted");
  assert.equal(decideNextAction({ ...input, budget: { deadlineAtMs: 10 }, nowMs: 11 }).stopReason, "execution-time-budget");
});

test("rejects follow-ups outside the provider-supported target categories", () => {
  const request: ResearchRequestDescriptor = { subjectEntityId: "signal-1", targetEntityType: "urn:entity:movie", market: "Lagos", geographicStrategy: "filter.location.query", explainability: true };
  const result = decideNextAction({ objective: { ...objective, allowedTargetTypes: ["urn:entity:brand", "urn:entity:movie"], requestedTargetType: "urn:entity:movie" }, snapshots: snapshots([evidence("Lagos")], [evidence("New York")]), proposedFollowUp: request, supportedTargetTypes: ["urn:entity:brand", "urn:entity:place"] });
  assert.equal(result.action, "UNSUPPORTED");
  assert.equal(result.stopReason, "unsupported-capability");
});

test("stops when a research subject was not uniquely resolved", () => {
  const unresolved = research("Lagos", [evidence("Lagos")]);
  unresolved.resolutions = [{ query: "Adidas", status: "ambiguous", candidates: [] }];
  const result = assessDecision({ objective, snapshots: [{ market: "Lagos", research: unresolved }, { market: "New York", research: research("New York", [evidence("New York")]) }] });
  assert.equal(result.decision.stopReason, "entity-resolution-required");
});

test("preserves evidence and produces deterministic traces", () => {
  const original = snapshots([evidence("Lagos")], [evidence("New York")]);
  const before = JSON.stringify(original);
  const first = assessDecision({ objective, snapshots: original });
  const second = assessDecision({ objective, snapshots: original });
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(first, second);
});

test("supports counterfactual-style independent assessment with fixed markets", () => {
  const adidas = assessDecision({ objective, snapshots: snapshots([evidence("Lagos", "a")], [evidence("New York", "b")]) });
  const starbucks = assessDecision({ objective, snapshots: snapshots([evidence("Lagos", "a")], [evidence("New York", "a")]) });
  assert.equal(adidas.conclusion, "geographic-differences-observed");
  assert.equal(starbucks.conclusion, "no-observed-differences");
  assert.deepEqual(adidas.trace.objective.markets, starbucks.trace.objective.markets);
});
