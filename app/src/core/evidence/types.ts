import { z } from "zod";
import { GeographicContextSchema } from "@/core/entities/types";

export const EvidenceKindSchema = z.enum([
  "affinity",
  "relationship",
  "explanation",
  "interpretation",
]);

export const EvidenceProvenanceSchema = z.object({
  providerId: z.string().trim().min(1),
  sourceReference: z.string().trim().min(1),
  retrievedAt: z.iso.datetime(),
});

export const AffinityEvidenceSchema = z.object({
  kind: z.literal("affinity"),
  subjectEntityId: z.string().trim().min(1),
  objectEntityId: z.string().trim().min(1),
  objectEntityName: z.string().trim().min(1).optional(),
  providerScore: z.number().finite().optional(),
  providerScoreLabel: z.string().trim().min(1).optional(),
  providerScoreScale: z.string().trim().min(1).optional(),
  explainability: z.record(z.string(), z.unknown()).optional(),
  geographicContext: GeographicContextSchema.optional(),
  queryParameters: z.record(z.string(), z.string()),
  provenance: EvidenceProvenanceSchema,
  interpretation: z.string().trim().min(1).optional(),
  verified: z.boolean().default(true),
});

export const CulturalEvidenceSchema = z.discriminatedUnion("kind", [
  AffinityEvidenceSchema,
]);

export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>;
export type AffinityEvidence = z.infer<typeof AffinityEvidenceSchema>;
export type CulturalEvidence = z.infer<typeof CulturalEvidenceSchema>;

export type UnsupportedClaim = {
  claim: string;
  reason: "unsupported" | "unverified" | "insufficient-evidence";
  relatedEvidenceIds?: string[];
};

export type AIInterpretation = {
  text: string;
  basis: string[];
  caveats: string[];
  generatedAt: string;
};
