import assert from "node:assert/strict";
import test from "node:test";
import { DecisionEngine } from "@/agent/engine";
import type { StrategicModelResult, StructuredModelProvider } from "@/agent/model";
import { CounterfactualResearchEngine } from "@/core/counterfactuals/engine";
import type { CulturalEntity } from "@/core/entities/types";
import type { CulturalEvidence } from "@/core/evidence/types";
import type { CulturalIntelligenceProvider, ProviderCapabilities, ProviderResult } from "@/providers/interfaces/contracts";
import { buildGeminiCounterfactualPrompt } from "@/providers/gemini/adapter";

const capabilities: ProviderCapabilities = { entitySearch: true, affinityDiscovery: true, geographicFiltering: true, affinityExplainability: true, explainability: false };
const source: CulturalEntity = { id: "qloo:brand:source", providerId: "qloo", name: "Example Brand", category: "brand", sourceReference: "qloo:entity:source", metadata: {} };

function evidence(location: string, targetId: string): CulturalEvidence {
  return {
    kind: "affinity", id: `qloo:${location}:${targetId}`, subjectEntityId: source.id, subjectEntityCategory: "brand", subjectEntityName: source.name,
    objectEntityId: targetId, objectEntityCategory: "place", objectEntityName: targetId, providerScore: 0.8,
    geographicContext: { city: location }, queryParameters: { "filter.location.query": location, "filter.type": "urn:entity:place" },
    provenance: { providerId: "qloo", sourceReference: `qloo:insight:${location}:${targetId}`, retrievedAt: "2026-10-15T00:00:00.000Z" }, verified: true,
  };
}

class Provider implements CulturalIntelligenceProvider {
  readonly id = "qloo";
  private readonly emptyAlternative: boolean;
  private readonly failAlternative: boolean;
  constructor(emptyAlternative = false, failAlternative = false) { this.emptyAlternative = emptyAlternative; this.failAlternative = failAlternative; }
  getCapabilities(): ProviderCapabilities { return capabilities; }
  async searchEntities(): Promise<ProviderResult<CulturalEntity[]>> { return { ok: true, data: [source] }; }
  async discoverAffinity(request: { locationQuery?: string }): Promise<ProviderResult<CulturalEvidence[]>> {
    if (request.locationQuery === "New York" && this.failAlternative) return { ok: false, error: { code: "UPSTREAM_ERROR", providerId: this.id, message: "fixture failure" } };
    if (request.locationQuery === "New York" && this.emptyAlternative) return { ok: true, data: [] };
    return { ok: true, data: [evidence(request.locationQuery ?? "", `qloo:place:${request.locationQuery}`)] };
  }
  async explainEvidence(): Promise<ProviderResult<string>> { return { ok: false, error: { code: "UNSUPPORTED_CAPABILITY", providerId: this.id, message: "unsupported" } }; }
}

class StrategicModel implements StructuredModelProvider {
  readonly id = "fixture-model";
  private readonly result: StrategicModelResult;
  constructor(result: StrategicModelResult) { this.result = result; }
  async generateBlueprint(): Promise<never> { throw new Error("not used"); }
  async generateCounterfactualInterpretation(): Promise<StrategicModelResult> { return this.result; }
}

const request = { baseline: { productConcept: "Coffee launch", launchLocation: "London", seedQueries: ["Example Brand"], seedCategory: "brand" as const, targetTypes: ["urn:entity:place"] }, modification: { dimension: "launchLocation", originalValue: "London", alternativeValue: "New York" } };

function interpretation(evidenceIds: string[] = ["qloo:London:qloo:place:London", "qloo:New York:qloo:place:New York"]): StrategicModelResult {
  return { ok: true, interpretation: {
    culturalPossibilities: [{ text: "The two locations expose different cultural possibilities to explore.", classification: "interpretation", market: "comparison", evidenceIds }],
    positioningAndLaunchExecution: [{ text: "Positioning and launch execution should be tested against each local context.", classification: "unverified-suggestion", market: "comparison", evidenceIds: [] }],
    assumptionsToValidate: [{ text: "Local relevance still requires validation.", classification: "unverified-suggestion", market: "comparison", evidenceIds: [] }],
    caveats: ["Affinity is not demand or commercial success."],
  } };
}

function engine(model?: StructuredModelProvider, provider = new Provider()): CounterfactualResearchEngine {
  return new CounterfactualResearchEngine(new DecisionEngine(provider, model, (() => { let i = 0; return () => `analysis:${++i}`; })()));
}

