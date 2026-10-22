import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";

export type StudioMarket = "baseline" | "alternative";
export const RESEARCH_TARGET_PLACE = "urn:entity:place" as const;
export const RESEARCH_TARGET_BRAND = "urn:entity:brand" as const;
export type ResearchTarget = typeof RESEARCH_TARGET_PLACE | typeof RESEARCH_TARGET_BRAND;
export const RESEARCH_TARGET_OPTIONS: ReadonlyArray<{ label: string; value: ResearchTarget }> = [
  { label: "Places", value: RESEARCH_TARGET_PLACE },
  { label: "Brands", value: RESEARCH_TARGET_BRAND },
];
export type StudioScenarioInput = {
  productConcept: string;
  seedQuery: string;
  baselineLocation: string;
  alternativeLocation: string;
  includeStrategicInterpretation: boolean;
  /** Optional for compatibility with saved analyses created before target selection. */
  researchTarget?: ResearchTarget;
};

export const CULTURAL_CONNECTIONS_LABEL = "Top Cultural Connections";

export function normalizeResearchTarget(target: string | undefined): ResearchTarget {
  return target === RESEARCH_TARGET_BRAND ? RESEARCH_TARGET_BRAND : RESEARCH_TARGET_PLACE;
}

export function createCounterfactualRequest(input: StudioScenarioInput) {
  return {
    baseline: {
      productConcept: input.productConcept.trim(),
      launchLocation: input.baselineLocation.trim(),
      seedQueries: [input.seedQuery.trim()],
      seedCategory: "brand" as const,
      requestedOutcome: "Compare cultural associations across launch locations",
      targetTypes: [normalizeResearchTarget(input.researchTarget)],
    },
    modification: {
      dimension: "launchLocation" as const,
      originalValue: input.baselineLocation.trim(),
      alternativeValue: input.alternativeLocation.trim(),
    },
    includeStrategicInterpretation: input.includeStrategicInterpretation,
  };
}

export function evidenceForMarket(result: CounterfactualResult, market: StudioMarket): CulturalEvidence[] {
  return market === "baseline" ? (result.baselineResearch?.evidence ?? []) : (result.alternativeResearch?.evidence ?? []);
}

export function locationForMarket(result: CounterfactualResult, market: StudioMarket): string {
  return market === "baseline" ? (result.baselineScenario.launchLocation ?? "Baseline") : (result.alternativeScenario.launchLocation ?? "Alternative");
}

function researchForMarket(result: CounterfactualResult, market: StudioMarket) {
  return market === "baseline" ? result.baselineResearch : result.alternativeResearch;
}

export function targetTypeLabel(targetType: string | undefined): string {
  return targetType?.startsWith("urn:entity:") ? targetType.slice("urn:entity:".length) : targetType ?? "unavailable";
}

export function researchTargetForResult(result: CounterfactualResult): ResearchTarget {
  const evidence = [...(result.baselineResearch?.evidence ?? []), ...(result.alternativeResearch?.evidence ?? [])].find((item) => item.kind === "affinity");
  const targetType = evidence?.kind === "affinity" ? evidence.queryParameters["filter.type"] : result.baselineResearch?.plan?.targetTypes[0];
  return normalizeResearchTarget(targetType);
}

export function continuityLabelForTarget(target: ResearchTarget): "Destination Continuity" | "Entity Continuity" {
  return target === RESEARCH_TARGET_PLACE ? "Destination Continuity" : "Entity Continuity";
}

export function researchScopeForMarket(result: CounterfactualResult, market: StudioMarket): {
  signal: string;
  city: string;
  targetType: string;
  provider: string;
  ordering: string;
} {
  const research = researchForMarket(result, market);
  const evidence = evidenceForMarket(result, market);
  const firstAffinity = evidence.find((item) => item.kind === "affinity");
  const signal = research?.resolutions.find((resolution) => resolution.entity)?.entity?.name
    ?? (firstAffinity?.kind === "affinity" ? firstAffinity.subjectEntityName : undefined)
    ?? "Cultural signal";
  const targetType = firstAffinity?.kind === "affinity"
    ? firstAffinity.queryParameters["filter.type"]
    : research?.plan?.targetTypes[0];
  const provider = firstAffinity?.provenance.providerId ?? "unavailable";
  const ordering = firstAffinity?.kind === "affinity" && firstAffinity.queryParameters.sort_by
    ? firstAffinity.queryParameters.sort_by
    : "provider order";
  return { signal, city: locationForMarket(result, market), targetType: targetTypeLabel(targetType), provider, ordering };
}

