import type { AnalysisResult } from "@/agent/contracts";
import { DecisionEngine } from "@/agent/engine";
import {
  SUPPORTED_AGENT_TARGET_TYPES,
  type AgentAuthorization,
  type ResearchBudget,
  type ResearchObjective,
  type ResearchRequestDescriptor,
  type TrustedResearchMetadata,
} from "@/agent/decision/contracts";
import { executeBoundedResearch, type BoundedResearchExecutorResult } from "@/agent/decision/orchestrator";
import type { CulturalEntity } from "@/core/entities/types";
import { EvidenceRegistry } from "@/core/evidence/registry";
import { CulturalEvidenceSchema } from "@/core/evidence/types";
import { CulturalEntitySchema } from "@/core/entities/types";
import type { CulturalIntelligenceProvider } from "@/providers/interfaces/contracts";
import { z } from "zod";

export const AgentResearchConfigSchema = z.object({
  enabled: z.boolean(),
  objective: z.object({
    kind: z.enum(["geographic-cultural-comparison", "cultural-positioning", "local-entity-discovery"]),
    requestedTargetTypes: z.array(z.string().trim().min(1).max(80)).max(1).default([]),
    requestedOutcome: z.string().trim().min(1).max(300).optional(),
  }).strict().optional(),
  authorizedTargetTypes: z.array(z.string().trim().min(1).max(80)).max(2).optional(),
}).strict();

export type AgentResearchConfig = z.infer<typeof AgentResearchConfigSchema>;

export type ServerResearchBundle = {
  market: string;
  result: AnalysisResult;
};

export type AgentIntegrationInput = {
  engine: DecisionEngine;
  provider: CulturalIntelligenceProvider;
  authorization: AgentAuthorization;
  researches: ServerResearchBundle[];
  deadlineAtMs: number;
  nowMs?: () => number;
  providerTimeoutMs?: number;
  responseReserveMs?: number;
};

export type AgentIntegrationResult =
  | { ok: true; execution: BoundedResearchExecutorResult }
  | { ok: false; code: "INVALID_AUTHORIZATION" | "TRUSTED_METADATA_UNAVAILABLE" | "INVALID_RESEARCH_STATE"; message: string };

export type AgentAuthorizationValidation =
  | { ok: true; authorization?: AgentAuthorization }
  | { ok: false; message: string };

function isSupportedTarget(targetType: string): boolean {
  return (SUPPORTED_AGENT_TARGET_TYPES as readonly string[]).includes(targetType);
}

function geographicStrategy(targetType: string): ResearchRequestDescriptor["geographicStrategy"] {
  return targetType === "urn:entity:brand" ? "signal.location.query" : "filter.location.query";
}

function validateAuthorization(authorization: AgentAuthorization): string | undefined {
  const markets = new Set(authorization.markets);
  if (!authorization.initialTargetType || !isSupportedTarget(authorization.initialTargetType)) return "The initial target category is unsupported.";
  if (markets.size === 0 || markets.size !== authorization.markets.length) return "Authorization must contain unique markets.";
  if (new Set(authorization.allowedTargetTypes).size !== authorization.allowedTargetTypes.length) return "Authorization target categories must be unique.";
  if (!authorization.allowedTargetTypes.includes(authorization.initialTargetType)) return "The initial target must be included in the authorized target categories.";
  if (authorization.allowedTargetTypes.some((target) => !isSupportedTarget(target))) return "Authorization contains an unsupported target category.";
  if (authorization.objective.markets.length !== authorization.markets.length || authorization.objective.markets.some((market) => !markets.has(market))) return "Objective markets must match the authorized markets.";
  if (authorization.objective.allowedTargetTypes.some((target) => !authorization.allowedTargetTypes.includes(target))) return "The objective requests a target category outside authorization.";
  if (authorization.objective.requestedTargetType && !authorization.allowedTargetTypes.includes(authorization.objective.requestedTargetType)) return "The requested follow-up target is not explicitly authorized.";
  if (authorization.objective.requestedTargetType && !isSupportedTarget(authorization.objective.requestedTargetType)) return "The requested follow-up target is unsupported.";
  return undefined;
}

