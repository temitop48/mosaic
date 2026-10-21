import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// This runner is intentionally invoked with the project's strip-types runtime:
// node --experimental-strip-types scripts/evaluation/live-qloo.mjs
// The loader registration below lets it reuse the real TypeScript contracts.
await import("../../test-aliases.mjs");
const { createCounterfactualRequest } = await import("../../src/components/mosaic/studio-model.ts");
const { CounterfactualRequestSchema } = await import("../../src/core/counterfactuals/contracts.ts");
const { compareDecisionSensitivity } = await import("../../src/core/sensitivity/compare.ts");

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_DELAY_MS = 2_000;
const endpointPath = "/api/counterfactual";
const diagnosticMode = process.argv.includes("--diagnostic");

const scenarios = [
  { id: "L01", productConcept: "Coffee brand", signal: "Starbucks", baselineLocation: "London", alternativeLocation: "New York" },
  { id: "L02", productConcept: "Coffee brand", signal: "Blue Bottle Coffee", baselineLocation: "London", alternativeLocation: "New York" },
  { id: "L03", productConcept: "Athletic lifestyle brand", signal: "Nike", baselineLocation: "London", alternativeLocation: "Tokyo" },
  { id: "L04", productConcept: "Music discovery service", signal: "Spotify", baselineLocation: "Lagos", alternativeLocation: "London" },
  { id: "L05", productConcept: "Entertainment platform", signal: "Netflix", baselineLocation: "New York", alternativeLocation: "Tokyo" },
  { id: "L06", productConcept: "Athletic lifestyle brand", signal: "Adidas", baselineLocation: "London", alternativeLocation: "Lagos" },
  { id: "L07", productConcept: "Consumer brand", signal: "Intentionally unsupported cultural signal", baselineLocation: "London", alternativeLocation: "New York" },
  { id: "L08", productConcept: "Coffee brand", signal: "Starbucks", baselineLocation: "London", alternativeLocation: "New York" },
];

