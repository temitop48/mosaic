import assert from "node:assert/strict";
import test from "node:test";
import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";
import { mapCounterfactualResponse } from "@/components/mosaic/studio-model";
import { buildStudioGraph, calculateStudioGraphViewport, createCounterfactualRequest, evidenceForMarket, studioGraphBounds, studioGraphForDisplay, studioGraphNodeFootprint } from "@/components/mosaic/studio-model";

const source = { id: "qloo:brand:signal", providerId: "qloo", name: "Signal Brand", category: "brand" as const, sourceReference: "qloo:entity:signal", metadata: {} };
function evidence(market: string, target: string, score: number): CulturalEvidence {
  return { kind: "affinity", id: "evidence:" + market + ":" + target, subjectEntityId: source.id, subjectEntityCategory: "brand", subjectEntityName: source.name, objectEntityId: "qloo:" + target, objectEntityCategory: "place", objectEntityName: target, providerScore: score, geographicContext: { city: market }, queryParameters: { "filter.location.query": market, "filter.type": "urn:entity:place" }, provenance: { providerId: "qloo", sourceReference: "qloo:insight:" + market, retrievedAt: "2026-01-01T00:00:00.000Z" }, verified: true };
}

function result(): CounterfactualResult {
  const baselineEvidence = [evidence("London", "London venue", 0.66)];
  const alternativeEvidence = [evidence("New York", "New York venue", 0.77)];
  return {
    status: "partial", dimension: "launchLocation", baselineScenario: { productConcept: "Coffee", launchLocation: "London", seedQueries: ["Signal Brand"], targetTypes: ["urn:entity:place"] }, alternativeScenario: { productConcept: "Coffee", launchLocation: "New York", seedQueries: ["Signal Brand"], targetTypes: ["urn:entity:place"] },
    baselineResearch: { analysisId: "a1", status: "completed", scenario: { productConcept: "Coffee", launchLocation: "London", seedQueries: ["Signal Brand"], targetTypes: ["urn:entity:place"] }, resolutions: [{ query: "Signal Brand", status: "resolved", entity: source, candidates: [source] }], evidence: baselineEvidence, graph: { nodes: [], edges: [] }, limitations: [], errors: [], diagnostics: [] },
    alternativeResearch: { analysisId: "a2", status: "partial", scenario: { productConcept: "Coffee", launchLocation: "New York", seedQueries: ["Signal Brand"], targetTypes: ["urn:entity:place"] }, resolutions: [{ query: "Signal Brand", status: "resolved", entity: source, candidates: [source] }], evidence: alternativeEvidence, graph: { nodes: [], edges: [] }, limitations: ["Top-N absence is not cultural absence"], errors: [{ code: "EMPTY_RESULTS", message: "Some results were empty" }], diagnostics: [] },
    comparison: { compared: true, baselineEvidenceCount: 1, alternativeEvidenceCount: 1, baselineGraphEdgeCount: 1, alternativeGraphEdgeCount: 1, sharedEntities: [], baselineOnlyEntities: [], alternativeOnlyEntities: [], sharedRelationships: [], baselineOnlyRelationships: [], alternativeOnlyRelationships: [], changedObservedRelationships: [], evidenceChanges: [], queryContexts: { baseline: [], alternative: [] }, geographicContexts: { baseline: [{ city: "London" }], alternative: [{ city: "New York" }] }, limitations: ["Scores are provider observations"] }, limitations: [], errors: [], strategicInterpretationStatus: "not-requested",
  };
}

test("builds a valid counterfactual submission without a provider call", () => {
  assert.deepEqual(createCounterfactualRequest({ productConcept: " Coffee ", seedQuery: " Signal Brand ", baselineLocation: "London", alternativeLocation: "New York", includeStrategicInterpretation: true }), { baseline: { productConcept: "Coffee", launchLocation: "London", seedQueries: ["Signal Brand"], seedCategory: "brand", requestedOutcome: "Compare cultural associations across launch locations", targetTypes: ["urn:entity:place"] }, modification: { dimension: "launchLocation", originalValue: "London", alternativeValue: "New York" }, includeStrategicInterpretation: true });
});

test("maps only counterfactual-shaped API responses", () => {
  const mapped = mapCounterfactualResponse(result());
  assert.equal(mapped?.baselineScenario.launchLocation, "London");
  assert.equal(mapCounterfactualResponse({ status: "completed" }), undefined);
});

