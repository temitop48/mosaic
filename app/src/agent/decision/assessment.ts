import type {
  AssessmentInput,
  DecisionAssessment,
  ExecutionTrace,
  MarketResearchSnapshot,
  ResearchStep,
} from "@/agent/decision/contracts";
import { classifyEvidenceGaps, decideNextAction, defaultResearchBudget } from "@/agent/decision/policy";

function validEvidenceIds(snapshots: MarketResearchSnapshot[]): string[] {
  return snapshots.flatMap((snapshot) => (snapshot.research?.evidence ?? []).filter((item) => item.verified && item.providerScore !== undefined).map((item) => item.id));
}

function hasGeographicDifference(input: AssessmentInput): boolean {
  if (input.snapshots.length !== 2) return false;
  const [left, right] = input.snapshots;
  const leftIds = (left.research?.evidence ?? []).map((item) => `${item.provenance.providerId}:${item.objectEntityCategory}:${item.objectEntityId}`);
  const rightIds = (right.research?.evidence ?? []).map((item) => `${item.provenance.providerId}:${item.objectEntityCategory}:${item.objectEntityId}`);
  return leftIds.length > 0 && (leftIds.length !== rightIds.length || leftIds.some((id, index) => id !== rightIds[index]));
}

function summary(conclusion: DecisionAssessment["conclusion"], markets: string[]): string {
  switch (conclusion) {
    case "geographic-differences-observed": return `Different provider-backed target observations were returned for ${markets.join(" and ")}.`;
    case "no-observed-differences": return `No observed differentiation was found in the returned results for ${markets.join(" and ")}.`;
    case "comparison-incomplete": return "The comparison is incomplete because one or more markets lack sufficient validated evidence.";
    case "unsupported-commercial-conclusion": return "The requested commercial or audience conclusion is not supported by cultural affinity evidence.";
    case "follow-up-required": return "An explicitly authorized research dimension requires one bounded follow-up query.";
    case "follow-up-unavailable": return "A research gap was identified, but no supported follow-up is available.";
    default: return "The validated evidence supports a bounded cultural assessment.";
  }
}

export function assessDecision(input: AssessmentInput): DecisionAssessment {
  const gaps = classifyEvidenceGaps(input);
  const decision = decideNextAction(input, gaps);
  const evidenceIds = validEvidenceIds(input.snapshots);
  let conclusion: DecisionAssessment["conclusion"];
  let status: DecisionAssessment["status"];

  if (decision.action === "UNSUPPORTED") {
    conclusion = "unsupported-commercial-conclusion";
    status = "unsupported";
  } else if (decision.action === "FOLLOW_UP_APPROVED") {
    conclusion = "follow-up-required";
    status = "follow-up-required";
  } else if (decision.action === "INSUFFICIENT_EVIDENCE") {
    conclusion = "comparison-incomplete";
    status = "insufficient";
  } else if (gaps.some((gap) => gap.type === "identical-observations")) {
    conclusion = "no-observed-differences";
    status = "supported";
  } else if (hasGeographicDifference(input)) {
    conclusion = "geographic-differences-observed";
    status = "supported";
  } else {
    conclusion = "comparison-ready";
    status = "supported";
  }

  const budget = defaultResearchBudget(input.budget);
  const step: ResearchStep = {
    index: 0,
    action: decision.action === "STOP" ? "ASSESS" : decision.action,
    reason: decision.reason,
    supportingEvidenceIds: decision.supportingEvidenceIds,
    requestFingerprint: decision.requestFingerprint,
    selectedRequest: decision.selectedRequest,
    budgetBefore: budget,
    budgetAfter: budget,
    outcome: summary(conclusion, input.objective.markets),
    stopReason: decision.stopReason,
  };
  const trace: ExecutionTrace = { objective: input.objective, gaps, decision, steps: [step], budget, stopReason: decision.stopReason };
  return { status, conclusion, summary: summary(conclusion, input.objective.markets), evidenceIds, gaps, decision, trace };
}
