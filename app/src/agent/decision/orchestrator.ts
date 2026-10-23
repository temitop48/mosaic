import type { AnalysisError, AnalysisResult } from "@/agent/contracts";
import {
  type DecisionAssessment,
  type ExecutionTrace,
  type MarketResearchSnapshot,
  type ResearchBudget,
  type ResearchObjective,
  type ResearchRequestDescriptor,
  type ResearchStep,
  type StopReason,
} from "@/agent/decision/contracts";
import { assessDecision } from "@/agent/decision/assessment";
import { requestFingerprint } from "@/agent/decision/policy";
import type { CulturalEntity } from "@/core/entities/types";
import { EvidenceRegistry } from "@/core/evidence/registry";
import { CulturalEvidenceSchema, type CulturalEvidence } from "@/core/evidence/types";
import type { ProviderDiagnostic, CulturalIntelligenceProvider } from "@/providers/interfaces/contracts";

export type BoundedResearchState = {
  objective: ResearchObjective;
  snapshots: MarketResearchSnapshot[];
  /** This registry must already contain the initial validated research state. */
  registry: EvidenceRegistry;
  resolvedSubjects: CulturalEntity[];
  /** Required: the caller must report operations already performed. */
  budget: ResearchBudget;
  completedRequests: ResearchRequestDescriptor[];
};

export type BoundedResearchExecutorInput = BoundedResearchState & {
  provider: CulturalIntelligenceProvider;
  /** Only requests explicitly authorized by the caller may appear here. */
  followUpRequests: ResearchRequestDescriptor[];
  supportedTargetTypes: readonly string[];
  nowMs?: () => number;
  providerTimeoutMs?: number;
  responseReserveMs?: number;
};

export type BoundedResearchExecutorResult = {
  status: "completed" | "partial" | "stopped";
  initialSnapshots: MarketResearchSnapshot[];
  snapshots: MarketResearchSnapshot[];
  followUpEvidence: CulturalEvidence[];
  assessment: DecisionAssessment;
  trace: ExecutionTrace;
  diagnostics: ProviderDiagnostic[];
  errors: Array<{ market?: string; code: string; message: string }>;
};

const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;
const DEFAULT_RESPONSE_RESERVE_MS = 5_000;

function expectedLocationKey(targetType: string): "filter.location.query" | "signal.location.query" | undefined {
  if (targetType === "urn:entity:brand") return "signal.location.query";
  if (targetType === "urn:entity:place") return "filter.location.query";
  return undefined;
}

function expectedObjectCategory(targetType: string): string | undefined {
  if (targetType === "urn:entity:brand") return "brand";
  if (targetType === "urn:entity:place") return "place";
  return targetType.startsWith("urn:entity:") ? targetType.slice("urn:entity:".length) : undefined;
}

function requestMatchesEvidence(evidence: CulturalEvidence, request: ResearchRequestDescriptor, subject: CulturalEntity): boolean {
  if (evidence.kind !== "affinity") return false;
  const locationKey = expectedLocationKey(request.targetEntityType);
  const expectedCategory = expectedObjectCategory(request.targetEntityType);
  return evidence.subjectEntityId === subject.id
    && evidence.subjectEntityCategory === subject.category
    && evidence.queryParameters["filter.type"] === request.targetEntityType
    && (!expectedCategory || evidence.objectEntityCategory === expectedCategory)
    && (!locationKey || evidence.queryParameters[locationKey] === request.market);
}

function copyBudget(budget: ResearchBudget): ResearchBudget {
  return { ...budget, followUpAffinityByMarket: { ...budget.followUpAffinityByMarket } };
}

function copySnapshots(snapshots: MarketResearchSnapshot[]): MarketResearchSnapshot[] {
  return snapshots.map((snapshot) => ({ ...snapshot, research: snapshot.research ? { ...snapshot.research, evidence: [...snapshot.research.evidence] } : undefined }));
}

function appendEvidence(snapshots: MarketResearchSnapshot[], market: string, evidence: CulturalEvidence[]): MarketResearchSnapshot[] {
  return snapshots.map((snapshot) => {
    if (snapshot.market !== market || !snapshot.research) return snapshot;
    const existing = new Set(snapshot.research.evidence.map((item) => item.id));
    return {
      ...snapshot,
      research: {
        ...snapshot.research,
        status: snapshot.research.status === "failed" ? "partial" : snapshot.research.status,
        evidence: [...snapshot.research.evidence, ...evidence.filter((item) => !existing.has(item.id))],
      },
    };
  });
}

