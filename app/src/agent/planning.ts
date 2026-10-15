import type { ProviderCapabilities } from "@/providers/interfaces/contracts";
import {
  LaunchScenarioInputSchema,
  type LaunchScenario,
  type LaunchScenarioInput,
  type ResearchPlan,
} from "@/agent/contracts";

const DEFAULT_TARGET_TYPE = "urn:entity:place";

function inferProductConcept(input: LaunchScenarioInput): string {
  if (input.productConcept) return input.productConcept;
  const sentence = input.text?.split(/[.!?]/u)[0]?.trim() ?? "";
  return sentence.slice(0, 300);
}

function inferSeedQueries(input: LaunchScenarioInput, productConcept: string): string[] {
  if (input.seedQueries?.length) return [...new Set(input.seedQueries)];
  const quoted = input.text?.match(/[“”"']([^“”"']+)[“”"']/gu)?.map((item) => item.slice(1, -1));
  if (quoted?.length) return [...new Set(quoted)].slice(0, 3);
  return productConcept ? [productConcept] : [];
}

export function extractScenario(input: unknown):
  | { ok: true; scenario: LaunchScenario }
  | { ok: false; message: string } {
  const parsed = LaunchScenarioInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid scenario" };
  const productConcept = inferProductConcept(parsed.data);
  const seedQueries = inferSeedQueries(parsed.data, productConcept);
  return {
    ok: true,
    scenario: {
      productConcept,
      launchLocation: parsed.data.launchLocation,
      seedQueries,
      requestedOutcome: parsed.data.requestedOutcome,
      targetTypes: parsed.data.targetTypes?.length ? parsed.data.targetTypes : [DEFAULT_TARGET_TYPE],
      sourceText: parsed.data.text,
    },
  };
}

export function createResearchPlan(
  scenario: LaunchScenario,
  capabilities: ProviderCapabilities,
): { ok: true; plan: ResearchPlan } | { ok: false; code: "UNSUPPORTED_CAPABILITY" | "INVALID_SCENARIO"; message: string } {
  if (!capabilities.entitySearch || !capabilities.affinityDiscovery) {
    return { ok: false, code: "UNSUPPORTED_CAPABILITY", message: "Provider must support entity search and affinity discovery" };
  }
  if (scenario.seedQueries.length === 0) {
    return { ok: false, code: "INVALID_SCENARIO", message: "No cultural seed entity query could be extracted" };
  }
  if (scenario.launchLocation && !capabilities.geographicFiltering) {
    return { ok: false, code: "UNSUPPORTED_CAPABILITY", message: "Provider does not support geographic filtering" };
  }
  return {
    ok: true,
    plan: {
      seedQueries: scenario.seedQueries.slice(0, 3),
      targetTypes: scenario.targetTypes.slice(0, 3),
      locationQuery: scenario.launchLocation,
      maxEntityResults: 5,
      maxAffinityResults: 20,
      explainability: capabilities.explainability,
      limitations: [
        "Affinity indicates a provider-reported cultural association, not demand, partnership, causation or commercial suitability.",
        "Scores from different geographic queries are not treated as directly comparable absolute market-fit scores.",
      ],
    },
  };
}

