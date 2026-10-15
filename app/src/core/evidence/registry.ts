import type { CulturalEntity } from "@/core/entities/types";
import type { CulturalEvidence } from "@/core/evidence/types";
import { validateEntity, validateEvidence, type EvidenceValidationResult } from "@/core/evidence/validation";

export type EvidenceRegistrationResult = EvidenceValidationResult | {
  valid: false;
  classification: "invalid";
  errors: [string, ...string[]];
};

/** In-memory Phase 2 registry. Only validated provider evidence can enter it. */
export class EvidenceRegistry {
  private readonly entities = new Map<string, CulturalEntity>();
  private readonly evidence = new Map<string, CulturalEvidence>();

  registerEntity(entity: CulturalEntity): void {
    const validated = validateEntity(entity);
    if (!validated) throw new Error("Cannot register an invalid cultural entity");
    const existing = this.entities.get(entity.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(validated)) {
      throw new Error(`Entity identity collision: ${entity.id}`);
    }
    this.entities.set(entity.id, validated);
  }

  registerEntities(entities: Iterable<CulturalEntity>): void {
    for (const entity of entities) this.registerEntity(entity);
  }

  registerEvidence(input: unknown): EvidenceRegistrationResult {
    const result = validateEvidence(input, this.entities.values());
    if (!result.valid) return result;
    const existing = this.evidence.get(result.evidence.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(result.evidence)) {
      return { valid: false, classification: "invalid", errors: [`Evidence identity collision: ${result.evidence.id}`] };
    }
    this.evidence.set(result.evidence.id, result.evidence);
    return result;
  }

  getEvidence(id: string): CulturalEvidence | undefined {
    return this.evidence.get(id);
  }

  listValidatedEvidence(): CulturalEvidence[] {
    return [...this.evidence.values()];
  }

  has(id: string): boolean {
    return this.evidence.has(id);
  }
}