function step(
  index: number,
  action: ResearchStep["action"],
  reason: string,
  budgetBefore: ResearchBudget,
  budgetAfter: ResearchBudget,
  supportingEvidenceIds: string[],
  request?: ResearchRequestDescriptor,
  outcome = "",
  stopReason?: StopReason,
): ResearchStep {
  return {
    index,
    action,
    reason,
    supportingEvidenceIds,
    requestFingerprint: request ? requestFingerprint(request) : undefined,
    selectedRequest: request,
    budgetBefore: copyBudget(budgetBefore),
    budgetAfter: copyBudget(budgetAfter),
    outcome,
    stopReason,
  };
}

function resultWithAssessment(
  initialSnapshots: MarketResearchSnapshot[],
  snapshots: MarketResearchSnapshot[],
  followUpEvidence: CulturalEvidence[],
  assessment: DecisionAssessment,
  trace: ExecutionTrace,
  diagnostics: ProviderDiagnostic[],
  errors: Array<{ market?: string; code: string; message: string }>,
  status: BoundedResearchExecutorResult["status"],
): BoundedResearchExecutorResult {
  return { status, initialSnapshots, snapshots, followUpEvidence, assessment, trace, diagnostics, errors };
}

function errorFromAnalysis(research: AnalysisResult | undefined): Array<{ market?: string; code: string; message: string }> {
  return (research?.errors ?? []).map((item: AnalysisError) => ({ code: item.code, message: item.message }));
}

/**
 * Executes at most one explicitly approved affinity follow-up round. It does
 * not resolve new subjects, construct provider URLs, or alter production
 * routes. The caller supplies the initial operation accounting and registry.
 */
