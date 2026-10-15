import type { DecisionRecommendation } from "@/core/decisions/contracts";
import type { EvidenceRegistry } from "@/core/evidence/registry";

export type RecommendationClaim = {
  claim: string;
  subjectEntityId?: string;
  objectEntityId?: string;
  evidenceIds: string[];
};

export type RecommendationClaimAssessment = {
  claim: string;
  classification: "provider-backed" | "interpretation";
  evidenceIds: string[];
  unsupportedReason?: "missing-evidence" | "unrelated-evidence" | "missing-entity-pair";
};

export type RecommendationSupportAssessment = {
  recommendation: DecisionRecommendation;
  classification: "interpretation";
  claims: RecommendationClaimAssessment[];
};

/**
 * A recommendation remains an interpretation. A claim can be marked
 * provider-backed only when validated evidence directly names the claim's
 * subject/object pair; merely citing any evidence is insufficient.
 */
export function assessRecommendationSupport(
  recommendation: DecisionRecommendation,
  claims: RecommendationClaim[],
  registry: EvidenceRegistry,
): RecommendationSupportAssessment {
  return {
    recommendation,
    classification: "interpretation",
    claims: claims.map((claim) => {
      const evidence = claim.evidenceIds
        .map((id) => registry.getEvidence(id))
        .filter((item): item is NonNullable<typeof item> => item !== undefined);
      if (evidence.length === 0 || evidence.length !== claim.evidenceIds.length) {
        return { claim: claim.claim, classification: "interpretation", evidenceIds: claim.evidenceIds, unsupportedReason: "missing-evidence" };
      }
      if (!claim.subjectEntityId || !claim.objectEntityId) {
        return { claim: claim.claim, classification: "interpretation", evidenceIds: claim.evidenceIds, unsupportedReason: "missing-entity-pair" };
      }
      const directlySupported = evidence.some((item) =>
        item.kind === "affinity" &&
        item.subjectEntityId === claim.subjectEntityId &&
        item.objectEntityId === claim.objectEntityId,
      );
      return directlySupported
        ? { claim: claim.claim, classification: "provider-backed", evidenceIds: claim.evidenceIds }
        : { claim: claim.claim, classification: "interpretation", evidenceIds: claim.evidenceIds, unsupportedReason: "unrelated-evidence" };
    }),
  };
}
