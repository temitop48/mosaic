import { StrategicInterpretationSchema, type CounterfactualResult, type StrategicClaim, type StrategicInterpretation } from "@/core/counterfactuals/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";
import type { StrategicModelEvidence } from "@/agent/model";

export type StrategicValidationContext = {
  baselineEvidence: readonly CulturalEvidence[];
  alternativeEvidence: readonly CulturalEvidence[];
  baselineLocation?: string;
  alternativeLocation?: string;
};

export type StrategicValidationResult =
  | { valid: true; interpretation: StrategicInterpretation }
  | { valid: false; errors: string[] };

function normalized(value: string | undefined): string { return value?.trim().toLowerCase() ?? ""; }

function locationMatches(evidence: CulturalEvidence, location: string | undefined): boolean {
  if (evidence.kind !== "affinity" || !location) return true;
  const queryLocation = evidence.queryParameters["filter.location.query"];
  return !queryLocation || normalized(queryLocation) === normalized(location);
}

/** Strictly validates model references against the market that supplied them. */
export function validateStrategicInterpretation(input: unknown, context: StrategicValidationContext): StrategicValidationResult {
  const parsed = StrategicInterpretationSchema.safeParse(input);
  if (!parsed.success) return { valid: false, errors: ["Strategic interpretation did not match its schema"] };
  const baseline = new Map(context.baselineEvidence.map((item) => [item.id, item]));
  const alternative = new Map(context.alternativeEvidence.map((item) => [item.id, item]));
  const errors: string[] = [];
  const sections: StrategicClaim[][] = [
    parsed.data.scenarioChange,
    parsed.data.evidenceBackedObservations,
    parsed.data.potentialStrategicImplications,
    parsed.data.suggestedPositioningAdjustments,
    parsed.data.suggestedAudienceConsiderations,
    parsed.data.suggestedCulturalTouchpoints,
    parsed.data.culturalPossibilities,
    parsed.data.positioningAndLaunchExecution,
    parsed.data.assumptionsToValidate,
  ];
  const evidenceMarket = new Map<string, "baseline" | "alternative">();
  for (const [id] of baseline) evidenceMarket.set(id, "baseline");
  for (const [id] of alternative) if (!evidenceMarket.has(id)) evidenceMarket.set(id, "alternative");
  const unsupportedLanguage = /\b(demand|market\s*-?fit|commercial\s+success|partnerships?|causation|causal)\b/i;
  for (const claims of sections) for (const claim of claims) {
    const marketEvidence = claim.market === "baseline" ? baseline : claim.market === "alternative" ? alternative : new Map([...baseline, ...alternative]);
    const references = claim.evidenceIds.map((id) => marketEvidence.get(id));
    if (references.some((item) => !item)) errors.push(`Unknown or incorrectly attributed evidence reference in claim: ${claim.text}`);
    for (const item of references) {
      if (!item) continue;
      const location = item.id && baseline.has(item.id) ? context.baselineLocation : context.alternativeLocation;
      if (claim.market !== "comparison" && !locationMatches(item, location)) errors.push(`Evidence reference has incorrect geographic attribution in claim: ${claim.text}`);
    }
    if (claim.classification === "verified-observation" && claim.evidenceIds.length === 0) errors.push(`Verified claim has no evidence: ${claim.text}`);
    if (claim.classification === "verified-observation" && (!claim.subjectEntityId || !claim.objectEntityId)) errors.push(`Verified claim has no observed entity pair: ${claim.text}`);
    if (claim.classification === "verified-observation" && claim.subjectEntityId && claim.objectEntityId && !references.some((item) => item?.kind === "affinity" && item.subjectEntityId === claim.subjectEntityId && item.objectEntityId === claim.objectEntityId)) {
      errors.push(`Verified claim is not directly supported by its cited entity pair: ${claim.text}`);
    }
    if (unsupportedLanguage.test(claim.text)) {
      errors.push(`Unsupported commercial or causal claim: ${claim.text}`);
    }
  }
  for (const reference of parsed.data.supportingEvidenceReferences) {
    const evidence = reference.market === "baseline" ? baseline.get(reference.evidenceId)
      : reference.market === "alternative" ? alternative.get(reference.evidenceId)
        : baseline.get(reference.evidenceId) ?? alternative.get(reference.evidenceId);
    if (!evidence) errors.push(`Unknown or incorrectly attributed supporting evidence reference: ${reference.evidenceId}`);
    else if (reference.market !== "comparison" && evidenceMarket.get(reference.evidenceId) !== reference.market) errors.push(`Supporting evidence reference has incorrect market attribution: ${reference.evidenceId}`);
  }
  return errors.length ? { valid: false, errors } : { valid: true, interpretation: parsed.data };
}

export function strategicEvidence(result: CounterfactualResult): StrategicModelEvidence[] {
  return [
    ...(result.baselineResearch?.evidence ?? []).map((evidence) => ({ market: "baseline" as const, evidence })),
    ...(result.alternativeResearch?.evidence ?? []).map((evidence) => ({ market: "alternative" as const, evidence })),
  ];
}
