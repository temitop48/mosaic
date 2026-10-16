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

export const CounterfactualRequestSchema = z.object({ baseline: LaunchScenarioInputSchema, modification: CounterfactualModificationSchema }).superRefine((value, context) => {
  if (!value.baseline.launchLocation) context.addIssue({ code: "custom", path: ["baseline", "launchLocation"], message: "Baseline launchLocation is required for a location counterfactual" });
  if (value.baseline.launchLocation && value.baseline.launchLocation !== value.modification.originalValue) context.addIssue({ code: "custom", path: ["modification", "originalValue"], message: "originalValue must match baseline.launchLocation" });
});

export type CounterfactualRequest = z.infer<typeof CounterfactualRequestSchema>;
export type CounterfactualDimension = "launchLocation";
export type CounterfactualError = { code: "INVALID_REQUEST" | "UNSUPPORTED_DIMENSION" | "RESEARCH_FAILURE" | "INSUFFICIENT_EVIDENCE"; message: string };

export type CounterfactualEntityReference = { providerId: string; id: string; category: EntityCategory; name?: string };
export type CounterfactualEvidenceObservation = {
  evidenceId: string; providerId: string; subjectEntityId: string; subjectEntityCategory: EntityCategory; objectEntityId: string; objectEntityCategory: EntityCategory; providerScore?: number; geographicContext?: GeographicContext; queryParameters: Record<string, string>; retrievedAt: string;
};
export type CounterfactualRelationship = {
  providerId: string; subjectEntityId: string; subjectEntityCategory: EntityCategory; objectEntityId: string; objectEntityCategory: EntityCategory; baseline?: CounterfactualEvidenceObservation; alternative?: CounterfactualEvidenceObservation;
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
  queryContexts: { baseline: Array<Record<string, string>>; alternative: Array<Record<string, string>> };
  geographicContexts: { baseline: GeographicContext[]; alternative: GeographicContext[] };
  limitations: string[];
};

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
};