const diagnosticScenarios = [
  { id: "D01", productConcept: "Coffee brand", signal: "Starbucks", baselineLocation: "London", alternativeLocation: "New York" },
  { id: "D02", productConcept: "Coffee brand", signal: "Blue Bottle Coffee", baselineLocation: "London", alternativeLocation: "New York" },
  { id: "D03", productConcept: "Athletic lifestyle brand", signal: "Adidas", baselineLocation: "London", alternativeLocation: "Lagos" },
  { id: "D04", productConcept: "Coffee brand", signal: "Starbucks", baselineLocation: "London", alternativeLocation: "Lagos" },
];

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function numberArgument(name, fallback) {
  const value = Number(argument(name, String(fallback)));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const baseUrl = (argument("base-url", process.env.MOSAIC_EVALUATION_BASE_URL ?? DEFAULT_BASE_URL)).replace(/\/$/, "");
const timeoutMs = numberArgument("timeout-ms", DEFAULT_TIMEOUT_MS);
const delayMs = numberArgument("delay-ms", DEFAULT_DELAY_MS);
const endpoint = `${baseUrl}${endpointPath}`;

function timestamp() { return new Date().toISOString(); }

function scenarioInput(item) {
  return { productConcept: item.productConcept, seedQuery: item.signal, baselineLocation: item.baselineLocation, alternativeLocation: item.alternativeLocation, includeStrategicInterpretation: false };
}

function requestFor(item) {
  return createCounterfactualRequest(scenarioInput(item));
}

function requestShapeCheck(payload) {
  const parsed = CounterfactualRequestSchema.safeParse(payload);
  return parsed.success ? { valid: true } : { valid: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
}

function evidenceFor(result, market) {
  const research = market === "baseline" ? result?.baselineResearch : result?.alternativeResearch;
  return Array.isArray(research?.evidence) ? research.evidence : [];
}

function verifiedEvidence(evidence) {
  return evidence.filter((item) => item && item.kind === "affinity" && item.verified === true);
}

function attributionIsValid(evidence) {
  return evidence.length > 0 && evidence.every((item) => typeof item.provenance?.providerId === "string" && item.provenance.providerId.length > 0 && typeof item.subjectEntityId === "string" && typeof item.objectEntityId === "string" && typeof item.providerScore === "number" && Number.isFinite(item.providerScore));
}

function errorMessages(payload) {
  if (!payload || typeof payload !== "object") return ["Response body was not an object"];
  if (Array.isArray(payload.errors)) return payload.errors.map((item) => item?.message ?? "Unspecified research error");
  if (payload.error && typeof payload.error === "object") return [String(payload.error.message ?? "Request failed")];
  return [];
}

function summarizeResult(payload, httpStatus) {
  const result = payload && typeof payload === "object" && (payload.status === "completed" || payload.status === "partial" || payload.status === "failed") ? payload : undefined;
  const baseline = verifiedEvidence(evidenceFor(result, "baseline"));
  const alternative = verifiedEvidence(evidenceFor(result, "alternative"));
  const allEvidence = [...baseline, ...alternative];
  const errors = errorMessages(payload);
  const validAttribution = allEvidence.length > 0 && attributionIsValid(allEvidence);
  const outcome = result?.status === "completed" ? "complete" : result?.status === "partial" ? "partial" : "failed";
  return {
    researchOutcome: outcome,
    verifiedEvidenceCountsByMarket: { baseline: baseline.length, alternative: alternative.length },
    validProviderAttribution: validAttribution,
    qlooEvidenceActuallyReturned: allEvidence.some((item) => item.provenance?.providerId === "qloo"),
    validationErrors: errors,
    result,
    httpStatus,
  };
}

async function fetchJson(url, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  const startedAt = timestamp();
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
    return { startedAt, httpStatus: response.status, durationMs: Date.now() - started, body, transportError: undefined };
  } catch (cause) {
    return { startedAt, httpStatus: undefined, durationMs: Date.now() - started, body: undefined, transportError: cause instanceof Error ? cause.message : "Network request failed" };
  } finally {
    clearTimeout(timeout);
  }
}

async function preflight() {
  const started = Date.now();
  try {
    const response = await fetch(endpoint, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
    return { reachable: true, httpStatus: response.status, durationMs: Date.now() - started, note: "Endpoint responded to preflight GET; POST is required for evaluation." };
  } catch (cause) {
    return { reachable: false, httpStatus: undefined, durationMs: Date.now() - started, error: cause instanceof Error ? cause.message : "Endpoint was unreachable" };
  }
}

function entityIds(result, market) {
  const research = market === "baseline" ? result?.baselineResearch : result?.alternativeResearch;
  const ids = new Set();
  for (const resolution of research?.resolutions ?? []) if (resolution.entity) ids.add(`${resolution.entity.providerId}:${resolution.entity.id}`);
  for (const item of evidenceFor(result, market)) {
    if (item?.kind !== "affinity") continue;
    ids.add(`${item.provenance.providerId}:${item.subjectEntityId}`);
    ids.add(`${item.provenance.providerId}:${item.objectEntityId}`);
  }
  return ids;
}

function overlap(first, second) {
  const shared = [...first].filter((id) => second.has(id)).length;
  const union = new Set([...first, ...second]).size;
  return { sharedProviderEntityIds: shared, uniqueInFirst: first.size - shared, uniqueInSecond: second.size - shared, union, overlapRatio: union === 0 ? undefined : shared / union };
}

function repeatability(l01, l08, payloadIdentical) {
  if (!l01?.result || !l08?.result) return { available: false, payloadIdentical, reason: "L01 or L08 did not return a structured counterfactual result" };
  return {
    available: true,
    payloadIdentical,
    baseline: overlap(entityIds(l01.result, "baseline"), entityIds(l08.result, "baseline")),
    alternative: overlap(entityIds(l01.result, "alternative"), entityIds(l08.result, "alternative")),
    limitation: "Overlap describes returned provider entity IDs only; identical rankings are not guaranteed or inferred.",
  };
}

function stableJson(value) {
  return JSON.stringify(value, Object.keys(value ?? {}).sort());
}

function diagnosticEvidence(result, market) {
  return verifiedEvidence(evidenceFor(result, market));
}

function diagnosticSubjectIds(evidence) {
  return [...new Set(evidence.map((item) => `${item.provenance?.providerId ?? "unavailable"}:${item.subjectEntityId}`))].sort();
}

function diagnosticDestinationIds(evidence) {
  return new Set(evidence.map((item) => `${item.provenance?.providerId ?? "unavailable"}:${item.objectEntityCategory}:${item.objectEntityId}`));
}

function diagnosticRelationshipIds(evidence) {
  return new Set(evidence.map((item) => [item.provenance?.providerId, item.subjectEntityCategory, item.subjectEntityId, item.objectEntityCategory, item.objectEntityId].join("\u0000")));
}

function uniqueRecords(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = stableJson(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolvedSubject(research, signal) {
  const resolutions = Array.isArray(research?.resolutions) ? research.resolutions : [];
  const match = resolutions.find((item) => item?.query?.trim().toLowerCase() === signal.trim().toLowerCase()) ?? resolutions[0];
  if (!match) return { status: "unavailable", providerId: "unavailable", displayName: "unavailable", category: "unavailable", id: "unavailable" };
  return {
    status: match.status ?? "unavailable",
    providerId: match.entity?.providerId ?? "unavailable",
    displayName: match.entity?.name ?? "unavailable",
    category: match.entity?.category ?? "unavailable",
    id: match.entity?.id ?? "unavailable",
  };
}

function diagnosticMarket(result, market, submittedSignal) {
  const research = market === "baseline" ? result?.baselineResearch : result?.alternativeResearch;
  const evidence = diagnosticEvidence(result, market);
  const subjects = resolvedSubject(research, submittedSignal);
  return {
    submittedCulturalSignal: submittedSignal,
    entityResolution: subjects,
    subjectEntityIdsFromEvidence: diagnosticSubjectIds(evidence),
    subjectEntityCategory: subjects.category,
    destinationEntityIds: [...diagnosticDestinationIds(evidence)].sort(),
    returnedGeographicMetadata: uniqueRecords(evidence.map((item) => item.geographicContext).filter(Boolean)),
    providerAttribution: [...new Set(evidence.map((item) => item.provenance?.providerId).filter(Boolean))].sort(),
    evidenceCount: evidence.length,
    effectiveQueryMetadata: uniqueRecords(evidence.map((item) => item.queryParameters).filter(Boolean)),
    missingFields: [
      ...(subjects.id === "unavailable" ? ["resolved subject provider ID"] : []),
      ...(evidence.length === 0 ? ["destination/object IDs", "returned geographic metadata", "effective query metadata"] : []),
    ],
  };
}

function diagnosticRecord(item, response) {
  const summary = response.transportError
    ? { researchOutcome: "failed", verifiedEvidenceCountsByMarket: { baseline: 0, alternative: 0 }, validProviderAttribution: false, qlooEvidenceActuallyReturned: false, validationErrors: [response.transportError], result: undefined }
    : summarizeResult(response.body, response.httpStatus);
  const result = summary.result;
  return {
    scenarioId: item.id,
    productConcept: item.productConcept,
    signal: item.signal,
    baselineLocation: item.baselineLocation,
    alternativeLocation: item.alternativeLocation,
    startedAt: response.startedAt,
    durationMs: response.durationMs,
    httpStatus: response.httpStatus,
    researchOutcome: summary.researchOutcome,
    verifiedEvidenceCountsByMarket: summary.verifiedEvidenceCountsByMarket,
    validProviderAttribution: summary.validProviderAttribution,
    qlooEvidenceActuallyReturned: summary.qlooEvidenceActuallyReturned,
    validationErrors: summary.validationErrors,
    liveProviderVerification: summary.qlooEvidenceActuallyReturned && summary.validProviderAttribution ? "verified-by-qloo-attribution" : "unavailable",
    markets: {
      baseline: diagnosticMarket(result, "baseline", item.signal),
      alternative: diagnosticMarket(result, "alternative", item.signal),
    },
    result,
  };
}

function setOverlap(first, second) {
  const shared = [...first].filter((id) => second.has(id)).sort();
  const union = new Set([...first, ...second]);
  return { uniqueInFirst: first.size, uniqueInSecond: second.size, sharedCount: shared.length, unionCount: union.size, jaccardRatio: union.size === 0 ? undefined : shared.length / union.size, sharedIds: shared };
}

function diagnosticPair(first, second, market) {
  const firstEvidence = diagnosticEvidence(first.result, market);
  const secondEvidence = diagnosticEvidence(second.result, market);
  return {
    market,
    city: market === "baseline" ? first.baselineLocation : first.alternativeLocation,
    exactRelationshipOverlap: setOverlap(diagnosticRelationshipIds(firstEvidence), diagnosticRelationshipIds(secondEvidence)),
    destinationOverlap: setOverlap(diagnosticDestinationIds(firstEvidence), diagnosticDestinationIds(secondEvidence)),
  };
}

function diagnosticComparisons(records) {
  const byId = new Map(records.map((item) => [item.scenarioId, item]));
  const pairs = [
    ["D01", "D02", "same-city-sensitivity"],
    ["D03", "D04", "lagos-destination-overlap"],
  ];
  return pairs.map(([leftId, rightId, purpose]) => {
    const left = byId.get(leftId);
    const right = byId.get(rightId);
    const comparable = left?.researchOutcome === "complete" && right?.researchOutcome === "complete";
    return {
      pair: { firstScenarioId: leftId, secondScenarioId: rightId, purpose },
      comparable,
      reason: comparable ? undefined : "Both scenarios must complete with validated evidence",
      baseline: comparable ? diagnosticPair(left, right, "baseline") : undefined,
      alternative: comparable ? diagnosticPair(left, right, "alternative") : undefined,
    };
  });
}

function diagnosticMarkdown(report) {
  const lines = [
    "# Mosaic Diagnostic Qloo Evaluation", "", `- Execution: ${report.executedAt}`, "- Mode: LIVE diagnostic", `- Base URL: ${report.baseUrl}`, `- Scenarios executed: ${report.scenariosExecuted}`, "",
    "## Scenario outcomes", "", "| ID | Signal | Cities | Outcome | HTTP | Duration (ms) | Baseline evidence | Alternative evidence | Live Qloo attribution |", "|---|---|---|---|---:|---:|---:|---:|---|",
    ...report.scenarios.map((item) => `| ${item.scenarioId} | ${item.signal} | ${item.baselineLocation} → ${item.alternativeLocation} | ${item.researchOutcome} | ${item.httpStatus ?? "—"} | ${item.durationMs} | ${item.verifiedEvidenceCountsByMarket.baseline} | ${item.verifiedEvidenceCountsByMarket.alternative} | ${item.liveProviderVerification} |`),
    "", "## Comparable overlaps", "",
    ...report.comparisons.map((item) => {
      if (!item.comparable) return `- ${item.pair.firstScenarioId}/${item.pair.secondScenarioId}: unavailable (${item.reason}).`;
      return `- ${item.pair.firstScenarioId}/${item.pair.secondScenarioId} (${item.pair.purpose}): baseline destination Jaccard ${item.baseline.destinationOverlap.jaccardRatio ?? "unavailable"}; alternative destination Jaccard ${item.alternative.destinationOverlap.jaccardRatio ?? "unavailable"}. Exact relationship Jaccard: ${item.baseline.exactRelationshipOverlap.jaccardRatio ?? "unavailable"} / ${item.alternative.exactRelationshipOverlap.jaccardRatio ?? "unavailable"}.`;
    }),
    "", "## Verified facts and limitations", "", "- Provider mode is marked verified only when returned evidence has provider attribution `qloo`; this does not expose raw upstream HTTP traces.", "- Destination overlap uses provider ID, object category, and object entity ID; display names are not used for identity.", "- Exact relationship overlap additionally includes provider-backed subject identity.", "- Equal destination sets do not imply equal cultural meaning, and affinity does not establish market demand.", ...report.limitations.map((item) => `- ${item}`), "",
  ];
  return `${lines.join("\n")}\n`;
}

async function runDiagnostic() {
  const preflightResult = await preflight();
  const shapeResults = diagnosticScenarios.map((item) => ({ scenarioId: item.id, ...requestShapeCheck(requestFor(item)) }));
  const report = { evaluationMode: "LIVE_DIAGNOSTIC", executedAt: timestamp(), baseUrl, endpoint, timeoutMs, delayMs, preflight: preflightResult, requestShapeValidation: { allValid: shapeResults.every((item) => item.valid), scenarios: shapeResults }, scenarios: [], scenariosExecuted: 0, outcomeCounts: { complete: 0, partial: 0, failed: 0 }, comparisons: [], errors: [], limitations: ["The endpoint response does not expose raw Qloo HTTP requests or cache headers.", "Provider attribution verifies returned Qloo evidence, not the absence of upstream provider caching.", "Returned geographic metadata is reported only when present in validated evidence."] };
  if (!preflightResult.reachable) report.errors.push({ stage: "preflight", message: preflightResult.error });
  else if (!report.requestShapeValidation.allValid) report.errors.push({ stage: "request-validation", message: "Diagnostic request shape validation failed" });
  else {
    for (let index = 0; index < diagnosticScenarios.length; index += 1) {
      if (index > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
      const item = diagnosticScenarios[index];
      const record = diagnosticRecord(item, await fetchJson(endpoint, requestFor(item)));
      report.scenarios.push(record);
      report.scenariosExecuted += 1;
      report.outcomeCounts[record.researchOutcome] += 1;
      if (item.id === "D01" && (record.researchOutcome !== "complete" || record.liveProviderVerification !== "verified-by-qloo-attribution")) {
        report.errors.push({ stage: "d01-smoke", message: "D01 did not complete with verified Qloo-attributed evidence; remaining scenarios were not run." });
        break;
      }
    }
  }
  report.comparisons = diagnosticComparisons(report.scenarios);
  for (const item of report.scenarios) delete item.result;
  const jsonPath = resolve(process.cwd(), "results/evaluation-diagnostic-qloo.json");
  const markdownPath = resolve(process.cwd(), "results/evaluation-diagnostic-qloo.md");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, diagnosticMarkdown(report));
  process.stdout.write(`${JSON.stringify({ ...report, reportPaths: { jsonPath, markdownPath } }, null, 2)}\n`);
}

function sensitivity(l01, l02) {
  if (l01?.researchOutcome !== "complete" || l02?.researchOutcome !== "complete") return { available: false, validationOutcome: "unavailable", reason: "Sensitivity comparison requires both L01 and L02 to complete with validated evidence." };
  try {
    const compared = compareDecisionSensitivity({ assumption: { dimension: "culturalSignal", originalValue: "Starbucks", alternativeValue: "Blue Bottle Coffee" }, originalResult: l01.result, variantResult: l02.result });
    return {
      available: true,
      validationOutcome: "valid",
      baseline: { stable: compared.comparison.baseline.stable.length, changed: compared.comparison.baseline.changed.length, newlyObserved: compared.comparison.baseline.newInVariant.length, notObservedInVariant: compared.comparison.baseline.notObservedInVariant.length },
      alternative: { stable: compared.comparison.alternative.stable.length, changed: compared.comparison.alternative.changed.length, newlyObserved: compared.comparison.alternative.newInVariant.length, notObservedInVariant: compared.comparison.alternative.notObservedInVariant.length },
      limitations: compared.limitations,
    };
  } catch (cause) {
    return { available: false, validationOutcome: "invalid", error: cause instanceof Error ? cause.message : "Sensitivity comparison validation failed" };
  }
}

function writeReports(report) {
  const jsonPath = resolve(process.cwd(), "results/evaluation-live-qloo.json");
  const markdownPath = resolve(process.cwd(), "results/evaluation-live-qloo.md");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# Mosaic Live Qloo Evaluation",
    "",
    `- Execution: ${report.executedAt}`,
    `- Mode: ${report.evaluationMode}`,
    `- Base URL: ${report.baseUrl}`,
    `- Scenarios attempted: ${report.scenariosExecuted}`,
    `- Complete: ${report.outcomeCounts.complete}`,
    `- Partial: ${report.outcomeCounts.partial}`,
    `- Failed: ${report.outcomeCounts.failed}`,
    "",
    "## Scenario outcomes",
    "",
    "| ID | Signal | Cities | Outcome | HTTP | Duration (ms) | Baseline evidence | Alternative evidence | Qloo evidence | Attribution |",
    "|---|---|---|---|---:|---:|---:|---:|---|---|",
    ...report.scenarios.map((item) => `| ${item.scenarioId} | ${item.signal} | ${item.baselineLocation} → ${item.alternativeLocation} | ${item.researchOutcome} | ${item.httpStatus ?? "—"} | ${item.durationMs} | ${item.verifiedEvidenceCountsByMarket.baseline} | ${item.verifiedEvidenceCountsByMarket.alternative} | ${item.qlooEvidenceActuallyReturned ? "yes" : "no"} | ${item.validProviderAttribution ? "valid" : "not confirmed"} |`),
    "",
    "## Repeatability",
    "",
    report.repeatability.available ? `L01/L08 payload identical: **${report.repeatability.payloadIdentical ? "yes" : "no"}**. Baseline shared IDs: **${report.repeatability.baseline.sharedProviderEntityIds}**; alternative shared IDs: **${report.repeatability.alternative.sharedProviderEntityIds}**.` : `Unavailable: ${report.repeatability.reason}`,
    "",
    "## Sensitivity",
    "",
    report.sensitivity.available ? `Validation: **${report.sensitivity.validationOutcome}**. Baseline stable/changed/new/not-observed: ${report.sensitivity.baseline.stable}/${report.sensitivity.baseline.changed}/${report.sensitivity.baseline.newlyObserved}/${report.sensitivity.baseline.notObservedInVariant}. Alternative stable/changed/new/not-observed: ${report.sensitivity.alternative.stable}/${report.sensitivity.alternative.changed}/${report.sensitivity.alternative.newlyObserved}/${report.sensitivity.alternative.notObservedInVariant}.` : `Unavailable: ${report.sensitivity.reason ?? report.sensitivity.error}`,
    "",
    "## Limitations",
    "",
    ...report.limitations.map((item) => `- ${item}`),
  ];
  writeFileSync(markdownPath, `${lines.join("\n")}\n`);
  return { jsonPath, markdownPath };
}

if (diagnosticMode) {
  await runDiagnostic();
  process.exit(0);
}

const preflightResult = await preflight();
const shapeResults = scenarios.map((item) => ({ scenarioId: item.id, ...requestShapeCheck(requestFor(item)) }));
const payloadIdentical = JSON.stringify(requestFor(scenarios[0])) === JSON.stringify(requestFor(scenarios[7]));
const report = { evaluationMode: "LIVE", executedAt: timestamp(), baseUrl, endpoint, timeoutMs, delayMs, preflight: preflightResult, requestShapeValidation: { allValid: shapeResults.every((item) => item.valid), scenarios: shapeResults, l01L08PayloadIdentical: payloadIdentical }, scenarios: [], scenariosExecuted: 0, outcomeCounts: { complete: 0, partial: 0, failed: 0 }, repeatability: { available: false, payloadIdentical }, sensitivity: { available: false, validationOutcome: "unavailable", reason: "Not run" }, errors: [], limitations: ["Live results are provider observations from the evaluation window, not accuracy, demand, or superiority measurements.", "Affinity scores are provider-native observations and are not compared as cross-market quantitative rankings.", "A missing top-N observation is not evidence of cultural absence.", "This run uses no automatic retries and makes no Gemini requests."] };

if (!preflightResult.reachable) {
  report.errors.push({ stage: "preflight", message: preflightResult.error });
} else if (!report.requestShapeValidation.allValid || !payloadIdentical) {
  report.errors.push({ stage: "request-validation", message: "Request shape validation failed or L01/L08 payloads differ" });
} else {
  for (let index = 0; index < scenarios.length; index += 1) {
    if (index > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    const item = scenarios[index];
    const payload = requestFor(item);
    const response = await fetchJson(endpoint, payload);
    const summary = response.transportError ? { researchOutcome: "failed", verifiedEvidenceCountsByMarket: { baseline: 0, alternative: 0 }, validProviderAttribution: false, qlooEvidenceActuallyReturned: false, validationErrors: [response.transportError], result: undefined, httpStatus: response.httpStatus } : summarizeResult(response.body, response.httpStatus);
    const errorType = response.transportError ? "network" : response.httpStatus !== undefined && response.httpStatus >= 400 ? "http" : summary.validationErrors.length > 0 ? "application" : undefined;
    const record = { scenarioId: item.id, productConcept: item.productConcept, signal: item.signal, baselineLocation: item.baselineLocation, alternativeLocation: item.alternativeLocation, startedAt: response.startedAt, durationMs: response.durationMs, httpStatus: response.httpStatus, researchOutcome: summary.researchOutcome, verifiedEvidenceCountsByMarket: summary.verifiedEvidenceCountsByMarket, validProviderAttribution: summary.validProviderAttribution, validationErrors: summary.validationErrors, errorType, qlooEvidenceActuallyReturned: summary.qlooEvidenceActuallyReturned, result: summary.result };
    report.scenarios.push(record);
    report.scenariosExecuted += 1;
    report.outcomeCounts[summary.researchOutcome] += 1;
    if (item.id === "L01" && summary.researchOutcome !== "complete") {
      report.errors.push({ stage: "l01-smoke", message: "L01 did not complete successfully; remaining scenarios were not run." });
      break;
    }
  }
}

const l01 = report.scenarios.find((item) => item.scenarioId === "L01");
const l08 = report.scenarios.find((item) => item.scenarioId === "L08");
report.repeatability = repeatability(l01, l08, payloadIdentical);
const l02 = report.scenarios.find((item) => item.scenarioId === "L02");
report.sensitivity = sensitivity(l01, l02);
for (const item of report.scenarios) delete item.result;
const paths = writeReports(report);
process.stdout.write(`${JSON.stringify({ ...report, reportPaths: paths }, null, 2)}\n`);
