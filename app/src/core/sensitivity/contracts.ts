import type { CounterfactualEvidenceObservation, CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { DecisionStability } from "@/core/decision-stability/contracts";

export type DecisionSensitivityAssumption = {
  dimension: "culturalSignal";
  originalValue: string;
  alternativeValue: string;
};

export type DecisionSensitivityStatus = "stable" | "changed" | "not-observed-in-variant" | "new-in-variant";

export type DecisionSensitivityRelationship = {
  status: DecisionSensitivityStatus;
  providerId: string;
  subjectEntityId: string;
  subjectEntityCategory: CounterfactualEvidenceObservation["subjectEntityCategory"];
  objectEntityId: string;
  objectEntityCategory: CounterfactualEvidenceObservation["objectEntityCategory"];
  originalEvidence?: CounterfactualEvidenceObservation;
  variantEvidence?: CounterfactualEvidenceObservation;
};

export type DecisionSensitivityDestination = {
  providerId: string;
  objectEntityId: string;
  objectEntityCategory: CounterfactualEvidenceObservation["objectEntityCategory"];
  originalEvidence?: CounterfactualEvidenceObservation;
  variantEvidence?: CounterfactualEvidenceObservation;
};

export type DecisionSensitivityDestinationContinuity = {
  shared: DecisionSensitivityDestination[];
  originalOnly: DecisionSensitivityDestination[];
  variantOnly: DecisionSensitivityDestination[];
  originalDestinationCount: number;
  variantDestinationCount: number;
  unionDestinationCount: number;
  jaccardOverlap: number;
};

export type DecisionSensitivityMarketComparison = {
  market: "baseline" | "alternative";
  stable: DecisionSensitivityRelationship[];
  changed: DecisionSensitivityRelationship[];
  notObservedInVariant: DecisionSensitivityRelationship[];
  newInVariant: DecisionSensitivityRelationship[];
  destinationContinuity: DecisionSensitivityDestinationContinuity;
};

export type DecisionSensitivityComparison = {
  baseline: DecisionSensitivityMarketComparison;
  alternative: DecisionSensitivityMarketComparison;
};

export type DecisionSensitivityResult = {
  schemaVersion: 1;
  assumption: DecisionSensitivityAssumption;
  originalResult: CounterfactualResult;
  variantResult: CounterfactualResult;
  comparison: DecisionSensitivityComparison;
  limitations: string[];
  decisionStability?: DecisionStability;
};

export type DecisionSensitivityInput = {
  assumption: DecisionSensitivityAssumption;
  originalResult: CounterfactualResult;
  variantResult: CounterfactualResult;
};

export class DecisionSensitivityValidationError extends Error {
  readonly code = "INVALID_DECISION_SENSITIVITY_EXPERIMENT";

  constructor(message: string) {
    super(message);
    this.name = "DecisionSensitivityValidationError";
  }
}
