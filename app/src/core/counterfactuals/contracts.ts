import { z } from "zod";

export const CounterfactualScenarioSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  premise: z.string().trim().min(1),
  geography: z.string().trim().min(1).optional(),
  assumptions: z.array(z.string().trim().min(1)).default([]),
});

export type CounterfactualScenario = z.infer<typeof CounterfactualScenarioSchema>;

export type CounterfactualAnalysis = {
  scenario: CounterfactualScenario;
  supportingEvidenceIds: string[];
  interpretation: string;
  unsupportedClaims: string[];
};