export function providerExplanationText(value: Record<string, unknown> | undefined): string | undefined {
  if (!value) return undefined;
  const textKeys = ["text", "description", "explanation", "reason", "summary"];
  for (const key of textKeys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
  }
  return undefined;
}

export type StudioGraphNode = {
  id: string;
  label: string;
  category: string;
  entityId: string;
  evidenceIds: string[];
  providerId?: string;
  isSignal: boolean;
  position: { x: number; y: number };
};

export type StudioGraphEdge = { id: string; source: string; target: string; evidenceId: string; providerScore?: number };
export const STUDIO_INITIAL_ENTITY_LIMIT = 6;
export const STUDIO_GRAPH_NODE_WIDTH = 180;
export const STUDIO_GRAPH_ENTITY_HEIGHT = 144;
export const STUDIO_GRAPH_SIGNAL_HEIGHT = 184;
export const STUDIO_GRAPH_FIT_PADDING = 0.14;
export const STUDIO_GRAPH_MIN_ZOOM = 0.18;
export const STUDIO_GRAPH_MAX_ZOOM = 0.95;

type StudioGraphFootprint = { width: number; height: number };

export function studioGraphNodeFootprint(node: Pick<StudioGraphNode, "isSignal">): StudioGraphFootprint {
  return { width: STUDIO_GRAPH_NODE_WIDTH, height: node.isSignal ? STUDIO_GRAPH_SIGNAL_HEIGHT : STUDIO_GRAPH_ENTITY_HEIGHT };
}

export type StudioGraphBounds = { x: number; y: number; width: number; height: number };
export type StudioGraphViewport = { x: number; y: number; zoom: number };

export function studioGraphBounds(nodes: StudioGraphNode[]): StudioGraphBounds {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const boxes = nodes.map((node) => {
    const footprint = studioGraphNodeFootprint(node);
    return { x: node.position.x, y: node.position.y, x2: node.position.x + footprint.width, y2: node.position.y + footprint.height };
  });
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const x2 = Math.max(...boxes.map((box) => box.x2));
  const y2 = Math.max(...boxes.map((box) => box.y2));
  return { x, y, width: x2 - x, height: y2 - y };
}

