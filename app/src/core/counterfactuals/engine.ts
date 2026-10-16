import type { DecisionEngine } from "@/agent/engine";
import type { AnalysisResult } from "@/agent/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";
import {
  CounterfactualRequestSchema,
  type CounterfactualComparison,
  type CounterfactualEntityReference,
  type CounterfactualEvidenceObservation,
  type CounterfactualRelationship,
  type CounterfactualResult,
  type CounterfactualRequest,
} from "@/core/counterfactuals/contracts";

const emptyComparison = (): CounterfactualComparison => ({
  compared: false, baselineEvidenceCount: 0, alternativeEvidenceCount: 0, baselineGraphEdgeCount: 0, alternativeGraphEdgeCount: 0,
  sharedEntities: [], baselineOnlyEntities: [], alternativeOnlyEntities: [], sharedRelationships: [], baselineOnlyRelationships: [], alternativeOnlyRelationships: [], changedObservedRelationships: [],
  queryContexts: { baseline: [], alternative: [] }, geographicContexts: { baseline: [], alternative: [] }, limitations: [],
});

function invalidResult(message: string, code: "INVALID_REQUEST" | "UNSUPPORTED_DIMENSION" = "INVALID_REQUEST"): CounterfactualResult {
  const empty = { productConcept: "", launchLocation: "", seedQueries: [], targetTypes: [] };
  return { status: "failed", dimension: "launchLocation", baselineScenario: empty, alternativeScenario: empty, comparison: emptyComparison(), limitations: [], errors: [{ code, message }] };
}

function entityKey(entity: CounterfactualEntityReference): string { return `${entity.providerId}\u0000${entity.category}\u0000${entity.id}`; }

function entityReferences(result: AnalysisResult): CounterfactualEntityReference[] {
  const entities = new Map<string, CounterfactualEntityReference>();
  for (const resolution of result.resolutions) {
    if (!resolution.entity) continue;
    const entity = { providerId: resolution.entity.providerId, id: resolution.entity.id, category: resolution.entity.category, name: resolution.entity.name };
    entities.set(entityKey(entity), entity);
  }
  for (const evidence of result.evidence) {
    if (evidence.kind !== "affinity") continue;
    const source = { providerId: evidence.provenance.providerId, id: evidence.subjectEntityId, category: evidence.subjectEntityCategory, name: evidence.subjectEntityName };
    const target = { providerId: evidence.provenance.providerId, id: evidence.objectEntityId, category: evidence.objectEntityCategory, name: evidence.objectEntityName };
    entities.set(entityKey(source), source);
    entities.set(entityKey(target), target);
  }
  return [...entities.values()];
}

function observation(evidence: Extract<CulturalEvidence, { kind: "affinity" }>): CounterfactualEvidenceObservation {
  return { evidenceId: evidence.id, providerId: evidence.provenance.providerId, subjectEntityId: evidence.subjectEntityId, subjectEntityCategory: evidence.subjectEntityCategory, objectEntityId: evidence.objectEntityId, objectEntityCategory: evidence.objectEntityCategory, providerScore: evidence.providerScore, geographicContext: evidence.geographicContext, queryParameters: evidence.queryParameters, retrievedAt: evidence.provenance.retrievedAt };
}

function relationshipKey(value: CounterfactualRelationship): string { return `${value.providerId}\u0000${value.subjectEntityCategory}\u0000${value.subjectEntityId}\u0000${value.objectEntityCategory}\u0000${value.objectEntityId}`; }

function relationships(result: AnalysisResult): CounterfactualRelationship[] {
  const values = new Map<string, CounterfactualRelationship>();
  for (const evidence of result.evidence) {
    if (evidence.kind !== "affinity") continue;
    const item = observation(evidence);
    const relationship: CounterfactualRelationship = { providerId: item.providerId, subjectEntityId: item.subjectEntityId, subjectEntityCategory: item.subjectEntityCategory, objectEntityId: item.objectEntityId, objectEntityCategory: item.objectEntityCategory, baseline: item };
    if (!values.has(relationshipKey(relationship))) values.set(relationshipKey(relationship), relationship);
  }
  return [...values.values()];
}

function contexts(result: AnalysisResult): { queries: Array<Record<string, string>>; geography: NonNullable<CounterfactualComparison["geographicContexts"]>["baseline"] } {
  const affinity = result.evidence.filter((item) => item.kind === "affinity");
  const unique = <T>(items: T[]): T[] => [...new Map(items.map((item) => [JSON.stringify(item), item])).values()];
  return { queries: unique(affinity.map((item) => item.queryParameters)), geography: unique(affinity.flatMap((item) => item.geographicContext ? [item.geographicContext] : [])) };
}

