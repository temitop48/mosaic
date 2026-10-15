import { CulturalEntitySchema, type CulturalEntity } from "@/core/entities/types";
import {
  CulturalEvidenceSchema,
  type CulturalEvidence,
} from "@/core/evidence/types";

export type EvidenceClassification = "provider-affinity";
export type EvidenceValidationFailure = "invalid" | "unsupported";

export type EvidenceValidationResult =
  | {
      valid: true;
      classification: EvidenceClassification;
      evidence: CulturalEvidence;
    }
  | {
      valid: false;
      classification: EvidenceValidationFailure;
      errors: string[];
    };

function entityMap(entities: Iterable<CulturalEntity>): Map<string, CulturalEntity> {
  return new Map([...entities].map((entity) => [entity.id, entity]));
}

/**
 * Validates evidence without importing any provider adapter. Provider-backed
 * affinity is accepted only when both referenced entities are known and match
 * the identities/categories carried by the evidence.
 */
export function validateEvidence(
  input: unknown,
  entities: Iterable<CulturalEntity>,
): EvidenceValidationResult {
  const parsed = CulturalEvidenceSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, classification: "invalid", errors: parsed.error.issues.map((issue) => issue.message) };
  }

  const evidence = parsed.data;
  if (evidence.kind !== "affinity") {
    return { valid: false, classification: "unsupported", errors: [`Unsupported evidence kind: ${evidence.kind}`] };
  }
  if (!evidence.verified) {
    return { valid: false, classification: "unsupported", errors: ["Evidence is not marked verified"] };
  }
  if (evidence.providerScore === undefined || !Number.isFinite(evidence.providerScore)) {
    return { valid: false, classification: "invalid", errors: ["Provider affinity score is required"] };
  }

  const byId = entityMap(entities);
  const subject = byId.get(evidence.subjectEntityId);
  const object = byId.get(evidence.objectEntityId);
  const errors: string[] = [];
  if (!subject) errors.push(`Missing subject entity: ${evidence.subjectEntityId}`);
  if (!object) errors.push(`Missing object entity: ${evidence.objectEntityId}`);
  if (subject && subject.category !== evidence.subjectEntityCategory) {
    errors.push("Subject entity category does not match evidence");
  }
  if (object && object.category !== evidence.objectEntityCategory) {
    errors.push("Object entity category does not match evidence");
  }
  if (subject && subject.providerId !== evidence.provenance.providerId) {
    errors.push("Subject entity provider does not match evidence provenance");
  }
  if (object && object.providerId !== evidence.provenance.providerId) {
    errors.push("Object entity provider does not match evidence provenance");
  }

  return errors.length > 0
    ? { valid: false, classification: "invalid", errors }
    : { valid: true, classification: "provider-affinity", evidence };
}

export function validateEntity(input: unknown): CulturalEntity | undefined {
  const parsed = CulturalEntitySchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}
