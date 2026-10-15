import { z } from "zod";
import { EntityCategorySchema, type EntityCategory, type GeographicContext } from "@/core/entities/types";
import type { CulturalEvidence, EvidenceProvenance } from "@/core/evidence/types";
import type { EvidenceRegistry } from "@/core/evidence/registry";

export const EvidenceGraphEdgeSchema = z.object({
  id: z.string().trim().min(1),
  evidenceId: z.string().trim().min(1),
  kind: z.literal("provider-affinity"),
  subjectEntityId: z.string().trim().min(1),
  subjectEntityCategory: EntityCategorySchema,
  objectEntityId: z.string().trim().min(1),
  objectEntityCategory: EntityCategorySchema,
  providerScore: z.number().finite(),
  geographicContext: z.object({
    countryCode: z.string().length(2).optional(),
    region: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    latitude: z.number().finite().optional(),
    longitude: z.number().finite().optional(),
  }).optional(),
  provenance: z.object({
    providerId: z.string().trim().min(1),
    sourceReference: z.string().trim().min(1),
    retrievedAt: z.iso.datetime(),
  }),
});

export type EvidenceGraphEdge = z.infer<typeof EvidenceGraphEdgeSchema>;

export type EvidenceGraph = {
  nodes: Array<{ id: string; category: EntityCategory }>;
  edges: EvidenceGraphEdge[];
};

function edgeFromEvidence(evidence: Extract<CulturalEvidence, { kind: "affinity" }>): EvidenceGraphEdge {
  return {
    id: `edge:${evidence.id}`,
    evidenceId: evidence.id,
    kind: "provider-affinity",
    subjectEntityId: evidence.subjectEntityId,
    subjectEntityCategory: evidence.subjectEntityCategory,
    objectEntityId: evidence.objectEntityId,
    objectEntityCategory: evidence.objectEntityCategory,
    providerScore: evidence.providerScore as number,
    geographicContext: evidence.geographicContext,
    provenance: evidence.provenance,
  };
}

/** Builds evidence edges only from evidence accepted by EvidenceRegistry. */
export function buildEvidenceGraph(registry: EvidenceRegistry): EvidenceGraph {
  const edges = registry.listValidatedEvidence()
    .filter((evidence): evidence is Extract<CulturalEvidence, { kind: "affinity" }> => evidence.kind === "affinity")
    .map(edgeFromEvidence);
  const nodes = new Map<string, { id: string; category: EntityCategory }>();
  for (const edge of edges) {
    nodes.set(edge.subjectEntityId, { id: edge.subjectEntityId, category: edge.subjectEntityCategory });
    nodes.set(edge.objectEntityId, { id: edge.objectEntityId, category: edge.objectEntityCategory });
  }
  return { nodes: [...nodes.values()], edges };
}

export function evidenceProvenance(edge: EvidenceGraphEdge): EvidenceProvenance {
  return edge.provenance;
}

export function evidenceGeography(edge: EvidenceGraphEdge): GeographicContext | undefined {
  return edge.geographicContext;
}
