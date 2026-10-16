import { z } from "zod";
import { EntityCategorySchema, type CulturalEntity, type EntityCategory } from "@/core/entities/types";
import type { CulturalEvidence } from "@/core/evidence/types";
import type { EvidenceGraph } from "@/core/evidence/graph";

export const LaunchScenarioInputSchema = z.object({
  text: z.string().trim().min(1).max(2_000).optional(),
  productConcept: z.string().trim().min(1).max(300).optional(),
  launchLocation: z.string().trim().min(1).max(160).optional(),
  seedQueries: z.array(z.string().trim().min(1).max(120)).max(3).optional(),
  seedCategory: EntityCategorySchema.optional(),
  seedEntityId: z.string().trim().min(1).max(200).optional(),
  requestedOutcome: z.string().trim().min(1).max(300).optional(),
  targetTypes: z.array(z.string().trim().min(1).max(80)).max(3).optional(),
}).refine((value) => Boolean(value.text || value.productConcept), {
  message: "Provide a launch scenario as text or a product concept",
});

export type LaunchScenarioInput = z.infer<typeof LaunchScenarioInputSchema>;

export type LaunchScenario = {
  productConcept: string;
  launchLocation?: string;
  seedQueries: string[];
  seedCategory?: EntityCategory;
  seedEntityId?: string;
  requestedOutcome?: string;
  targetTypes: string[];
  sourceText?: string;
};

export type ResearchPlan = {
  seedQueries: string[];
  seedCategory?: EntityCategory;
  seedEntityId?: string;
  targetTypes: string[];
  locationQuery?: string;
  maxEntityResults: number;
  maxAffinityResults: number;
  explainability: boolean;
  limitations: string[];
};

export type EntityResolution = {
  query: string;
  status: "resolved" | "ambiguous" | "not-found";
  entity?: CulturalEntity;
  candidates: CulturalEntity[];
};

export const BlueprintClaimSchema = z.object({
  text: z.string().trim().min(1).max(500),
  classification: z.enum(["verified-observation", "interpretation", "unverified-suggestion"]),
  evidenceIds: z.array(z.string().trim().min(1)).max(10),
  subjectEntityId: z.string().trim().min(1).optional(),
  objectEntityId: z.string().trim().min(1).optional(),
});

export const BlueprintSectionSchema = z.object({
  claims: z.array(BlueprintClaimSchema).max(10),
});

export const LaunchBlueprintSchema = z.object({
  who: BlueprintSectionSchema,
  where: BlueprintSectionSchema,
  withWhat: BlueprintSectionSchema,
  alongsideWhom: BlueprintSectionSchema,
  why: BlueprintSectionSchema,
  caveats: z.array(z.string().trim().min(1).max(500)).max(20),
});

export type BlueprintClaim = z.infer<typeof BlueprintClaimSchema>;
export type BlueprintSection = z.infer<typeof BlueprintSectionSchema>;
export type LaunchBlueprint = z.infer<typeof LaunchBlueprintSchema>;

export type AnalysisError = {
  code:
    | "INVALID_SCENARIO"
    | "UNSUPPORTED_CAPABILITY"
    | "AMBIGUOUS_ENTITY"
    | "ENTITY_NOT_FOUND"
    | "EMPTY_RESULTS"
    | "PROVIDER_FAILURE"
    | "EVIDENCE_VALIDATION_FAILURE"
    | "MODEL_UNAVAILABLE"
    | "MODEL_TIMEOUT"
    | "MODEL_NOT_FOUND"
    | "MODEL_AUTHENTICATION_ERROR"
    | "MODEL_RATE_LIMITED"
    | "MODEL_UPSTREAM_ERROR"
    | "MODEL_ERROR"
    | "MODEL_INVALID_OUTPUT";
  message: string;
};

export type AnalysisResult = {
  analysisId: string;
  status: "completed" | "partial" | "failed";
  scenario: LaunchScenario;
  plan?: ResearchPlan;
  resolutions: EntityResolution[];
  evidence: CulturalEvidence[];
  graph: EvidenceGraph;
  blueprint?: LaunchBlueprint;
  limitations: string[];
  errors: AnalysisError[];
};