test("keeps evidence attribution independent by market", () => {
  const current = result();
  assert.equal(evidenceForMarket(current, "baseline")[0]?.geographicContext?.city, "London");
  assert.equal(evidenceForMarket(current, "alternative")[0]?.geographicContext?.city, "New York");
});

test("builds stable graph nodes and provider-backed edges", () => {
  const graph = buildStudioGraph(result(), "baseline");
  assert.equal(graph.nodes[0]?.isSignal, true);
  assert.equal(graph.nodes[0]?.providerId, "qloo");
  assert.deepEqual(graph.nodes[0]?.evidenceIds, ["evidence:London:London venue"]);
  assert.equal(graph.nodes[1]?.label, "London venue");
  assert.equal(graph.nodes[1]?.providerId, "qloo");
  assert.equal(graph.edges[0]?.evidenceId, "evidence:London:London venue");
  assert.equal(graph.edges[0]?.providerScore, 0.66);
  assert.deepEqual(buildStudioGraph(result(), "baseline"), graph);
});

test("preserves partial research rather than replacing it with synthetic results", () => {
  const current = result();
  assert.equal(current.status, "partial");
  assert.equal(current.alternativeResearch?.errors[0]?.code, "EMPTY_RESULTS");
  assert.equal(evidenceForMarket(current, "alternative").length, 1);
});

test("strategic interpretation request remains explicit in the submission", () => {
  const request = createCounterfactualRequest({ productConcept: "Coffee", seedQuery: "Signal Brand", baselineLocation: "London", alternativeLocation: "New York", includeStrategicInterpretation: true });
  assert.equal(request.includeStrategicInterpretation, true);
});

test("switching market presentation reuses mapped evidence without a new request", () => {
  const current = result();
  const baselineGraph = buildStudioGraph(current, "baseline");
  const alternativeGraph = buildStudioGraph(current, "alternative");
  assert.notEqual(baselineGraph.edges[0]?.evidenceId, alternativeGraph.edges[0]?.evidenceId);
  assert.equal(evidenceForMarket(current, "baseline").length, 1);
  assert.equal(evidenceForMarket(current, "alternative").length, 1);
});

test("keeps the initial radial graph stable and non-overlapping", () => {
  const current = result();
  current.baselineResearch!.evidence = Array.from({ length: 8 }, (_, index) => evidence("London", "Venue " + index, 0.5 + index / 100));
  const graph = buildStudioGraph(current, "baseline");
  const positions = graph.nodes.map((node) => node.position.x + ":" + node.position.y);
  assert.equal(new Set(positions).size, positions.length);
  const overlaps = (first: typeof graph.nodes[number], second: typeof graph.nodes[number]) => {
    const a = studioGraphNodeFootprint(first);
    const b = studioGraphNodeFootprint(second);
    return first.position.x < second.position.x + b.width && first.position.x + a.width > second.position.x && first.position.y < second.position.y + b.height && first.position.y + a.height > second.position.y;
  };
  for (let first = 0; first < graph.nodes.length; first += 1) {
    for (let second = first + 1; second < graph.nodes.length; second += 1) {
      const dx = graph.nodes[first]!.position.x - graph.nodes[second]!.position.x;
      const dy = graph.nodes[first]!.position.y - graph.nodes[second]!.position.y;
      assert.ok(Math.hypot(dx, dy) > 1, "radial nodes must not share a position");
      assert.equal(overlaps(graph.nodes[first]!, graph.nodes[second]!), false, "full node footprints must not overlap");
    }
  }
  assert.deepEqual(buildStudioGraph(current, "baseline"), graph);
});

test("places the signal at the center of the radial footprint and spaces six entities evenly", () => {
  const current = result();
  current.baselineResearch!.evidence = Array.from({ length: 6 }, (_, index) => evidence("London", "Venue " + index, 0.5 + index / 100));
  const graph = buildStudioGraph(current, "baseline");
  const signal = graph.nodes[0]!;
  const signalFootprint = studioGraphNodeFootprint(signal);
  const center = { x: signal.position.x + signalFootprint.width / 2, y: signal.position.y + signalFootprint.height / 2 };
  assert.deepEqual(center, { x: 460, y: 265 });
  const angles = graph.nodes.slice(1).map((node) => Math.atan2((node.position.y + 72 - center.y) / 288, (node.position.x + 90 - center.x) / 390)).sort((first, second) => first - second);
  const gaps = angles.slice(1).map((angle, index) => angle - angles[index]!);
  gaps.push(angles[0]! + Math.PI * 2 - angles.at(-1)!);
  assert.ok(gaps.every((gap) => Math.abs(gap - Math.PI / 3) < 0.01));
});

