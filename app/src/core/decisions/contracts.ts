import { z } from "zod";

export const DecisionRecommendationSchema = z.object({
  action: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  confidence: z.enum(["low", "medium", "high"]),
  evidenceIds: z.array(z.string().trim().min(1)),
  caveats: z.array(z.string().trim().min(1)).default([]),
});

export const LaunchDecisionSchema = z.object({
  scenarioId: z.string().trim().min(1),
  recommendation: DecisionRecommendationSchema,
  commercialSuccessProbability: z.never().optional(),
});

export type DecisionRecommendation = z.infer<typeof DecisionRecommendationSchema>;
export type LaunchDecision = z.infer<typeof LaunchDecisionSchema>;
