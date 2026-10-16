import { LaunchBlueprintSchema, type LaunchBlueprint } from "@/agent/contracts";
import { StrategicInterpretationSchema, type StrategicInterpretation, type StrategicInterpretationInput } from "@/core/counterfactuals/contracts";
import type { CounterfactualComparison } from "@/core/counterfactuals/contracts";

export type BlueprintModelInput = {
  productConcept: string;
  launchLocation?: string;
  requestedOutcome?: string;
  evidence: readonly unknown[];
};

export type StrategicModelEvidence = {
  market: "baseline" | "alternative";
  evidence: unknown;
};

export type StrategicModelInput = {
  productConcept: string;
  baselineLocation?: string;
  alternativeLocation?: string;
  comparison: CounterfactualComparison;
  evidence: readonly StrategicModelEvidence[];
};

export type ModelError = {
  code:
    | "MODEL_UNAVAILABLE"
    | "MODEL_TIMEOUT"
    | "MODEL_INVALID_OUTPUT"
    | "MODEL_NOT_FOUND"
    | "MODEL_AUTHENTICATION_ERROR"
    | "MODEL_RATE_LIMITED"
    | "MODEL_UPSTREAM_ERROR"
    | "MODEL_ERROR";
  message: string;
  status?: number;
  retryAfterMs?: number;
};

export type ModelResult = { ok: true; blueprint: LaunchBlueprint } | { ok: false; error: ModelError };
export type StrategicModelResult = { ok: true; interpretation: StrategicInterpretation | StrategicInterpretationInput } | { ok: false; error: ModelError };

export interface StructuredModelProvider {
  readonly id: string;
  generateBlueprint(input: BlueprintModelInput): Promise<ModelResult>;
  generateCounterfactualInterpretation?(input: StrategicModelInput): Promise<StrategicModelResult>;
}

export function parseStrategicModelOutput(input: unknown): StrategicModelResult {
  const parsed = StrategicInterpretationSchema.safeParse(input);
  return parsed.success
    ? { ok: true, interpretation: parsed.data }
    : { ok: false, error: { code: "MODEL_INVALID_OUTPUT", message: "Model output did not match the counterfactual strategic interpretation schema" } };
}

function formatValidationPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "root";
  return path.map((part, index) => typeof part === "number" ? `[${part}]` : `${index === 0 ? "" : "."}${String(part)}`).join("");
}

export function blueprintValidationPaths(input: unknown): string[] {
  const parsed = LaunchBlueprintSchema.safeParse(input);
  if (parsed.success) return [];
  return [...new Set(parsed.error.issues.map((issue) => formatValidationPath(issue.path)))];
}

export type BlueprintStructuralIssue = {
  path: string;
  issue: "missing" | "null" | "expected-object" | "expected-array" | "non-string-item" | "invalid-enum";
  observedType: "missing" | "null" | "object" | "array" | "string" | "number" | "boolean";
};

function observedType(value: unknown): BlueprintStructuralIssue["observedType"] {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  return "boolean";
}

/** Reports only field shape/type metadata; it never includes model content. */
export function blueprintStructuralIssues(input: unknown): BlueprintStructuralIssue[] {
  const issues: BlueprintStructuralIssue[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    issues.push({ path: "root", issue: input === null ? "null" : "expected-object", observedType: observedType(input) });
    return issues;
  }
  const blueprint = input as Record<string, unknown>;
  for (const section of [...blueprintSections, "caveats"] as const) {
    const value = blueprint[section];
    if (value === undefined) {
      issues.push({ path: section, issue: "missing", observedType: "missing" });
      continue;
    }
    if (value === null) {
      issues.push({ path: section, issue: "null", observedType: "null" });
      continue;
    }
    if (section === "caveats") {
      if (!Array.isArray(value)) issues.push({ path: section, issue: "expected-array", observedType: observedType(value) });
      continue;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      issues.push({ path: section, issue: "expected-object", observedType: observedType(value) });
      continue;
    }
    const claims = (value as Record<string, unknown>).claims;
    if (claims === undefined) {
      issues.push({ path: `${section}.claims`, issue: "missing", observedType: "missing" });
      continue;
    }
    if (claims === null) {
      issues.push({ path: `${section}.claims`, issue: "null", observedType: "null" });
      continue;
    }
    if (!Array.isArray(claims)) {
      issues.push({ path: `${section}.claims`, issue: "expected-array", observedType: observedType(claims) });
      continue;
    }
    claims.forEach((claim, index) => {
      const path = `${section}.claims[${index}]`;
      if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
        issues.push({ path, issue: claim === null ? "null" : "expected-object", observedType: observedType(claim) });
        return;
      }
      const valueRecord = claim as Record<string, unknown>;
      const required = ["text", "classification", "evidenceIds"] as const;
      for (const field of required) {
        const fieldValue = valueRecord[field];
        const fieldPath = `${path}.${field}`;
        if (fieldValue === undefined) {
          issues.push({ path: fieldPath, issue: "missing", observedType: "missing" });
        } else if (fieldValue === null) {
          issues.push({ path: fieldPath, issue: "null", observedType: "null" });
        }
      }
      const classifications = ["verified-observation", "interpretation", "unverified-suggestion"];
      if (typeof valueRecord.classification === "string" && !classifications.includes(valueRecord.classification)) {
        issues.push({ path: `${path}.classification`, issue: "invalid-enum", observedType: "string" });
      }
      const references = valueRecord.evidenceIds;
      if (references !== undefined && references !== null && !Array.isArray(references)) {
        issues.push({ path: `${path}.evidenceIds`, issue: "expected-array", observedType: observedType(references) });
      } else if (Array.isArray(references)) {
        references.forEach((reference, referenceIndex) => {
          if (typeof reference !== "string") issues.push({ path: `${path}.evidenceIds[${referenceIndex}]`, issue: "non-string-item", observedType: observedType(reference) });
        });
      }
    });
  }
  return issues;
}

