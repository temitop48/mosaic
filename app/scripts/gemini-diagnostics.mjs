import { buildGeminiPrompt, GEMINI_BLUEPRINT_RESPONSE_SCHEMA, GeminiModelProvider } from "../src/providers/gemini/adapter.ts";
import { geminiConfigFromEnvironment } from "../src/providers/gemini/config.ts";
import { blueprintStructuralIssues, diagnoseBlueprintEvidence, parseBlueprintModelOutput } from "../src/agent/model.ts";

// Development-only diagnostics. This reads process.env through the existing
// server configuration helper; it never loads or prints .env.local.
const config = geminiConfigFromEnvironment();
const requested = process.argv[2] ?? "all";
const names = new Set(["minimal-text", "minimal-json", "synthetic-blueprint", "representative-blueprint", "mosaic-fixture-blueprint"]);
const selected = requested === "all" ? [...names] : [requested];
if (!config) {
  console.error("Gemini diagnostics not run: GEMINI_API_KEY and GEMINI_MODEL are unavailable in the server environment.");
  console.error("Run locally with server-side configuration: cd ~/projects/mosaic/app && npm run gemini:diagnostics -- all");
  process.exitCode = 2;
} else if (!selected.every((name) => names.has(name))) {
  console.error("Choose minimal-text, minimal-json, synthetic-blueprint, representative-blueprint, mosaic-fixture-blueprint, or all.");
  process.exitCode = 2;
} else {
  const trace = [];
  const provider = new GeminiModelProvider(config, fetch, undefined, (event) => trace.push({
    model: event.model,
    requestBytes: event.requestBytes,
    attempt: event.attempt,
    durationMs: event.durationMs,
    status: event.status,
    retryReason: event.retryReason,
    backoffMs: event.backoffMs,
    finalError: event.finalError,
    validationOutcome: event.validationOutcome,
  }));
  const syntheticEvidence = [{
    kind: "affinity",
    id: "diagnostic:evidence:synthetic-001",
    subjectEntityId: "diagnostic:brand:synthetic-source",
    subjectEntityCategory: "brand",
    subjectEntityName: "Synthetic Source (diagnostic only)",
    objectEntityId: "diagnostic:place:synthetic-target",
    objectEntityCategory: "place",
    objectEntityName: "Synthetic Target (diagnostic only)",
    providerScore: 0.42,
    providerScoreLabel: "synthetic-affinity",
    providerScoreScale: "diagnostic-only",
    explainability: { "diagnostic.synthetic": [{ entity_id: "diagnostic:brand:synthetic-source", score: 0.42 }] },
    geographicContext: { city: "Synthetic City", countryCode: "ZZ" },
    queryParameters: { "filter.location.query": "Synthetic City", "filter.type": "urn:entity:place" },
    provenance: { providerId: "diagnostic-synthetic-provider", sourceReference: "diagnostic:synthetic", retrievedAt: "2026-01-01T00:00:00.000Z" },
    verified: true,
  }];
  const representativeEvidence = syntheticEvidence.map((item) => ({
    ...item,
    id: "diagnostic:representative:qloo-shaped-001",
    subjectEntityId: "qloo:diagnostic:brand-source",
    subjectEntityName: "Representative Brand (not live intelligence)",
    objectEntityId: "qloo:diagnostic:place-target",
    objectEntityName: "Representative Place (not live intelligence)",
    providerScore: 0.81,
    providerScoreLabel: "affinity",
    providerScoreScale: "qloo:affinity",
    provenance: { providerId: "qloo-sanitized-diagnostic", sourceReference: "qloo:diagnostic:insights", retrievedAt: "2026-01-01T00:00:00.000Z" },
  }));
  const mosaicFixtureEvidence = Array.from({ length: 20 }, (_, index) => ({
    ...representativeEvidence[0],
    id: `qloo-sanitized-diagnostic:affinity:${index + 1}`,
    objectEntityId: `qloo:diagnostic:place-target-${index + 1}`,
    objectEntityName: `Representative Place ${index + 1} (not live intelligence)`,
    providerScore: 0.81 - index * 0.01,
  }));
  const prompts = {
    "minimal-text": { prompt: "Reply with the single word MOSAIC_DIAGNOSTIC_OK.", json: false },
    "minimal-json": { prompt: 'Return only JSON: {"ok":true,"marker":"MOSAIC_DIAGNOSTIC_OK"}.', json: true },
    "synthetic-blueprint": { prompt: "Generate a launch blueprint using only the clearly labeled synthetic diagnostic evidence supplied below. Do not call it live cultural intelligence.\n" + JSON.stringify({ productConcept: "Synthetic diagnostic launch", launchLocation: "Synthetic City", evidence: syntheticEvidence }), json: true },
    "representative-blueprint": { prompt: "Generate a launch blueprint using only this sanitized representative payload. It is not a live result and must not be described as one. Preserve the supplied evidence ID and identities.\n" + JSON.stringify({ productConcept: "Representative diagnostic launch", launchLocation: "London", evidence: representativeEvidence }), json: true },
    "mosaic-fixture-blueprint": { prompt: "", json: true },
  };
  for (const name of selected) {
    const test = prompts[name];
    const evidenceForBlueprint = name === "synthetic-blueprint" ? syntheticEvidence : name === "mosaic-fixture-blueprint" ? mosaicFixtureEvidence : representativeEvidence;
    const blueprintInput = { productConcept: name, launchLocation: "diagnostic", evidence: evidenceForBlueprint };
    const result = name.endsWith("blueprint")
      ? await provider.generateDiagnostic(buildGeminiPrompt(blueprintInput), "application/json", GEMINI_BLUEPRINT_RESPONSE_SCHEMA)
      : await provider.generateDiagnostic(test.prompt, test.json ? "application/json" : undefined);
    let validation = "not-applicable";
    if (name === "minimal-json") {
      try { JSON.parse(result.text ?? ""); validation = "valid-json"; } catch { validation = "invalid-json"; }
    } else if (name.endsWith("blueprint")) {
      let evidenceDiagnostics = { structuralPaths: [], structuralIssues: [], unknownEvidencePaths: [], unsupportedVerifiedClaimPaths: [] };
      if (result.ok) {
        try {
          const parsedJson = JSON.parse(result.text ?? "");
          const parsed = parseBlueprintModelOutput(parsedJson);
          const referenceDiagnostics = diagnoseBlueprintEvidence(parsedJson, evidenceForBlueprint);
          evidenceDiagnostics = { ...referenceDiagnostics, structuralIssues: blueprintStructuralIssues(parsedJson) };
          validation = parsed.ok && evidenceDiagnostics.unknownEvidencePaths.length === 0 && evidenceDiagnostics.unsupportedVerifiedClaimPaths.length === 0
            ? "valid-blueprint"
            : evidenceDiagnostics.structuralPaths.length > 0 ? "invalid-structure" : evidenceDiagnostics.unknownEvidencePaths.length > 0 ? "unknown-evidence-references" : "unsupported-verified-claims";
        } catch { validation = "invalid-structure"; evidenceDiagnostics = { structuralPaths: ["root"], structuralIssues: [{ path: "root", issue: "expected-object", observedType: "object" }], unknownEvidencePaths: [], unsupportedVerifiedClaimPaths: [] }; }
      } else validation = "invalid-blueprint";
      console.log(JSON.stringify({ test: name, ok: result.ok, status: result.status, requestBytes: result.requestBytes, durationMs: result.durationMs, attempts: result.attempts, validation, ...evidenceDiagnostics, errorCode: result.error?.code, trace: trace.splice(0) }));
      continue;
    } else {
      validation = result.ok && Boolean(result.text?.trim()) ? "nonempty-text" : "empty-text";
    }
    console.log(JSON.stringify({ test: name, ok: result.ok, status: result.status, requestBytes: result.requestBytes, durationMs: result.durationMs, attempts: result.attempts, validation, errorCode: result.error?.code, trace: trace.splice(0) }));
  }
}
