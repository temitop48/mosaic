import type { AnalysisResult } from "@/agent/contracts";
import type { CulturalEntity } from "@/core/entities/types";
import type { CulturalEvidence } from "@/core/evidence/types";

export type SupportedResearchObjective =
  | "geographic-cultural-comparison"
  | "cultural-positioning"
  | "local-entity-discovery";

export type ResearchObjectiveKind = SupportedResearchObjective | "unsupported-commercial" | "unsupported-audience";

export type ResearchObjective = {
  kind: ResearchObjectiveKind;
  requestedOutcome: string;
  markets: string[];
  /** Explicit authorization only. Product concepts must not populate this implicitly. */
  allowedTargetTypes: string[];
  requestedTargetType?: string;
  requiresExplainability?: boolean;
};

export type ResearchAction =
  | "STOP"
  | "FOLLOW_UP_APPROVED"
  | "INSUFFICIENT_EVIDENCE"
  | "UNSUPPORTED";

export type StopReason =
  | "evidence-sufficient"
  | "no-actionable-gap"
  | "duplicate-request-blocked"
  | "budget-exhausted"
  | "execution-time-budget"
  | "unsupported-capability"
  | "unsupported-conclusion"
  | "provider-failure"
  | "partial-evidence-stop"
  | "entity-resolution-required";

export type EvidenceGapType =
  | "missing-market-evidence"
  | "partial-research"
  | "query-provenance"
  | "invalid-evidence"
  | "entity-resolution"
  | "requested-dimension"
  | "missing-explainability"
  | "identical-observations"
  | "unsupported-question";

export type EvidenceGap = {
  type: EvidenceGapType;
  trigger: string;
  whyItMatters: string;
  actionable: boolean;
  evidenceIds: string[];
  allowedActions: ResearchAction[];
};

export type ResearchBudget = {
  logicalOperationsUsed: number;
  /** Provider HTTP retries are observed separately; this policy does not enforce them. */
  providerAttemptsUsed?: number;
  maxLogicalOperations: number;
  followUpRoundsUsed: number;
  maxFollowUpRounds: number;
  followUpAffinityByMarket: Record<string, number>;
  maxFollowUpAffinityPerMarket: number;
  deadlineAtMs?: number;
};

export type ResearchRequestDescriptor = {
  subjectEntityId: string;
  targetEntityType: string;
  market: string;
  geographicStrategy: "filter.location.query" | "signal.location.query" | "none";
  explainability: boolean;
};

export type ResearchStepAction = ResearchAction | "VALIDATE_EVIDENCE" | "ASSESS" | "PROVIDER_OPERATION";

export type ResearchStep = {
  index: number;
  action: ResearchStepAction;
  reason: string;
  supportingEvidenceIds: string[];
  requestFingerprint?: string;
  selectedRequest?: ResearchRequestDescriptor;
  budgetBefore: ResearchBudget;
  budgetAfter: ResearchBudget;
  outcome: string;
  stopReason?: StopReason;
};

export type AgentDecision = {
  action: ResearchAction;
  reason: string;
  supportingEvidenceIds: string[];
  selectedRequest?: ResearchRequestDescriptor;
  requestFingerprint?: string;
  stopReason?: StopReason;
};

export type MarketResearchSnapshot = {
  market: string;
  research?: AnalysisResult;
};

export type DecisionAssessmentStatus = "supported" | "partial" | "insufficient" | "unsupported" | "follow-up-required";

export type DecisionConclusion =
  | "geographic-differences-observed"
  | "no-observed-differences"
  | "comparison-ready"
  | "comparison-incomplete"
  | "evidence-insufficient"
  | "unsupported-commercial-conclusion"
  | "follow-up-required"
  | "follow-up-unavailable";

export type DecisionAssessment = {
  status: DecisionAssessmentStatus;
  conclusion: DecisionConclusion;
  summary: string;
  evidenceIds: string[];
  gaps: EvidenceGap[];
  decision: AgentDecision;
  trace: ExecutionTrace;
};

export type ExecutionTrace = {
  objective: ResearchObjective;
  gaps: EvidenceGap[];
  decision: AgentDecision;
  steps: ResearchStep[];
  budget: ResearchBudget;
  stopReason?: StopReason;
};

export type DecisionPolicyInput = {
  objective: ResearchObjective;
  snapshots: MarketResearchSnapshot[];
  completedRequests?: ResearchRequestDescriptor[];
  proposedFollowUp?: ResearchRequestDescriptor;
  /** Supplied by the provider integration; the policy never invents capabilities. */
  supportedTargetTypes?: readonly string[];
  budget?: Partial<ResearchBudget>;
  nowMs?: number;
};

export type AssessmentInput = DecisionPolicyInput;

export type ValidatedEvidenceView = {
  evidence: CulturalEvidence[];
  invalidEvidenceIds: string[];
  missingProvenanceIds: string[];
};

export const SUPPORTED_AGENT_TARGET_TYPES = ["urn:entity:brand", "urn:entity:place"] as const;

export type AgentAuthorization = {
  initialTargetType: string;
  allowedTargetTypes: string[];
  objective: ResearchObjective;
  markets: string[];
};

export type TrustedResearchMetadata = {
  logicalOperationCount: number;
  providerAttemptsUsed?: number;
  completedRequests: ResearchRequestDescriptor[];
  resolvedSubjects: CulturalEntity[];
};