test("keeps six-node bounds finite and calculates a usable viewport for the graph canvas", () => {
  const current = result();
  current.baselineResearch!.evidence = Array.from({ length: 6 }, (_, index) => evidence("London", "Venue " + index, 0.5 + index / 100));
  const graph = buildStudioGraph(current, "baseline");
  const bounds = studioGraphBounds(graph.nodes);
  assert.ok([bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite));
  const viewport = calculateStudioGraphViewport(bounds, 760, 455);
  assert.ok(viewport);
  assert.ok([viewport.x, viewport.y, viewport.zoom].every(Number.isFinite));
  assert.ok(viewport.zoom >= 0.45 && viewport.zoom <= 0.95);
  assert.ok(bounds.x * viewport.zoom + viewport.x >= 0);
  assert.ok((bounds.x + bounds.width) * viewport.zoom + viewport.x <= 760);
  assert.ok(bounds.y * viewport.zoom + viewport.y >= 0);
  assert.ok((bounds.y + bounds.height) * viewport.zoom + viewport.y <= 455);
});

test("frames baseline and alternative graphs from the same centered layout contract", () => {
  const current = result();
  current.baselineResearch!.evidence = Array.from({ length: 6 }, (_, index) => evidence("London", "London venue " + index, 0.5 + index / 100));
  current.alternativeResearch!.evidence = Array.from({ length: 6 }, (_, index) => evidence("New York", "New York venue " + index, 0.6 + index / 100));
  const baseline = buildStudioGraph(current, "baseline");
  const alternative = buildStudioGraph(current, "alternative");
  assert.deepEqual(baseline.nodes[0]?.position, alternative.nodes[0]?.position);
  assert.equal(studioGraphForDisplay(baseline).nodes.length, 7);
  assert.equal(studioGraphForDisplay(alternative).nodes.length, 7);
});

test("expanded graphs recompute spacing for all entities instead of crowding the ring", () => {
  const current = result();
  current.baselineResearch!.evidence = Array.from({ length: 8 }, (_, index) => evidence("London", "Venue " + index, 0.5 + index / 100));
  const graph = buildStudioGraph(current, "baseline");
  for (let first = 0; first < graph.nodes.length; first += 1) {
    for (let second = first + 1; second < graph.nodes.length; second += 1) {
      const a = studioGraphNodeFootprint(graph.nodes[first]!);
      const b = studioGraphNodeFootprint(graph.nodes[second]!);
      const overlaps = graph.nodes[first]!.position.x < graph.nodes[second]!.position.x + b.width && graph.nodes[first]!.position.x + a.width > graph.nodes[second]!.position.x && graph.nodes[first]!.position.y < graph.nodes[second]!.position.y + b.height && graph.nodes[first]!.position.y + a.height > graph.nodes[second]!.position.y;
      assert.equal(overlaps, false);
    }
  }
});

test("shows six associated entities initially while retaining remaining graph evidence", () => {
  const current = result();
  current.baselineResearch!.evidence = Array.from({ length: 8 }, (_, index) => evidence("London", "Venue " + index, 0.5 + index / 100));
  const graph = buildStudioGraph(current, "baseline");
  const initial = studioGraphForDisplay(graph);
  const expanded = studioGraphForDisplay(graph, true);
  assert.equal(initial.nodes.length, 7);
  assert.equal(initial.remainingEntityCount, 2);
  assert.equal(expanded.nodes.length, 9);
  assert.equal(expanded.remainingEntityCount, 0);
  assert.equal(expanded.edges.length, 8);
});

test("graph selection points back to an evidence item in the same market", () => {
  const current = result();
  const graph = buildStudioGraph(current, "alternative");
  const selectedEvidenceId = graph.nodes[1]?.evidenceIds[0];
  assert.ok(selectedEvidenceId);
  assert.equal(evidenceForMarket(current, "alternative").some((item) => item.id === selectedEvidenceId), true);
});
