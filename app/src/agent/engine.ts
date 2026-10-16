import { EvidenceRegistry } from "@/core/evidence/registry";
import { buildEvidenceGraph, type EvidenceGraph } from "@/core/evidence/graph";
import type { CulturalIntelligenceProvider, ProviderDiagnostic } from "@/providers/interfaces/contracts";
import {
  type AnalysisError,
  type AnalysisResult,
  type BlueprintClaim,
  type LaunchBlueprint,
  type LaunchScenarioInput,
} from "@/agent/contracts";
import { extractScenario, createResearchPlan, resolveEntityCandidates } from "@/agent/planning";
import type { StructuredModelProvider } from "@/agent/model";
import { LaunchBlueprintSchema } from "@/agent/contracts";

type IdFactory = () => string;

function error(code: AnalysisError["code"], message: string): AnalysisError { return { code, message }; }
function emptyGraph(): EvidenceGraph { return { nodes: [], edges: [] }; }

function validateBlueprintClaims(blueprint: LaunchBlueprint, registry: EvidenceRegistry): { blueprint: LaunchBlueprint; limitations: string[] } {
  const limitations: string[] = [];
  const sections = ["who", "where", "withWhat", "alongsideWhom", "why"] as const;
  const normalized = { ...blueprint };
  for (const section of sections) {
    normalized[section] = {
      claims: blueprint[section].claims.map((claim: BlueprintClaim) => {
        const knownEvidence = claim.evidenceIds.filter((id) => registry.has(id));
        const hadUnknown = knownEvidence.length !== claim.evidenceIds.length;
        let classification = claim.classification;
        if (hadUnknown) {
          classification = "unverified-suggestion";
          limitations.push(`Removed fabricated or unknown evidence references from claim: ${claim.text}`);
        }
        if (classification === "verified-observation") {
          const directlySupported = Boolean(claim.subjectEntityId && claim.objectEntityId && knownEvidence.some((id) => {
            const item = registry.getEvidence(id);
            return item?.kind === "affinity" && item.subjectEntityId === claim.subjectEntityId && item.objectEntityId === claim.objectEntityId;
          }));
          if (!directlySupported) {
            classification = "interpretation";
            limitations.push(`Downgraded unsupported provider-backed claim: ${claim.text}`);
          }
        }
        return { ...claim, evidenceIds: knownEvidence, classification };
      }),
    };
  }
  return { blueprint: LaunchBlueprintSchema.parse(normalized), limitations };
}

export class DecisionEngine {
  private readonly idFactory: IdFactory;
  private readonly provider: CulturalIntelligenceProvider;
  private readonly model?: StructuredModelProvider;

  constructor(
    provider: CulturalIntelligenceProvider,
    model?: StructuredModelProvider,
    idFactory: IdFactory = () => crypto.randomUUID(),
  ) {
    this.provider = provider;
    this.model = model;
    this.idFactory = idFactory;
  }