export function buildAgentAuthorization(config: AgentResearchConfig, initialTargetType: string, markets: string[]): AgentAuthorizationValidation {
  if (!config.enabled) return { ok: true };
  if (!config.objective || !config.authorizedTargetTypes) return { ok: false, message: "Enabled agent research requires an objective and authorized target categories." };
  const requestedTargetType = config.objective.requestedTargetTypes[0];
  const authorization: AgentAuthorization = {
    initialTargetType,
    allowedTargetTypes: [...config.authorizedTargetTypes],
    markets: [...markets],
    objective: {
      kind: config.objective.kind,
      requestedOutcome: config.objective.requestedOutcome ?? `Bounded ${config.objective.kind} research`,
      markets: [...markets],
      allowedTargetTypes: [...config.authorizedTargetTypes],
      requestedTargetType,
    },
  };
  const error = validateAuthorization(authorization);
  return error ? { ok: false, message: error } : { ok: true, authorization };
}

export function compatibleEntityIdentity(existing: CulturalEntity, incoming: CulturalEntity): boolean {
  return existing.id === incoming.id
    && existing.providerId === incoming.providerId
    && existing.category === incoming.category
    && existing.name === incoming.name
    && existing.sourceReference === incoming.sourceReference;
}

function registerEntityOnce(
  registry: EvidenceRegistry,
  registeredEntities: Map<string, CulturalEntity>,
  entity: CulturalEntity,
): void {
  const parsed = CulturalEntitySchema.safeParse(entity);
  if (!parsed.success) throw new Error("Cannot register an invalid cultural entity");

  const existing = registeredEntities.get(parsed.data.id);
  if (existing) {
    if (!compatibleEntityIdentity(existing, parsed.data)) throw new Error(`Entity identity collision: ${parsed.data.id}`);
    return;
  }

  registry.registerEntity(parsed.data);
  registeredEntities.set(parsed.data.id, parsed.data);
}

function registerResearchState(
  registry: EvidenceRegistry,
  registeredEntities: Map<string, CulturalEntity>,
  bundle: ServerResearchBundle,
): string | undefined {
  try {
    for (const resolution of bundle.result.resolutions) if (resolution.entity) registerEntityOnce(registry, registeredEntities, resolution.entity);
    for (const raw of bundle.result.evidence) {
      const parsed = CulturalEvidenceSchema.safeParse(raw);
      if (!parsed.success) return `Initial evidence ${typeof raw === "object" && raw && "id" in raw ? String(raw.id) : "unknown"} failed schema validation.`;
      const evidence = parsed.data;
      if (evidence.kind === "affinity" && !registry.has(evidence.objectEntityId)) {
        registerEntityOnce(registry, registeredEntities, { id: evidence.objectEntityId, providerId: evidence.provenance.providerId, name: evidence.objectEntityName ?? evidence.objectEntityId, category: evidence.objectEntityCategory, geographicContext: evidence.geographicContext, sourceReference: `${evidence.provenance.providerId}:entity:${evidence.objectEntityId}`, metadata: { providerEntityId: evidence.objectEntityId } });
      }
      const registered = registry.registerEvidence(evidence);
      if (!registered.valid) return `Initial evidence ${evidence.id} failed registry validation: ${registered.errors.join("; ")}`;
    }
  } catch (error) {
    return error instanceof Error ? error.message : "Initial research could not be registered safely.";
  }
  return undefined;
}

function combineMetadata(metadata: TrustedResearchMetadata[]): TrustedResearchMetadata {
  const subjects = new Map<string, CulturalEntity>();
  for (const item of metadata) for (const subject of item.resolvedSubjects) subjects.set(subject.id, subject);
  const attemptsKnown = metadata.every((item) => item.providerAttemptsUsed !== undefined);
  return {
    logicalOperationCount: metadata.reduce((total, item) => total + item.logicalOperationCount, 0),
    providerAttemptsUsed: attemptsKnown ? metadata.reduce((total, item) => total + (item.providerAttemptsUsed ?? 0), 0) : undefined,
    completedRequests: metadata.flatMap((item) => item.completedRequests),
    resolvedSubjects: [...subjects.values()],
  };
}

function budgetFromMetadata(metadata: TrustedResearchMetadata, deadlineAtMs: number): ResearchBudget {
  return {
    logicalOperationsUsed: metadata.logicalOperationCount,
    providerAttemptsUsed: metadata.providerAttemptsUsed,
    maxLogicalOperations: 6,
    followUpRoundsUsed: 0,
    maxFollowUpRounds: 1,
    followUpAffinityByMarket: {},
    maxFollowUpAffinityPerMarket: 1,
    deadlineAtMs,
  };
}