export function calculateStudioGraphViewport(bounds: StudioGraphBounds, width: number, height: number, padding = STUDIO_GRAPH_FIT_PADDING, maxZoom = STUDIO_GRAPH_MAX_ZOOM): StudioGraphViewport | undefined {
  if (![bounds.x, bounds.y, bounds.width, bounds.height, width, height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 || width <= 0 || height <= 0) return undefined;
  const zoom = Math.min(width / ((1 + padding) * bounds.width), height / ((1 + padding) * bounds.height));
  // Never force a minimum zoom that clips graph bounds. Smaller zoom is
  // preferable to sending evidence offscreen when the panel is narrow.
  const clampedZoom = Math.min(maxZoom, zoom);
  return { x: width / 2 - (bounds.x + bounds.width / 2) * clampedZoom, y: height / 2 - (bounds.y + bounds.height / 2) * clampedZoom, zoom: clampedZoom };
}

// Positions are logical canvas coordinates, not screen coordinates. Visible graph
// nodes are laid out AFTER applying the top-six filter (see studioGraphForDisplay).
function layoutStudioNodes(nodes: StudioGraphNode[]): StudioGraphNode[] {
  const entities = nodes.filter((node) => !node.isSignal);
  const count = entities.length;
  const centerX = 460;
  const centerY = 265;
  const signal = nodes.find((node) => node.isSignal);
  const positioned: StudioGraphNode[] = [];
  if (signal) {
    const size = studioGraphNodeFootprint(signal);
    positioned.push({ ...signal, position: { x: centerX - size.width / 2, y: centerY - size.height / 2 } });
  }
  // Six entities fit one readable ellipse. Additional results are arranged in
  // concentric rings so expansion does not squeeze every label into one ring.
  entities.forEach((entity, index) => {
    const inner = count <= STUDIO_INITIAL_ENTITY_LIMIT || index < STUDIO_INITIAL_ENTITY_LIMIT;
    const ringIndex = inner ? index : index - STUDIO_INITIAL_ENTITY_LIMIT;
    const ringCount = inner ? Math.min(count, STUDIO_INITIAL_ENTITY_LIMIT) : count - STUDIO_INITIAL_ENTITY_LIMIT;
    const angle = -Math.PI / 2 + ringIndex * (Math.PI * 2 / Math.max(ringCount, 1));
    const radiusX = inner ? 390 : Math.max(800, ringCount * 52);
    const radiusY = inner ? 288 : Math.max(650, ringCount * 38);
    const size = studioGraphNodeFootprint(entity);
    positioned.push({ ...entity, position: {
      x: centerX + Math.cos(angle) * radiusX - size.width / 2,
      y: centerY + Math.sin(angle) * radiusY - size.height / 2,
    } });
  });
  return positioned;
}

export function buildStudioGraph(result: CounterfactualResult, market: StudioMarket): { nodes: StudioGraphNode[]; edges: StudioGraphEdge[] } {
  const evidence = evidenceForMarket(result, market).filter((item): item is Extract<CulturalEvidence, { kind: "affinity" }> => item.kind === "affinity");
  const research = market === "baseline" ? result.baselineResearch : result.alternativeResearch;
  const seed = research?.resolutions.find((item) => item.entity)?.entity;
  const signalId = seed?.id ?? evidence[0]?.subjectEntityId ?? "signal:unresolved";
  const signalName = seed?.name ?? evidence[0]?.subjectEntityName ?? "Cultural signal";
  const signalEvidenceIds = evidence.filter((item) => item.subjectEntityId === signalId).map((item) => item.id);
  const nodes: StudioGraphNode[] = [{ id: signalId, entityId: signalId, label: signalName, category: seed?.category ?? evidence[0]?.subjectEntityCategory ?? "unknown", evidenceIds: signalEvidenceIds, providerId: seed?.providerId ?? evidence[0]?.provenance.providerId, isSignal: true, position: { x: 0, y: 0 } }];
  const entityIds = new Set<string>([signalId]);
  const edges: StudioGraphEdge[] = [];
  evidence.forEach((item) => {
    if (!entityIds.has(item.objectEntityId)) {
      entityIds.add(item.objectEntityId);
      nodes.push({ id: item.objectEntityId, entityId: item.objectEntityId, label: item.objectEntityName ?? item.objectEntityId, category: item.objectEntityCategory, evidenceIds: [item.id], providerId: item.provenance.providerId, isSignal: false, position: { x: 0, y: 0 } });
    } else {
      const node = nodes.find((candidate) => candidate.id === item.objectEntityId);
      if (node && !node.evidenceIds.includes(item.id)) node.evidenceIds.push(item.id);
    }
    edges.push({ id: `edge:${item.id}`, source: signalId, target: item.objectEntityId, evidenceId: item.id, providerScore: item.providerScore });
  });
  return { nodes: layoutStudioNodes(nodes), edges };
}

export function studioGraphForDisplay(graph: { nodes: StudioGraphNode[]; edges: StudioGraphEdge[] }, showAll = false, limit = STUDIO_INITIAL_ENTITY_LIMIT): { nodes: StudioGraphNode[]; edges: StudioGraphEdge[]; remainingEntityCount: number } {
  const visibleNodes = layoutStudioNodes(showAll ? graph.nodes : graph.nodes.slice(0, limit + 1));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  return { nodes: visibleNodes, edges: graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)), remainingEntityCount: Math.max(0, graph.nodes.length - visibleNodes.length) };
}

export function strategicReferences(result: CounterfactualResult): Array<{ evidenceId: string; market: string }> {
  return result.strategicInterpretation?.supportingEvidenceReferences ?? [];
}

export function mapCounterfactualResponse(input: unknown): CounterfactualResult | undefined {
  if (!input || typeof input !== "object") return undefined;
  const candidate = input as Partial<CounterfactualResult>;
  return candidate.comparison && candidate.status && candidate.baselineScenario && candidate.alternativeScenario
    ? candidate as CounterfactualResult
    : undefined;
}
