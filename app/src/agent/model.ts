import { LaunchBlueprintSchema, type LaunchBlueprint } from "@/agent/contracts";

export type BlueprintModelInput = {
  productConcept: string;
  launchLocation?: string;
  requestedOutcome?: string;
  evidence: readonly unknown[];
};

export type ModelError = {
  code: "MODEL_UNAVAILABLE" | "MODEL_TIMEOUT" | "MODEL_INVALID_OUTPUT" | "MODEL_ERROR";
  message: string;
};

export type ModelResult = { ok: true; blueprint: LaunchBlueprint } | { ok: false; error: ModelError };

export interface StructuredModelProvider {
  readonly id: string;
  generateBlueprint(input: BlueprintModelInput): Promise<ModelResult>;
}

export function parseBlueprintModelOutput(input: unknown): ModelResult {
  const parsed = LaunchBlueprintSchema.safeParse(input);
  return parsed.success
    ? { ok: true, blueprint: parsed.data }
    : { ok: false, error: { code: "MODEL_INVALID_OUTPUT", message: "Model output did not match the launch blueprint schema" } };
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