test("returns a valid two-market strategic explanation with traceable references", async () => {
  const result = await engine(new StrategicModel(interpretation())).compare({ ...request, includeStrategicInterpretation: true });
  assert.equal(result.strategicInterpretationStatus, "available");
  assert.equal(result.strategicInterpretation?.culturalPossibilities[0]?.market, "comparison");
  assert.deepEqual(result.strategicInterpretation?.culturalPossibilities[0]?.evidenceIds, ["qloo:London:qloo:place:London", "qloo:New York:qloo:place:New York"]);
});

test("rejects unknown and incorrectly attributed verified references", async () => {
  const unknown = await engine(new StrategicModel(interpretation(["invented:evidence"]))).compare({ ...request, includeStrategicInterpretation: true });
  assert.equal(unknown.strategicInterpretationStatus, "unavailable");
  assert.equal(unknown.strategicInterpretation, undefined);
  const base = interpretation(["qloo:New York:qloo:place:New York"]);
  if (!base.ok) throw new Error("fixture model must be successful");
  const wrongMarket: StrategicModelResult = { ok: true, interpretation: { ...base.interpretation, culturalPossibilities: [{ text: "Verified London observation", classification: "verified-observation", market: "baseline", evidenceIds: ["qloo:New York:qloo:place:New York"] }] } };
  const attributed = await engine(new StrategicModel(wrongMarket)).compare({ ...request, includeStrategicInterpretation: true });
  assert.equal(attributed.strategicInterpretationStatus, "unavailable");
});

test("preserves deterministic research when the model times out or returns 503", async () => {
  for (const error of [{ code: "MODEL_TIMEOUT" as const, message: "timed out" }, { code: "MODEL_UPSTREAM_ERROR" as const, message: "HTTP 503", status: 503 }]) {
    const result = await engine(new StrategicModel({ ok: false, error })).compare({ ...request, includeStrategicInterpretation: true });
    assert.equal(result.strategicInterpretationStatus, "unavailable");
    assert.equal(result.baselineResearch?.evidence.length, 1);
    assert.equal(result.alternativeResearch?.evidence.length, 1);
    assert.equal(result.status, "partial");
  }
});

test("research-only requests do not invoke or return strategic interpretation", async () => {
  const model = new StrategicModel(interpretation());
  const result = await engine(model).compare(request);
  assert.equal(result.strategicInterpretationStatus, "not-requested");
  assert.equal(result.strategicInterpretation, undefined);
});

test("requested interpretation remains optional when Gemini is unavailable", async () => {
  const result = await engine().compare({ ...request, includeStrategicInterpretation: true });
  assert.equal(result.status, "partial");
  assert.equal(result.strategicInterpretationStatus, "unavailable");
  assert.equal(result.strategicInterpretationError?.code, "MODEL_UNAVAILABLE");
  assert.equal(result.baselineResearch?.evidence.length, 1);
  assert.equal(result.alternativeResearch?.evidence.length, 1);
  assert.equal(result.comparison.compared, true);
});

test("empty shared sets and empty alternative evidence remain explicit", async () => {
  const result = await engine(new StrategicModel(interpretation()), new Provider(true)).compare({ ...request, includeStrategicInterpretation: true });
  assert.equal(result.comparison.sharedEntities.length, 0);
  assert.equal(result.comparison.compared, false);
  assert.equal(result.baselineResearch?.evidence.length, 1);
  assert.equal(result.alternativeResearch?.evidence.length, 0);
  assert.match(result.comparison.limitations.join(" "), /top-N result set/i);
});

test("strategic prompt forbids demand, partnership, and fabricated cultural claims", () => {
  const prompt = buildGeminiCounterfactualPrompt({ productConcept: "coffee", baselineLocation: "London", alternativeLocation: "New York", comparison: { compared: false, baselineEvidenceCount: 0, alternativeEvidenceCount: 0, baselineGraphEdgeCount: 0, alternativeGraphEdgeCount: 0, sharedEntities: [], baselineOnlyEntities: [], alternativeOnlyEntities: [], sharedRelationships: [], baselineOnlyRelationships: [], alternativeOnlyRelationships: [], changedObservedRelationships: [], evidenceChanges: [], queryContexts: { baseline: [], alternative: [] }, geographicContexts: { baseline: [], alternative: [] }, limitations: [] }, evidence: [] });
  assert.match(prompt, /Do not invent cultural relationships/);
  assert.match(prompt, /demand, commercial success, partnerships/);
  assert.match(prompt, /top-N absence/);
});
