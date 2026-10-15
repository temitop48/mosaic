import { z } from "zod";

export const RelationshipTypeSchema = z.enum([
  "similar-to",
  "associated-with",
  "located-in",
  "influences",
  "related-to",
]);

export const CulturalRelationshipSchema = z.object({
  id: z.string().trim().min(1),
  subjectEntityId: z.string().trim().min(1),
  objectEntityId: z.string().trim().min(1),
  type: RelationshipTypeSchema,
  provenance: z.object({
    providerId: z.string().trim().min(1),
    sourceReference: z.string().trim().min(1),
    retrievedAt: z.iso.datetime(),
  }),
  evidenceSummary: z.string().trim().min(1).optional(),
  verified: z.boolean().default(true),
});

export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;
export type CulturalRelationship = z.infer<typeof CulturalRelationshipSchema>;
