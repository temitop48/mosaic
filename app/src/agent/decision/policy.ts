import { CulturalEvidenceSchema, type AffinityEvidence } from "@/core/evidence/types";
import type {
  AgentDecision,
  DecisionPolicyInput,
  EvidenceGap,
  MarketResearchSnapshot,
  ResearchBudget,
  ResearchObjective,
  ResearchRequestDescriptor,
  ValidatedEvidenceView,
} from "@/agent/decision/contracts";

const DEFAULT_BUDGET: ResearchBudget = {
  logicalOperationsUsed: 0,
  providerAttemptsUsed: 0,
  maxLogicalOperations: 6,
  followUpRoundsUsed: 0,
  maxFollowUpRounds: 1,
  followUpAffinityByMarket: {},
  maxFollowUpAffinityPerMarket: 1,
};

function budget(input?: Partial<ResearchBudget>): ResearchBudget {
  return {
    ...DEFAULT_BUDGET,
    ...input,
    followUpAffinityByMarket: { ...DEFAULT_BUDGET.followUpAffinityByMarket, ...(input?.followUpAffinityByMarket ?? {}) },
  };
}

function isUnsupportedObjective(objective: ResearchObjective): boolean {
  return objective.kind === "unsupported-commercial" || objective.kind === "unsupported-audience";
}

function evidenceView(snapshot: MarketResearchSnapshot): ValidatedEvidenceView {
  const evidence: AffinityEvidence[] = [];
  const invalidEvidenceIds: string[] = [];
  const missingProvenanceIds: string[] = [];

  for (const item of snapshot.research?.evidence ?? []) {
    const parsed = CulturalEvidenceSchema.safeParse(item);
    if (!parsed.success || parsed.data.kind !== "affinity" || !parsed.data.verified || parsed.data.providerScore === undefined) {
      invalidEvidenceIds.push(typeof item === "object" && item && "id" in item ? String(item.id) : "unknown-evidence");
      continue;
    }
    if (Object.keys(parsed.data.queryParameters).length === 0 || !parsed.data.provenance.providerId || !parsed.data.provenance.sourceReference) {
      missingProvenanceIds.push(parsed.data.id);
    }
    evidence.push(parsed.data);
  }

  return { evidence, invalidEvidenceIds, missingProvenanceIds };
}

function expectedLocationKey(targetType: string): string | undefined {
  if (targetType === "urn:entity:brand") return "signal.location.query";
  if (targetType === "urn:entity:place") return "filter.location.query";
  return undefined;
}

function hasCompatibleProvenance(evidence: AffinityEvidence[], market: string): boolean {
  if (evidence.length === 0) return false;
  return evidence.every((item) => {
    const targetType = item.queryParameters["filter.type"];
    const locationKey = targetType ? expectedLocationKey(targetType) : undefined;
    if (!targetType) return false;
    if (!locationKey) return Boolean(item.queryParameters["filter.location.query"] || item.queryParameters["signal.location.query"]);
    return item.queryParameters[locationKey] === market;
  });
}

