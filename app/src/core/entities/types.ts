import { z } from "zod";

export const EntityCategorySchema = z.enum([
  "person",
  "place",
  "brand",
  "media",
  "organization",
  "event",
  "food",
  "unknown",
]);

export const GeographicContextSchema = z.object({
  countryCode: z.string().length(2).toUpperCase().optional(),
  region: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  latitude: z.number().finite().optional(),
  longitude: z.number().finite().optional(),
});

export const CulturalEntitySchema = z.object({
  id: z.string().trim().min(1),
  providerId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  category: EntityCategorySchema,
  geographicContext: GeographicContextSchema.optional(),
  sourceReference: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type EntityCategory = z.infer<typeof EntityCategorySchema>;
export type GeographicContext = z.infer<typeof GeographicContextSchema>;
export type CulturalEntity = z.infer<typeof CulturalEntitySchema>;