  /** Executes only provider-backed research, without requiring Gemini. */
  async research(input: LaunchScenarioInput | unknown): Promise<AnalysisResult> {
    const analysisId = this.idFactory();
    const extracted = extractScenario(input);
    const diagnostics: ProviderDiagnostic[] = [];
    if (!extracted.ok) return { analysisId, status: "failed", scenario: { productConcept: "", seedQueries: [], targetTypes: [] }, resolutions: [], evidence: [], graph: emptyGraph(), limitations: [], errors: [error("INVALID_SCENARIO", extracted.message)], diagnostics };
    const scenario = extracted.scenario;
    const planned = createResearchPlan(scenario, this.provider.getCapabilities());
    if (!planned.ok) return { analysisId, status: "failed", scenario, resolutions: [], evidence: [], graph: emptyGraph(), limitations: [], errors: [error(planned.code, planned.message)], diagnostics };
    const registry = new EvidenceRegistry();
    const resolutions = [];
    const errors: AnalysisError[] = [];
    for (const query of planned.plan.seedQueries) {
      const result = await this.provider.searchEntities({ query, category: planned.plan.seedCategory, limit: planned.plan.maxEntityResults });
      diagnostics.push(...(result.diagnostics ?? []));
      if (!result.ok) {
        errors.push(error(result.error.code === "UNSUPPORTED_CAPABILITY" ? "UNSUPPORTED_CAPABILITY" : "PROVIDER_FAILURE", result.error.message));
        resolutions.push({ query, status: "not-found" as const, candidates: [] });
        continue;
      }
      const resolution = resolveEntityCandidates(query, result.data, {
        category: planned.plan.seedCategory,
        selectedEntityId: planned.plan.seedEntityId,
      });
      if (resolution.status === "not-found") {
        errors.push(error("ENTITY_NOT_FOUND", planned.plan.seedCategory ? `No exact ${planned.plan.seedCategory} entity matched seed query: ${query}` : `No exact entity matched seed query: ${query}`));
      } else if (resolution.status === "ambiguous") {
        errors.push(error("AMBIGUOUS_ENTITY", `Multiple equally valid candidates matched seed query: ${query}`));
      } else if (resolution.entity) {
        registry.registerEntity(resolution.entity);
      }
      resolutions.push(resolution);
    }
    const affinityRequests = new Set<string>();
    for (const resolution of resolutions) {
      if (resolution.status !== "resolved" || !resolution.entity) continue;
      for (const targetType of planned.plan.targetTypes) {
        const requestKey = JSON.stringify([resolution.entity.id, targetType, planned.plan.locationQuery ?? "", planned.plan.explainability]);
        if (affinityRequests.has(requestKey)) continue;
        affinityRequests.add(requestKey);
        const result = await this.provider.discoverAffinity({
          entityId: resolution.entity.id,
          sourceEntityCategory: resolution.entity.category,
          sourceEntityName: resolution.entity.name,
          targetType,
          locationQuery: planned.plan.locationQuery,
          limit: planned.plan.maxAffinityResults,
          explainability: planned.plan.explainability,
        });
        diagnostics.push(...(result.diagnostics ?? []));
        if (!result.ok) {
          errors.push(error(result.error.code === "UNSUPPORTED_CAPABILITY" ? "UNSUPPORTED_CAPABILITY" : "PROVIDER_FAILURE", result.error.message));
          continue;
        }
        if (result.data.length === 0) {
          errors.push(error("EMPTY_RESULTS", `No affinity results for ${resolution.entity.name}`));
          continue;
        }
        for (const evidence of result.data) {
          if (evidence.kind === "affinity" && !registry.has(evidence.objectEntityId)) {
            registry.registerEntity({
              id: evidence.objectEntityId,
              providerId: evidence.provenance.providerId,
              name: evidence.objectEntityName ?? evidence.objectEntityId,
              category: evidence.objectEntityCategory,
              geographicContext: evidence.geographicContext,
              sourceReference: `${evidence.provenance.providerId}:entity:${evidence.objectEntityId}`,
              metadata: { providerEntityId: evidence.objectEntityId },
            });
          }
          const registered = registry.registerEvidence(evidence);
          if (!registered.valid) errors.push(error("EVIDENCE_VALIDATION_FAILURE", registered.errors.join("; ")));
        }
      }
    }
    const evidence = registry.listValidatedEvidence();
    const limitations = [...planned.plan.limitations];
    const graph = buildEvidenceGraph(registry);
    return {
      analysisId,
      status: errors.length || evidence.length === 0 ? "partial" : "completed",
      scenario,
      plan: planned.plan,
      resolutions,
      evidence,
      graph,
      limitations,
      errors,
      diagnostics,
    };
  }

  async analyze(input: LaunchScenarioInput | unknown): Promise<AnalysisResult> {
    const researched = await this.research(input);
    if (!this.model) {
      if (researched.evidence.length > 0) researched.errors.push(error("MODEL_UNAVAILABLE", "No strategic interpretation provider is configured"));
      researched.status = "partial";
      return researched;
    }
    if (researched.evidence.length === 0) return researched;
    const modelResult = await this.model.generateBlueprint({
      productConcept: researched.scenario.productConcept,
      launchLocation: researched.scenario.launchLocation,
      requestedOutcome: researched.scenario.requestedOutcome,
      evidence: researched.evidence,
    });
    if (!modelResult.ok) {
      researched.errors.push(error(modelResult.error.code, modelResult.error.message));
      researched.status = "partial";
      return researched;
    }
    const registry = new EvidenceRegistry();
    for (const resolution of researched.resolutions) if (resolution.entity) registry.registerEntity(resolution.entity);
    for (const evidence of researched.evidence) {
      if (evidence.kind === "affinity" && !registry.has(evidence.objectEntityId)) registry.registerEntity({ id: evidence.objectEntityId, providerId: evidence.provenance.providerId, name: evidence.objectEntityName ?? evidence.objectEntityId, category: evidence.objectEntityCategory, geographicContext: evidence.geographicContext, sourceReference: `${evidence.provenance.providerId}:entity:${evidence.objectEntityId}`, metadata: { providerEntityId: evidence.objectEntityId } });
      registry.registerEvidence(evidence);
    }
    const checked = validateBlueprintClaims(modelResult.blueprint, registry);
    researched.limitations.push(...checked.limitations);
    researched.blueprint = checked.blueprint;
    researched.status = researched.errors.length ? "partial" : "completed";
    return researched;
  }
}