function targetObservations(evidence: AffinityEvidence[]): AffinityEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.provenance.providerId}:${item.objectEntityCategory}:${item.objectEntityId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function targetTypesOf(evidence: AffinityEvidence[]): string[] {
  return [...new Set(evidence.map((item) => item.queryParameters["filter.type"]).filter((value): value is string => Boolean(value)))];
}

function exactObservedEquality(left: AffinityEvidence[], right: AffinityEvidence[]): boolean {
  const a = targetObservations(left);
  const b = targetObservations(right);
  if (a.length !== b.length || a.length === 0) return false;
  return a.every((item, index) => {
    const other = b[index];
    return item.provenance.providerId === other.provenance.providerId
      && item.objectEntityCategory === other.objectEntityCategory
      && item.objectEntityId === other.objectEntityId
      && item.providerScore === other.providerScore
      && item.providerScoreScale === other.providerScoreScale;
  });
}

export function requestFingerprint(request: ResearchRequestDescriptor): string {
  return [
    request.subjectEntityId,
    request.targetEntityType,
    request.market,
    request.geographicStrategy,
    request.explainability ? "explainability:on" : "explainability:off",
  ].join("|");
}

function materialRequestKey(request: ResearchRequestDescriptor): string {
  return [request.subjectEntityId, request.targetEntityType, request.market, request.geographicStrategy].join("|");
}

function addGap(gaps: EvidenceGap[], gap: EvidenceGap): void {
  if (!gaps.some((item) => item.type === gap.type && item.trigger === gap.trigger)) gaps.push(gap);
}

export function classifyEvidenceGaps(input: DecisionPolicyInput): EvidenceGap[] {
  const gaps: EvidenceGap[] = [];
  const { objective, snapshots } = input;

  if (isUnsupportedObjective(objective)) {
    addGap(gaps, {
      type: "unsupported-question",
      trigger: objective.requestedOutcome,
      whyItMatters: "Affinity evidence cannot establish commercial outcomes or unsupported audience facts.",
      actionable: false,
      evidenceIds: [],
      allowedActions: ["UNSUPPORTED"],
    });
    return gaps;
  }

  for (const market of objective.markets) {
    const snapshot = snapshots.find((item) => item.market === market);
    if (!snapshot?.research) {
      addGap(gaps, { type: "missing-market-evidence", trigger: market, whyItMatters: "Both requested markets need evidence for a comparison.", actionable: false, evidenceIds: [], allowedActions: ["INSUFFICIENT_EVIDENCE"] });
      continue;
    }
    if (snapshot.research.status !== "completed") {
      addGap(gaps, { type: "partial-research", trigger: market, whyItMatters: "Partial or failed research cannot support a complete market comparison.", actionable: false, evidenceIds: snapshot.research.evidence.map((item) => item.id), allowedActions: ["INSUFFICIENT_EVIDENCE"] });
    }
    if (snapshot.research.resolutions.length > 0 && snapshot.research.resolutions.some((resolution) => resolution.status !== "resolved")) {
      addGap(gaps, { type: "entity-resolution", trigger: market, whyItMatters: "The cultural subject was not resolved to a unique provider identity.", actionable: false, evidenceIds: [], allowedActions: ["INSUFFICIENT_EVIDENCE"] });
    }
    const view = evidenceView(snapshot);
    if (view.invalidEvidenceIds.length > 0) addGap(gaps, { type: "invalid-evidence", trigger: market, whyItMatters: "Unverifiable observations cannot support a decision assessment.", actionable: false, evidenceIds: view.invalidEvidenceIds, allowedActions: ["INSUFFICIENT_EVIDENCE"] });
    if (view.missingProvenanceIds.length > 0 || !hasCompatibleProvenance(view.evidence, market)) addGap(gaps, { type: "query-provenance", trigger: market, whyItMatters: "The market and effective provider query must be retained to interpret the evidence.", actionable: false, evidenceIds: view.missingProvenanceIds, allowedActions: ["INSUFFICIENT_EVIDENCE"] });
    if (view.evidence.length === 0) addGap(gaps, { type: "missing-market-evidence", trigger: market, whyItMatters: "A market without validated observations cannot be compared.", actionable: false, evidenceIds: [], allowedActions: ["INSUFFICIENT_EVIDENCE"] });
    if (objective.requiresExplainability && view.evidence.some((item) => !item.explainability)) addGap(gaps, { type: "missing-explainability", trigger: market, whyItMatters: "The requested explanation detail was not returned by the provider.", actionable: false, evidenceIds: view.evidence.map((item) => item.id), allowedActions: ["STOP"] });

    if (objective.requestedTargetType && view.evidence.length > 0 && !targetTypesOf(view.evidence).includes(objective.requestedTargetType)) {
      const authorized = objective.allowedTargetTypes.includes(objective.requestedTargetType);
      addGap(gaps, { type: "requested-dimension", trigger: market, whyItMatters: "The explicit research dimension differs from the observed target category.", actionable: authorized, evidenceIds: view.evidence.map((item) => item.id), allowedActions: authorized ? ["FOLLOW_UP_APPROVED"] : ["INSUFFICIENT_EVIDENCE"] });
    }
  }

  if (objective.markets.length === 2) {
    const views = objective.markets.map((market) => evidenceView(snapshots.find((item) => item.market === market) ?? { market }));
    if (views.every((view) => view.evidence.length > 0) && snapshots.every((snapshot) => snapshot.research?.status === "completed") && exactObservedEquality(views[0].evidence, views[1].evidence)) {
      addGap(gaps, { type: "identical-observations", trigger: objective.markets.join(" vs "), whyItMatters: "The returned observations do not show geographic differentiation.", actionable: false, evidenceIds: views.flatMap((view) => view.evidence.map((item) => item.id)), allowedActions: ["STOP"] });
    }
  }

  return gaps;
}

export function decideNextAction(input: DecisionPolicyInput, gaps = classifyEvidenceGaps(input)): AgentDecision {
  const currentBudget = budget(input.budget);
  const unsupported = gaps.find((gap) => gap.type === "unsupported-question");
  if (unsupported) return { action: "UNSUPPORTED", reason: unsupported.whyItMatters, supportingEvidenceIds: [], stopReason: "unsupported-conclusion" };

  const incomplete = gaps.find((gap) => ["missing-market-evidence", "partial-research", "invalid-evidence", "query-provenance"].includes(gap.type));
  const unresolved = gaps.find((gap) => gap.type === "entity-resolution");
  if (unresolved) return { action: "INSUFFICIENT_EVIDENCE", reason: unresolved.whyItMatters, supportingEvidenceIds: [], stopReason: "entity-resolution-required" };
  if (incomplete && !gaps.some((gap) => gap.actionable)) return { action: "INSUFFICIENT_EVIDENCE", reason: incomplete.whyItMatters, supportingEvidenceIds: incomplete.evidenceIds, stopReason: incomplete.type === "partial-research" ? "partial-evidence-stop" : "provider-failure" };

  const actionable = gaps.find((gap) => gap.actionable && gap.type === "requested-dimension");
  const unauthorizedDimension = gaps.find((gap) => gap.type === "requested-dimension" && !gap.actionable);
  if (unauthorizedDimension) return { action: "UNSUPPORTED", reason: "The requested research dimension was not explicitly authorized.", supportingEvidenceIds: unauthorizedDimension.evidenceIds, stopReason: "unsupported-capability" };
  if (actionable && input.proposedFollowUp) {
    const fingerprint = requestFingerprint(input.proposedFollowUp);
    const duplicate = (input.completedRequests ?? []).some((request) => materialRequestKey(request) === materialRequestKey(input.proposedFollowUp!));
    const usedForMarket = currentBudget.followUpAffinityByMarket[input.proposedFollowUp.market] ?? 0;
    const now = input.nowMs ?? Date.now();
    if (input.supportedTargetTypes && !input.supportedTargetTypes.includes(input.proposedFollowUp.targetEntityType)) return { action: "UNSUPPORTED", reason: "The proposed target category is not supported by the configured provider.", supportingEvidenceIds: actionable.evidenceIds, requestFingerprint: fingerprint, stopReason: "unsupported-capability" };
    if (duplicate) return { action: "STOP", reason: "The proposed follow-up duplicates an executed research request.", supportingEvidenceIds: actionable.evidenceIds, requestFingerprint: fingerprint, stopReason: "duplicate-request-blocked" };
    if (currentBudget.logicalOperationsUsed >= currentBudget.maxLogicalOperations || currentBudget.followUpRoundsUsed >= currentBudget.maxFollowUpRounds || usedForMarket >= currentBudget.maxFollowUpAffinityPerMarket) return { action: "STOP", reason: "The bounded logical research budget is exhausted.", supportingEvidenceIds: actionable.evidenceIds, requestFingerprint: fingerprint, stopReason: "budget-exhausted" };
    if (currentBudget.deadlineAtMs !== undefined && now >= currentBudget.deadlineAtMs) return { action: "STOP", reason: "The execution-time budget is exhausted.", supportingEvidenceIds: actionable.evidenceIds, requestFingerprint: fingerprint, stopReason: "execution-time-budget" };
    return { action: "FOLLOW_UP_APPROVED", reason: "The explicitly requested and authorized research dimension is materially different and within budget.", supportingEvidenceIds: actionable.evidenceIds, selectedRequest: input.proposedFollowUp, requestFingerprint: fingerprint };
  }

  if (incomplete) return { action: "INSUFFICIENT_EVIDENCE", reason: incomplete.whyItMatters, supportingEvidenceIds: incomplete.evidenceIds, stopReason: "partial-evidence-stop" };
  if (gaps.some((gap) => gap.type === "identical-observations" || gap.type === "missing-explainability")) return { action: "STOP", reason: "No supported follow-up addresses the remaining evidence limitation.", supportingEvidenceIds: gaps.flatMap((gap) => gap.evidenceIds), stopReason: "no-actionable-gap" };
  return { action: "STOP", reason: "The available validated evidence is sufficient for the supported cultural assessment.", supportingEvidenceIds: [], stopReason: "evidence-sufficient" };
}

export function defaultResearchBudget(overrides?: Partial<ResearchBudget>): ResearchBudget {
  return budget(overrides);
}