function followUpRequests(authorization: AgentAuthorization, researches: ServerResearchBundle[], metadataByMarket: Map<string, TrustedResearchMetadata>): ResearchRequestDescriptor[] | undefined {
  const targetType = authorization.objective.requestedTargetType;
  if (!targetType || targetType === authorization.initialTargetType) return [];
  const requests: ResearchRequestDescriptor[] = [];
  for (const market of authorization.markets) {
    const bundle = researches.find((item) => item.market === market);
    if (bundle?.result.evidence.some((item) => item.queryParameters["filter.type"] === targetType)) continue;
    const subject = metadataByMarket.get(market)?.resolvedSubjects[0];
    if (!subject) return undefined;
    requests.push({ subjectEntityId: subject.id, targetEntityType: targetType, market, geographicStrategy: geographicStrategy(targetType), explainability: Boolean(authorization.objective.requiresExplainability) });
  }
  return requests;
}

/**
 * Trusted server-side bridge from DecisionEngine results to the bounded
 * executor. It is intentionally not called by an API route in this phase.
 */
export async function integrateBoundedAgentResearch(input: AgentIntegrationInput): Promise<AgentIntegrationResult> {
  const authorizationError = validateAuthorization(input.authorization);
  if (authorizationError) return { ok: false, code: "INVALID_AUTHORIZATION", message: authorizationError };
  if (!Number.isFinite(input.deadlineAtMs) || input.deadlineAtMs <= (input.nowMs?.() ?? Date.now())) return { ok: false, code: "INVALID_RESEARCH_STATE", message: "A future absolute execution deadline is required." };
  if (input.researches.length !== input.authorization.markets.length || new Set(input.researches.map((item) => item.market)).size !== input.researches.length) return { ok: false, code: "INVALID_RESEARCH_STATE", message: "One unique server research result is required per authorized market." };

  const metadata: TrustedResearchMetadata[] = [];
  const registry = new EvidenceRegistry();
  const registeredEntities = new Map<string, CulturalEntity>();
  for (const bundle of input.researches) {
    if (!input.authorization.markets.includes(bundle.market) || bundle.result.scenario.launchLocation !== bundle.market) return { ok: false, code: "INVALID_RESEARCH_STATE", message: "Research market context does not match authorization." };
    if (!bundle.result.scenario.targetTypes.includes(input.authorization.initialTargetType)) return { ok: false, code: "INVALID_RESEARCH_STATE", message: "Initial research target does not match authorization." };
    const trusted = input.engine.getTrustedResearchMetadata(bundle.result);
    if (!trusted) return { ok: false, code: "TRUSTED_METADATA_UNAVAILABLE", message: "Server execution metadata is unavailable for the supplied research result." };
    if (trusted.completedRequests.some((request) => request.market !== bundle.market)) return { ok: false, code: "INVALID_RESEARCH_STATE", message: "Trusted request metadata crossed market boundaries." };
    if (trusted.logicalOperationCount < 0 || !Number.isInteger(trusted.logicalOperationCount)) return { ok: false, code: "INVALID_RESEARCH_STATE", message: "Trusted logical operation usage is invalid." };
    const registrationError = registerResearchState(registry, registeredEntities, bundle);
    if (registrationError) return { ok: false, code: "INVALID_RESEARCH_STATE", message: registrationError };
    metadata.push(trusted);
  }

  const combined = combineMetadata(metadata);
  const requests = followUpRequests(input.authorization, input.researches, new Map(input.researches.map((bundle, index) => [bundle.market, metadata[index]])));
  if (requests === undefined) return { ok: false, code: "INVALID_RESEARCH_STATE", message: "An explicitly requested follow-up has no trusted resolved subject." };
  const objective: ResearchObjective = { ...input.authorization.objective, allowedTargetTypes: [...input.authorization.allowedTargetTypes] };
  const execution = await executeBoundedResearch({
    objective,
    snapshots: input.researches.map((bundle) => ({ market: bundle.market, research: bundle.result })),
    registry,
    resolvedSubjects: combined.resolvedSubjects,
    budget: budgetFromMetadata(combined, input.deadlineAtMs),
    completedRequests: combined.completedRequests,
    provider: input.provider,
    followUpRequests: requests,
    supportedTargetTypes: SUPPORTED_AGENT_TARGET_TYPES,
    nowMs: input.nowMs,
    providerTimeoutMs: input.providerTimeoutMs,
    responseReserveMs: input.responseReserveMs,
  });
  return { ok: true, execution };
}
