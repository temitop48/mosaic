import { createProductionDecisionEngine } from "../src/agent/factory.ts";
import { geminiConfigFromEnvironment } from "../src/providers/gemini/config.ts";

// Development-only bounded integration check. It intentionally reads process
// environment through configuration helpers and never loads or prints .env.local.
const qlooConfigured = Boolean(process.env.QLOO_API_KEY);
const geminiConfigured = Boolean(geminiConfigFromEnvironment());
if (!qlooConfigured || !geminiConfigured) {
  console.error("Live analysis smoke test not run: server-side Qloo and/or Gemini credentials are unavailable.");
  console.error("Run locally with the application server environment configured, without printing credentials:");
  console.error("  cd ~/projects/mosaic/app && npm run analysis:smoke");
  process.exitCode = 2;
} else {
  const engine = createProductionDecisionEngine();
  const result = await engine.analyze({
    productConcept: "Coffee-inspired lifestyle launch",
    launchLocation: "London",
    seedQueries: ["Starbucks"],
    seedCategory: "brand",
    requestedOutcome: "Identify culturally associated London places for a launch hypothesis",
    targetTypes: ["urn:entity:place"],
  });

  const evidenceIds = new Set(result.evidence.map((item) => item.id));
  const referencedEvidenceIds = Object.values(result.blueprint ?? {})
    .flatMap((section) => section && typeof section === "object" && "claims" in section ? section.claims : [])
    .flatMap((claim) => claim.evidenceIds);

  console.log(JSON.stringify({
    status: result.status,
    resolvedSources: result.resolutions
      .filter((resolution) => resolution.status === "resolved")
      .map((resolution) => ({ name: resolution.entity?.name, category: resolution.entity?.category })),
    evidenceCount: result.evidence.length,
    scoreSamples: result.evidence.slice(0, 5).map((item) => ({ score: item.providerScore, targetName: item.objectEntityName, targetCategory: item.objectEntityCategory })),
    graph: { nodeCount: result.graph.nodes.length, edgeCount: result.graph.edges.length },
    geographicQueries: [...new Set(result.evidence.map((item) => item.queryParameters["filter.location.query"]))],
    explainabilityPreserved: result.evidence.filter((item) => item.explainability !== undefined).length,
    blueprintClassificationCounts: Object.fromEntries(["who", "where", "withWhat", "alongsideWhom", "why"].map((key) => [key, result.blueprint?.[key]?.claims.reduce((counts, claim) => ({ ...counts, [claim.classification]: (counts[claim.classification] ?? 0) + 1 }), {}) ?? {}])),
    allBlueprintEvidenceReferencesValidated: referencedEvidenceIds.every((id) => evidenceIds.has(id)),
    limitations: result.limitations,
    errors: result.errors,
  }, null, 2));

  if (result.status !== "completed" || result.graph.edges.length === 0 || !referencedEvidenceIds.every((id) => evidenceIds.has(id))) process.exitCode = 1;
}
