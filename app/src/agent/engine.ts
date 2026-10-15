import { EvidenceRegistry } from "@/core/evidence/registry";
import type { CulturalIntelligenceProvider } from "@/providers/interfaces/contracts";
import {
  type AnalysisError,
  type AnalysisResult,
  type BlueprintClaim,
  type LaunchBlueprint,
  type LaunchScenarioInput,
} from "@/agent/contracts";
import { extractScenario, createResearchPlan } from "@/agent/planning";
import type { StructuredModelProvider } from "@/agent/model";
import { LaunchBlueprintSchema } from "@/agent/contracts";

type IdFactory = () => string;

function error(code: AnalysisError["code"], message: string): AnalysisError { return { code, message }; }

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
  private readonly model: StructuredModelProvider;

  constructor(
    provider: CulturalIntelligenceProvider,
    model: StructuredModelProvider,
    idFactory: IdFactory = () => crypto.randomUUID(),
  ) {
    this.provider = provider;
    this.model = model;
    this.idFactory = idFactory;
  }

  async analyze(input: LaunchScenarioInput | unknown): Promise<AnalysisResult> {
    const analysisId = this.idFactory();
    const extracted = extractScenario(input);
    if (!extracted.ok) return { analysisId, status: "failed", scenario: { productConcept: "", seedQueries: [], targetTypes: [] }, resolutions: [], evidence: [], limitations: [], errors: [error("INVALID_SCENARIO", extracted.message)] };
    const scenario = extracted.scenario;
    const planned = createResearchPlan(scenario, this.provider.getCapabilities());
    if (!planned.ok) return { analysisId, status: "failed", scenario, resolutions: [], evidence: [], limitations: [], errors: [error(planned.code, planned.message)] };
    const registry = new EvidenceRegistry();
    const resolutions = [];
    const errors: AnalysisError[] = [];
    for (const query of planned.plan.seedQueries) {
      const result = await this.provider.searchEntities({ query, limit: planned.plan.maxEntityResults });
      if (!result.ok) {
        errors.push(error(result.error.code === "UNSUPPORTED_CAPABILITY" ? "UNSUPPORTED_CAPABILITY" : "PROVIDER_FAILURE", result.error.message));
        resolutions.push({ query, status: "not-found" as const, candidates: [] });
        continue;
      }
      const candidates = result.data;
      if (candidates.length === 0) {
        errors.push(error("ENTITY_NOT_FOUND", `No entity matched seed query: ${query}`));
        resolutions.push({ query, status: "not-found" as const, candidates });
      } else if (candidates.length !== 1) {
        errors.push(error("AMBIGUOUS_ENTITY", `Seed query returned multiple candidates: ${query}`));
        resolutions.push({ query, status: "ambiguous" as const, candidates });
      } else {
        registry.registerEntity(candidates[0]);
        resolutions.push({ query, status: "resolved" as const, entity: candidates[0], candidates });
      }
    }
    for (const resolution of resolutions) {
      if (resolution.status !== "resolved" || !resolution.entity) continue;
      for (const targetType of planned.plan.targetTypes) {
        const result = await this.provider.discoverAffinity({
          entityId: resolution.entity.id,
          sourceEntityCategory: resolution.entity.category,
          sourceEntityName: resolution.entity.name,
          targetType,
          locationQuery: planned.plan.locationQuery,
          limit: planned.plan.maxAffinityResults,
          explainability: planned.plan.explainability,
        });
        if (!result.ok) {
          errors.push(error(result.error.code === "UNSUPPORTED_CAPABILITY" ? "UNSUPPORTED_CAPABILITY" : "PROVIDER_FAILURE", result.error.message));
          continue;
        }
        if (result.data.length === 0) {
          errors.push(error("EMPTY_RESULTS", `No affinity results for ${resolution.entity.name}`));
          continue;
        }
        for (const evidence of result.data) {
          // The provider contract carries target identity on each normalized
          // evidence record. Register only that identity context; the edge,
          // score, geography and provenance still come exclusively from the
          // provider evidence and are validated by the Phase 2 registry.
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
    if (evidence.length === 0) return { analysisId, status: "partial", scenario, plan: planned.plan, resolutions, evidence, limitations, errors };
    const modelResult = await this.model.generateBlueprint({ productConcept: scenario.productConcept, launchLocation: scenario.launchLocation, requestedOutcome: scenario.requestedOutcome, evidence });
    if (!modelResult.ok) {
      const code = modelResult.error.code === "MODEL_TIMEOUT" ? "MODEL_TIMEOUT" : modelResult.error.code === "MODEL_UNAVAILABLE" ? "MODEL_UNAVAILABLE" : "MODEL_INVALID_OUTPUT";
      errors.push(error(code, modelResult.error.message));
      return { analysisId, status: "partial", scenario, plan: planned.plan, resolutions, evidence, limitations, errors };
    }
    const checked = validateBlueprintClaims(modelResult.blueprint, registry);
    limitations.push(...checked.limitations);
    return { analysisId, status: errors.length ? "partial" : "completed", scenario, plan: planned.plan, resolutions, evidence, blueprint: checked.blueprint, limitations, errors };
  }
}
