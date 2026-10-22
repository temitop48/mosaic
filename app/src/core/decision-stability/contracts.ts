import type { DecisionAssessment, DecisionConclusion } from "@/agent/decision/contracts";

export type StabilityClassification =
  | "stable-conclusion-changed-evidence"
  | "changed-conclusion"
  | "stable-conclusion-stable-evidence"
  | "indeterminate";

export type StabilityEvidenceStatus = "changed" | "stable" | "indeterminate";
export type StabilityConclusionStatus = "changed" | "stable" | "indeterminate";
export type StabilityComparabilityStatus = "comparable" | "incomparable";

export type DecisionAssessmentSnapshot = {
  status: DecisionAssessment["status"];
  conclusion: DecisionConclusion;
  summary: string;
  evidenceIds: string[];
};

export type DecisionStability = {
  classification: StabilityClassification;
  originalAssessment: DecisionAssessmentSnapshot;
  counterfactualAssessment: DecisionAssessmentSnapshot;
  evidenceChange: StabilityEvidenceStatus;
  conclusionChange: StabilityConclusionStatus;
  comparability: StabilityComparabilityStatus;
  supportingEvidenceIds: string[];
  limitations: string[];
  explanation: string;
};
