import { z } from "zod";
import { LaunchScenarioInputSchema, type AnalysisResult, type LaunchScenarioInput } from "@/agent/contracts";
import type { EntityCategory, GeographicContext } from "@/core/entities/types";

export const CounterfactualScenarioSchema = z.object({
  id: z.string().trim().min(1), title: z.string().trim().min(1), premise: z.string().trim().min(1), geography: z.string().trim().min(1).optional(), assumptions: z.array(z.string().trim().min(1)).default([]),
});
export type CounterfactualScenario = z.infer<typeof CounterfactualScenarioSchema>;
export type CounterfactualAnalysis = { scenario: CounterfactualScenario; supportingEvidenceIds: string[]; interpretation: string; unsupportedClaims: string[] };

export const CounterfactualModificationSchema = z.object({
  dimension: z.string().trim().min(1),
  originalValue: z.string().trim().min(1).max(160),
  alternativeValue: z.string().trim().min(1).max(160),
}).refine((value) => value.originalValue !== value.alternativeValue, { message: "Counterfactual values must differ" });

export const CounterfactualRequestSchema = z.object({ baseline: LaunchScenarioInputSchema, modification: CounterfactualModificationSchema, includeStrategicInterpretation: z.boolean().default(false) }).superRefine((value, context) => {
  if (!value.baseline.launchLocation) context.addIssue({ code: "custom", path: ["baseline", "launchLocation"], message: "Baseline launchLocation is required for a location counterfactual" });
  if (value.baseline.launchLocation && value.baseline.launchLocation !== value.modification.originalValue) context.addIssue({ code: "custom", path: ["modification", "originalValue"], message: "originalValue must match baseline.launchLocation" });
});

export type CounterfactualRequest = z.infer<typeof CounterfactualRequestSchema>;
export type CounterfactualDimension = "launchLocation";
export type CounterfactualError = { code: "INVALID_REQUEST" | "UNSUPPORTED_DIMENSION" | "RESEARCH_FAILURE" | "INSUFFICIENT_EVIDENCE" | "MODEL_UNAVAILABLE" | "MODEL_TIMEOUT" | "MODEL_FAILURE"; message: string };

export type CounterfactualEntityReference = { providerId: string; id: string; category: EntityCategory; name?: string };
export type CounterfactualEvidenceObservation = {
  evidenceId: string; providerId: string; subjectEntityId: string; subjectEntityCategory: EntityCategory; objectEntityId: string; objectEntityCategory: EntityCategory; providerScore?: number; geographicContext?: GeographicContext; queryParameters: Record<string, string>; retrievedAt: string;
};
export type CounterfactualRelationship = {
  providerId: string; subjectEntityId: string; subjectEntityCategory: EntityCategory; objectEntityId: string; objectEntityCategory: EntityCategory; baseline?: CounterfactualEvidenceObservation; alternative?: CounterfactualEvidenceObservation;
};

export type CounterfactualEvidenceChange = {
  changeType: "added-in-alternative" | "removed-in-alternative" | "observed-value-changed";
  providerId: string;
  subjectEntityId: string;
  subjectEntityCategory: EntityCategory;
  objectEntityId: string;
  objectEntityCategory: EntityCategory;
  baseline?: CounterfactualEvidenceObservation;
  alternative?: CounterfactualEvidenceObservation;
};

export type CounterfactualComparison = {
  compared: boolean;
  baselineEvidenceCount: number;
  alternativeEvidenceCount: number;
  baselineGraphEdgeCount: number;
  alternativeGraphEdgeCount: number;
  sharedEntities: CounterfactualEntityReference[];
  baselineOnlyEntities: CounterfactualEntityReference[];
  alternativeOnlyEntities: CounterfactualEntityReference[];
  sharedRelationships: CounterfactualRelationship[];
  baselineOnlyRelationships: CounterfactualRelationship[];
  alternativeOnlyRelationships: CounterfactualRelationship[];
  changedObservedRelationships: CounterfactualRelationship[];
  evidenceChanges: CounterfactualEvidenceChange[];
  queryContexts: { baseline: Array<Record<string, string>>; alternative: Array<Record<string, string>> };
  geographicContexts: { baseline: GeographicContext[]; alternative: GeographicContext[] };
  limitations: string[];
};

export const StrategicMarketSchema = z.enum(["baseline", "alternative", "comparison"]);
export const StrategicClaimSchema = z.object({
  text: z.string().trim().min(1).max(700),
  classification: z.enum(["verified-observation", "interpretation", "unverified-suggestion"]),
  market: StrategicMarketSchema,
  evidenceIds: z.array(z.string().trim().min(1)).max(20),
  subjectEntityId: z.string().trim().min(1).optional(),
  objectEntityId: z.string().trim().min(1).optional(),
});
export const StrategicEvidenceReferenceSchema = z.object({
  evidenceId: z.string().trim().min(1),
  market: StrategicMarketSchema,
});
const strategicClaims = z.array(StrategicClaimSchema).max(10).default([]);
export const StrategicInterpretationSchema = z.object({
  scenarioChange: strategicClaims,
  evidenceBackedObservations: strategicClaims,
  potentialStrategicImplications: strategicClaims,
  suggestedPositioningAdjustments: strategicClaims,
  suggestedAudienceConsiderations: strategicClaims,
  suggestedCulturalTouchpoints: strategicClaims,
  uncertaintiesAndLimitations: z.array(z.string().trim().min(1).max(700)).max(20).default([]),
  supportingEvidenceReferences: z.array(StrategicEvidenceReferenceSchema).max(40).default([]),
  // Retained for compatibility with the original Phase 4B model contract.
  culturalPossibilities: strategicClaims,
  positioningAndLaunchExecution: strategicClaims,
  assumptionsToValidate: strategicClaims,
  caveats: z.array(z.string().trim().min(1).max(700)).max(20).default([]),
});
export type StrategicMarket = z.infer<typeof StrategicMarketSchema>;
export type StrategicClaim = z.infer<typeof StrategicClaimSchema>;
export type StrategicEvidenceReference = z.infer<typeof StrategicEvidenceReferenceSchema>;
/** Input form also accepts the legacy Phase 4B shape; schema defaults fill new sections. */
export type StrategicInterpretationInput = z.input<typeof StrategicInterpretationSchema>;
export type StrategicInterpretation = z.infer<typeof StrategicInterpretationSchema>;

export type CounterfactualResult = {
  status: "completed" | "partial" | "failed";
  dimension: CounterfactualDimension;
  baselineScenario: LaunchScenarioInput;
  alternativeScenario: LaunchScenarioInput;
  baselineResearch?: AnalysisResult;
  alternativeResearch?: AnalysisResult;
  comparison: CounterfactualComparison;
  limitations: string[];
  errors: CounterfactualError[];
  strategicInterpretationStatus: "not-requested" | "available" | "unavailable";
  strategicInterpretation?: StrategicInterpretation;
  strategicInterpretationError?: CounterfactualError;
};