function compareResearch(baseline: AnalysisResult, alternative: AnalysisResult): CounterfactualComparison {
  const comparison = emptyComparison();
  comparison.baselineEvidenceCount = baseline.evidence.length;
  comparison.alternativeEvidenceCount = alternative.evidence.length;
  comparison.baselineGraphEdgeCount = baseline.graph.edges.length;
  comparison.alternativeGraphEdgeCount = alternative.graph.edges.length;
  const baselineContext = contexts(baseline);
  const alternativeContext = contexts(alternative);
  comparison.queryContexts = { baseline: baselineContext.queries, alternative: alternativeContext.queries };
  comparison.geographicContexts = { baseline: baselineContext.geography, alternative: alternativeContext.geography };
  if (baseline.evidence.length === 0 || alternative.evidence.length === 0) {
    comparison.limitations.push("Comparison sets were not produced because one research side has no validated evidence.");
    comparison.limitations.push("Absence from an empty or top-N result set is not evidence that an underlying relationship does not exist.");
    return comparison;
  }
  comparison.compared = true;
  const baselineEntities = new Map(entityReferences(baseline).map((entity) => [entityKey(entity), entity]));
  const alternativeEntities = new Map(entityReferences(alternative).map((entity) => [entityKey(entity), entity]));
  comparison.sharedEntities = [...baselineEntities.keys()].filter((key) => alternativeEntities.has(key)).map((key) => baselineEntities.get(key) as CounterfactualEntityReference);
  comparison.baselineOnlyEntities = [...baselineEntities.keys()].filter((key) => !alternativeEntities.has(key)).map((key) => baselineEntities.get(key) as CounterfactualEntityReference);
  comparison.alternativeOnlyEntities = [...alternativeEntities.keys()].filter((key) => !baselineEntities.has(key)).map((key) => alternativeEntities.get(key) as CounterfactualEntityReference);
  const baselineRelationships = new Map(relationships(baseline).map((relationship) => [relationshipKey(relationship), relationship]));
  const alternativeRelationships = new Map(relationships(alternative).map((relationship) => [relationshipKey(relationship), relationship]));
  for (const [key, relationship] of baselineRelationships) {
    const alternative = alternativeRelationships.get(key);
    if (!alternative) {
      comparison.baselineOnlyRelationships.push(relationship);
      continue;
    }
    const shared = { ...relationship, baseline: relationship.baseline, alternative: alternative.baseline };
    comparison.sharedRelationships.push(shared);
    if (relationship.baseline?.providerScore !== alternative.baseline?.providerScore || JSON.stringify(relationship.baseline?.queryParameters) !== JSON.stringify(alternative.baseline?.queryParameters)) comparison.changedObservedRelationships.push(shared);
  }
  for (const [key, relationship] of alternativeRelationships) if (!baselineRelationships.has(key)) comparison.alternativeOnlyRelationships.push({ ...relationship, baseline: undefined, alternative: relationship.baseline });
  comparison.limitations.push("Provider affinity scores remain separate observations for separate geographic queries and are not universal market-fit scores.");
  comparison.limitations.push("Relative result-set differences do not establish demand, commercial suitability, partnership or causation.");
  comparison.limitations.push("Top-N absence is not evidence that an underlying cultural relationship is absent.");
  if (comparison.geographicContexts.baseline.length === 0 || comparison.geographicContexts.alternative.length === 0) comparison.limitations.push("Qloo returned no geographic metadata for at least one side; the location query was retained, but no geographic context was inferred.");
  return comparison;
}

export class CounterfactualResearchEngine {
  private readonly researchEngine: DecisionEngine;

  constructor(researchEngine: DecisionEngine) { this.researchEngine = researchEngine; }

  async compare(input: CounterfactualRequest | unknown): Promise<CounterfactualResult> {
    const parsed = CounterfactualRequestSchema.safeParse(input);
    if (!parsed.success) return invalidResult(parsed.error.issues[0]?.message ?? "Invalid counterfactual request");
    const request = parsed.data;
    if (request.modification.dimension !== "launchLocation") return invalidResult(`Unsupported counterfactual dimension: ${request.modification.dimension}`, "UNSUPPORTED_DIMENSION");
    const alternativeScenario = { ...request.baseline, launchLocation: request.modification.alternativeValue };
    const baselineResearch = await this.researchEngine.research(request.baseline);
    const alternativeResearch = await this.researchEngine.research(alternativeScenario);
    const comparison = compareResearch(baselineResearch, alternativeResearch);
    const limitations = [...comparison.limitations, ...baselineResearch.limitations, ...alternativeResearch.limitations];
    const errors: CounterfactualResult["errors"] = [];
    if (baselineResearch.errors.length) errors.push({ code: "RESEARCH_FAILURE", message: "Baseline research returned provider or validation errors" });
    if (alternativeResearch.errors.length) errors.push({ code: "RESEARCH_FAILURE", message: "Alternative research returned provider or validation errors" });
    if (!comparison.compared) errors.push({ code: "INSUFFICIENT_EVIDENCE", message: "Both locations require validated evidence before a comparison can be made" });
    return { status: errors.length ? "partial" : "completed", dimension: "launchLocation", baselineScenario: request.baseline, alternativeScenario, baselineResearch, alternativeResearch, comparison, limitations: [...new Set(limitations)], errors };
  }
}