export type BlueprintEvidenceDiagnostics = {
  structuralPaths: string[];
  unknownEvidencePaths: string[];
  unsupportedVerifiedClaimPaths: string[];
};

const blueprintSections = ["who", "where", "withWhat", "alongsideWhom", "why"] as const;

/**
 * Separates shape errors, unknown evidence references, and unsupported verified
 * claims without promoting any model text into evidence.
 */
export function diagnoseBlueprintEvidence(input: unknown, evidence: readonly unknown[]): BlueprintEvidenceDiagnostics {
  const structuralPaths = blueprintValidationPaths(input);
  const knownEvidence = new Map<string, { subjectEntityId?: string; objectEntityId?: string }>();
  for (const item of evidence) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as { id?: unknown; subjectEntityId?: unknown; objectEntityId?: unknown };
    if (typeof candidate.id === "string") {
      knownEvidence.set(candidate.id, {
        subjectEntityId: typeof candidate.subjectEntityId === "string" ? candidate.subjectEntityId : undefined,
        objectEntityId: typeof candidate.objectEntityId === "string" ? candidate.objectEntityId : undefined,
      });
    }
  }
  const unknownEvidencePaths: string[] = [];
  const unsupportedVerifiedClaimPaths: string[] = [];
  if (!input || typeof input !== "object") return { structuralPaths, unknownEvidencePaths, unsupportedVerifiedClaimPaths };
  const blueprint = input as Record<string, unknown>;
  for (const section of blueprintSections) {
    const claims = blueprint[section] && typeof blueprint[section] === "object"
      ? (blueprint[section] as { claims?: unknown }).claims
      : undefined;
    if (!Array.isArray(claims)) continue;
    claims.forEach((claim, index) => {
      if (!claim || typeof claim !== "object") return;
      const value = claim as Record<string, unknown>;
      const claimPath = `${section}.claims[${index}]`;
      const references = value.evidenceIds;
      if (Array.isArray(references)) {
        references.forEach((reference, referenceIndex) => {
          if (typeof reference === "string" && !knownEvidence.has(reference)) {
            unknownEvidencePaths.push(`${claimPath}.evidenceIds[${referenceIndex}]`);
          }
        });
      }
      if (value.classification === "verified-observation") {
        const subjectEntityId = typeof value.subjectEntityId === "string" ? value.subjectEntityId : undefined;
        const objectEntityId = typeof value.objectEntityId === "string" ? value.objectEntityId : undefined;
        const directlySupported = subjectEntityId !== undefined && objectEntityId !== undefined && Array.isArray(references)
          && references.some((reference) => {
            const item = typeof reference === "string" ? knownEvidence.get(reference) : undefined;
            return item?.subjectEntityId === subjectEntityId && item.objectEntityId === objectEntityId;
          });
        if (!directlySupported) unsupportedVerifiedClaimPaths.push(`${claimPath}.classification`);
      }
    });
  }
  return { structuralPaths, unknownEvidencePaths, unsupportedVerifiedClaimPaths };
}

export function parseBlueprintModelOutput(input: unknown): ModelResult {
  const parsed = LaunchBlueprintSchema.safeParse(input);
  return parsed.success
    ? { ok: true, blueprint: parsed.data }
    : { ok: false, error: { code: "MODEL_INVALID_OUTPUT", message: `Model output did not match the launch blueprint schema (${blueprintValidationPaths(input).slice(0, 3).join(", ")})` } };
}

/** Test-only deterministic model. Production wiring never falls back to this provider. */
export class DeterministicBlueprintModel implements StructuredModelProvider {
  readonly id = "deterministic-test-model";

  async generateBlueprint(input: BlueprintModelInput): Promise<ModelResult> {
    const evidenceId = (input.evidence[0] as { id?: string } | undefined)?.id;
    const claim = evidenceId
      ? { text: "The provider reported a cultural association for the researched entities.", classification: "verified-observation" as const, evidenceIds: [evidenceId] }
      : { text: "Further cultural research is required.", classification: "unverified-suggestion" as const, evidenceIds: [] };
    return parseBlueprintModelOutput({
      who: { claims: [{ ...claim, text: `Research context for ${input.productConcept}` }] },
      where: { claims: input.launchLocation ? [{ ...claim, text: `Research was geographically scoped to ${input.launchLocation}` }] : [] },
      withWhat: { claims: [] },
      alongsideWhom: { claims: [] },
      why: { claims: [{ ...claim, classification: "interpretation", text: "The evidence may inform a launch hypothesis; it does not establish commercial suitability." }] },
      caveats: [],
    });
  }
}