export async function executeBoundedResearch(input: BoundedResearchExecutorInput): Promise<BoundedResearchExecutorResult> {
  const now = input.nowMs ?? (() => Date.now());
  const providerTimeoutMs = input.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const responseReserveMs = input.responseReserveMs ?? DEFAULT_RESPONSE_RESERVE_MS;
  const initialSnapshots = copySnapshots(input.snapshots);
  const initialAssessment = assessDecision({
    objective: input.objective,
    snapshots: initialSnapshots,
    completedRequests: input.completedRequests,
    proposedFollowUp: input.followUpRequests[0],
    supportedTargetTypes: input.supportedTargetTypes,
    budget: input.budget,
    nowMs: now(),
  });
  const errors = errorFromAnalysis(initialSnapshots.find((snapshot) => snapshot.research?.errors.length)?.research);
  const diagnostics: ProviderDiagnostic[] = [];
  const followUpEvidence: CulturalEvidence[] = [];
  let snapshots = copySnapshots(initialSnapshots);
  let budget = copyBudget(input.budget);
  const steps: ResearchStep[] = [...initialAssessment.trace.steps];

  if (initialAssessment.decision.action !== "FOLLOW_UP_APPROVED" || input.followUpRequests.length === 0) {
    return resultWithAssessment(initialSnapshots, snapshots, followUpEvidence, initialAssessment, { ...initialAssessment.trace, steps, budget }, diagnostics, errors, initialAssessment.status === "insufficient" ? "partial" : "stopped");
  }

  const approvedTarget = initialAssessment.decision.selectedRequest?.targetEntityType;
  const uniqueRequests = [...new Map(input.followUpRequests.map((request) => [`${request.market}|${request.targetEntityType}|${request.subjectEntityId}|${request.geographicStrategy}`, request])).values()];
  if (!approvedTarget || uniqueRequests.some((request) => request.targetEntityType !== approvedTarget)) {
    const decision = { ...initialAssessment.decision, action: "STOP" as const, reason: "A follow-up round must use one explicitly approved target category.", stopReason: "unsupported-capability" as const };
    const assessment = { ...initialAssessment, status: "unsupported" as const, conclusion: "follow-up-unavailable" as const, decision, summary: decision.reason };
    const trace = { ...initialAssessment.trace, decision, steps: [...steps, step(1, "ASSESS", decision.reason, budget, budget, decision.supportingEvidenceIds, undefined, decision.reason, decision.stopReason)], stopReason: decision.stopReason };
    return resultWithAssessment(initialSnapshots, snapshots, followUpEvidence, assessment, trace, diagnostics, errors, "stopped");
  }

  for (const request of uniqueRequests) {
    const subject = input.resolvedSubjects.find((candidate) => candidate.id === request.subjectEntityId);
    const marketIsRequested = input.objective.markets.includes(request.market);
    const remaining = input.budget.deadlineAtMs === undefined ? 0 : input.budget.deadlineAtMs - now();
    const minimumWindow = providerTimeoutMs + responseReserveMs;
    const before = copyBudget(budget);
    if (!subject || !marketIsRequested) {
      const reason = !subject ? "The follow-up subject was not resolved to a provider identity." : "The follow-up market is outside the research objective.";
      const stopReason: StopReason = !subject ? "entity-resolution-required" : "unsupported-capability";
      steps.push(step(steps.length, "ASSESS", reason, before, budget, [], request, reason, stopReason));
    const decision = { ...initialAssessment.decision, action: "INSUFFICIENT_EVIDENCE" as const, reason, selectedRequest: request, requestFingerprint: requestFingerprint(request), stopReason };
      const assessment = { ...initialAssessment, status: "insufficient" as const, conclusion: "follow-up-unavailable" as const, decision, summary: reason };
      const trace = { ...initialAssessment.trace, decision, steps, budget, stopReason };
      return resultWithAssessment(initialSnapshots, snapshots, followUpEvidence, assessment, trace, diagnostics, errors, "partial");
    }
    if (input.budget.deadlineAtMs === undefined || remaining < minimumWindow) {
      const reason = "The remaining execution window is insufficient for the provider timeout and response reserve.";
      const decision = { ...initialAssessment.decision, action: "STOP" as const, reason, selectedRequest: request, requestFingerprint: requestFingerprint(request), stopReason: "execution-time-budget" as const };
      steps.push(step(steps.length, "ASSESS", reason, before, budget, [], request, reason, decision.stopReason));
      const assessment = { ...initialAssessment, status: "partial" as const, conclusion: "follow-up-unavailable" as const, decision, summary: reason };
      const trace = { ...initialAssessment.trace, decision, steps, budget, stopReason: decision.stopReason };
      return resultWithAssessment(initialSnapshots, snapshots, followUpEvidence, assessment, trace, diagnostics, errors, "partial");
    }

    const materialDuplicate = input.completedRequests.some((completed) => requestFingerprint(completed).split("|explainability:")[0] === requestFingerprint(request).split("|explainability:")[0]);
    if (materialDuplicate) {
      const reason = "The follow-up request duplicates an already executed provider operation.";
      const decision = { ...initialAssessment.decision, action: "STOP" as const, reason, selectedRequest: request, requestFingerprint: requestFingerprint(request), stopReason: "duplicate-request-blocked" as const };
      steps.push(step(steps.length, "ASSESS", reason, before, budget, [], request, reason, decision.stopReason));
      const assessment = { ...initialAssessment, status: "partial" as const, conclusion: "follow-up-unavailable" as const, decision, summary: reason };
      const trace = { ...initialAssessment.trace, decision, steps, budget, stopReason: decision.stopReason };
      return resultWithAssessment(initialSnapshots, snapshots, followUpEvidence, assessment, trace, diagnostics, errors, "partial");
    }

    const followUpRoundAlreadyStarted = budget.followUpRoundsUsed > 0 && followUpEvidence.length > 0;
    if (budget.logicalOperationsUsed >= budget.maxLogicalOperations || (!followUpRoundAlreadyStarted && budget.followUpRoundsUsed >= budget.maxFollowUpRounds) || (budget.followUpAffinityByMarket[request.market] ?? 0) >= budget.maxFollowUpAffinityPerMarket) {
      const reason = "The bounded logical provider-operation budget is exhausted.";
      const decision = { ...initialAssessment.decision, action: "STOP" as const, reason, selectedRequest: request, requestFingerprint: requestFingerprint(request), stopReason: "budget-exhausted" as const };
      steps.push(step(steps.length, "ASSESS", reason, before, budget, [], request, reason, decision.stopReason));
      const assessment = { ...initialAssessment, status: "partial" as const, conclusion: "follow-up-unavailable" as const, decision, summary: reason };
      const trace = { ...initialAssessment.trace, decision, steps, budget, stopReason: decision.stopReason };
      return resultWithAssessment(initialSnapshots, snapshots, followUpEvidence, assessment, trace, diagnostics, errors, "partial");
    }

    budget = { ...budget, logicalOperationsUsed: budget.logicalOperationsUsed + 1, followUpRoundsUsed: 1, followUpAffinityByMarket: { ...budget.followUpAffinityByMarket, [request.market]: (budget.followUpAffinityByMarket[request.market] ?? 0) + 1 } };
    steps.push(step(steps.length, "PROVIDER_OPERATION", "Executing the explicitly approved affinity follow-up.", before, budget, [], request, "Provider operation started."));
    let result;
    try {
      result = await input.provider.discoverAffinity({ entityId: subject.id, sourceEntityCategory: subject.category, sourceEntityName: subject.name, targetType: request.targetEntityType, locationQuery: request.market, explainability: request.explainability });
    } catch {
      const reason = "The provider follow-up threw an exception.";
      const decision = { ...initialAssessment.decision, action: "STOP" as const, reason, selectedRequest: request, requestFingerprint: requestFingerprint(request), stopReason: "provider-failure" as const };
      steps.push(step(steps.length, "ASSESS", reason, budget, budget, [], request, reason, decision.stopReason));
      const assessment = { ...initialAssessment, status: "partial" as const, conclusion: "follow-up-unavailable" as const, decision, summary: reason };
      const trace = { ...initialAssessment.trace, decision, steps, budget, stopReason: decision.stopReason };
      return resultWithAssessment(initialSnapshots, snapshots, followUpEvidence, assessment, trace, diagnostics, errors, "partial");
    }
    diagnostics.push(...(result.diagnostics ?? []));
    if (!result.ok || result.data.length === 0) {
      const reason = !result.ok ? result.error.message : "The provider returned no follow-up observations.";
      const decision = { ...initialAssessment.decision, action: "STOP" as const, reason, selectedRequest: request, requestFingerprint: requestFingerprint(request), stopReason: "provider-failure" as const };
      errors.push({ market: request.market, code: !result.ok ? result.error.code : "EMPTY_RESULTS", message: reason });
      steps.push(step(steps.length, "ASSESS", reason, budget, budget, [], request, reason, decision.stopReason));
      const assessment = { ...initialAssessment, status: "partial" as const, conclusion: "follow-up-unavailable" as const, decision, summary: reason };
      const trace = { ...initialAssessment.trace, decision, steps, budget, stopReason: decision.stopReason };
      return resultWithAssessment(initialSnapshots, snapshots, followUpEvidence, assessment, trace, diagnostics, errors, "partial");
    }

    const accepted: CulturalEvidence[] = [];
    let invalid = false;
    for (const item of result.data) {
      const parsed = CulturalEvidenceSchema.safeParse(item);
      if (!parsed.success || !requestMatchesEvidence(parsed.data as CulturalEvidence, request, subject)) {
        invalid = true;
        errors.push({ market: request.market, code: "EVIDENCE_VALIDATION_FAILURE", message: "Follow-up evidence did not match the approved subject, target, or market context." });
        continue;
      }
      const evidence = parsed.data;
      if (evidence.kind === "affinity" && !input.registry.has(evidence.objectEntityId)) {
        input.registry.registerEntity({ id: evidence.objectEntityId, providerId: evidence.provenance.providerId, name: evidence.objectEntityName ?? evidence.objectEntityId, category: evidence.objectEntityCategory, geographicContext: evidence.geographicContext, sourceReference: `${evidence.provenance.providerId}:entity:${evidence.objectEntityId}`, metadata: { providerEntityId: evidence.objectEntityId } });
      }
      const registered = input.registry.registerEvidence(evidence);
      if (!registered.valid) {
        invalid = true;
        errors.push({ market: request.market, code: "EVIDENCE_VALIDATION_FAILURE", message: registered.errors.join("; ") });
        continue;
      }
      accepted.push(registered.evidence);
    }
    if (accepted.length > 0) {
      followUpEvidence.push(...accepted);
      snapshots = appendEvidence(snapshots, request.market, accepted);
    }
    steps.push(step(steps.length, "VALIDATE_EVIDENCE", "Follow-up observations were submitted to EvidenceRegistry.", before, budget, accepted.map((item) => item.id), request, `${accepted.length} observations validated.`));
    if (invalid) {
      const reason = "Follow-up returned invalid or mismatched evidence; valid initial evidence was preserved.";
      const decision = { ...initialAssessment.decision, action: "STOP" as const, reason, selectedRequest: request, requestFingerprint: requestFingerprint(request), stopReason: "provider-failure" as const };
      steps.push(step(steps.length, "ASSESS", reason, budget, budget, accepted.map((item) => item.id), request, reason, decision.stopReason));
      const assessment = { ...initialAssessment, status: "partial" as const, conclusion: "follow-up-unavailable" as const, decision, summary: reason };
      const trace = { ...initialAssessment.trace, decision, steps, budget, stopReason: decision.stopReason };
      return resultWithAssessment(initialSnapshots, snapshots, followUpEvidence, assessment, trace, diagnostics, errors, "partial");
    }
  }

  const reassessed = assessDecision({ objective: input.objective, snapshots, completedRequests: [...input.completedRequests, ...uniqueRequests], supportedTargetTypes: input.supportedTargetTypes, budget, nowMs: now() });
  steps.push(step(steps.length, "ASSESS", "Reassessed the initial and validated follow-up evidence.", budget, budget, reassessed.evidenceIds, undefined, reassessed.summary, reassessed.decision.stopReason));
  const trace: ExecutionTrace = { ...reassessed.trace, steps, budget, stopReason: reassessed.decision.stopReason };
  return resultWithAssessment(initialSnapshots, snapshots, followUpEvidence, reassessed, trace, diagnostics, errors, reassessed.status === "supported" ? "completed" : "partial");
}
