import { parseBlueprintModelOutput, parseStrategicModelOutput, type BlueprintModelInput, type ModelError, type ModelResult, type StrategicModelInput, type StrategicModelResult, type StructuredModelProvider } from "@/agent/model";
import { CulturalEvidenceSchema, type CulturalEvidence } from "@/core/evidence/types";
import type { GeminiConfig } from "@/providers/gemini/config";

type GeminiHttpRequest = (input: string, init: RequestInit) => Promise<Response>;
type Sleeper = (milliseconds: number) => Promise<void>;
type GeminiJsonSchema = Readonly<Record<string, unknown>>;

const blueprintSectionSchema: GeminiJsonSchema = {
  type: "OBJECT",
  properties: {
    claims: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING" },
          classification: { type: "STRING", enum: ["verified-observation", "interpretation", "unverified-suggestion"] },
          evidenceIds: { type: "ARRAY", items: { type: "STRING" } },
          subjectEntityId: { type: "STRING" },
          objectEntityId: { type: "STRING" },
        },
        required: ["text", "classification", "evidenceIds"],
      },
    },
  },
  required: ["claims"],
};

export const GEMINI_BLUEPRINT_RESPONSE_SCHEMA: GeminiJsonSchema = {
  type: "OBJECT",
  properties: {
    who: blueprintSectionSchema,
    where: blueprintSectionSchema,
    withWhat: blueprintSectionSchema,
    alongsideWhom: blueprintSectionSchema,
    why: blueprintSectionSchema,
    caveats: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["who", "where", "withWhat", "alongsideWhom", "why", "caveats"],
};

const strategicClaimSchema: GeminiJsonSchema = {
  type: "OBJECT",
  properties: {
    text: { type: "STRING" },
    classification: { type: "STRING", enum: ["verified-observation", "interpretation", "unverified-suggestion"] },
    market: { type: "STRING", enum: ["baseline", "alternative", "comparison"] },
    evidenceIds: { type: "ARRAY", items: { type: "STRING" } },
    subjectEntityId: { type: "STRING" },
    objectEntityId: { type: "STRING" },
  },
  required: ["text", "classification", "market", "evidenceIds"],
};
export const GEMINI_COUNTERFACTUAL_RESPONSE_SCHEMA: GeminiJsonSchema = {
  type: "OBJECT",
  properties: {
    scenarioChange: { type: "ARRAY", items: strategicClaimSchema },
    evidenceBackedObservations: { type: "ARRAY", items: strategicClaimSchema },
    potentialStrategicImplications: { type: "ARRAY", items: strategicClaimSchema },
    suggestedPositioningAdjustments: { type: "ARRAY", items: strategicClaimSchema },
    suggestedAudienceConsiderations: { type: "ARRAY", items: strategicClaimSchema },
    suggestedCulturalTouchpoints: { type: "ARRAY", items: strategicClaimSchema },
    uncertaintiesAndLimitations: { type: "ARRAY", items: { type: "STRING" } },
    supportingEvidenceReferences: { type: "ARRAY", items: { type: "OBJECT", properties: { evidenceId: { type: "STRING" }, market: { type: "STRING", enum: ["baseline", "alternative", "comparison"] } }, required: ["evidenceId", "market"] } },
    culturalPossibilities: { type: "ARRAY", items: strategicClaimSchema },
    positioningAndLaunchExecution: { type: "ARRAY", items: strategicClaimSchema },
    assumptionsToValidate: { type: "ARRAY", items: strategicClaimSchema },
    caveats: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["scenarioChange", "evidenceBackedObservations", "potentialStrategicImplications", "suggestedPositioningAdjustments", "suggestedAudienceConsiderations", "suggestedCulturalTouchpoints", "uncertaintiesAndLimitations", "supportingEvidenceReferences"],
};

export type GeminiDiagnosticEvent = {
  model: string;
  requestBytes: number;
  attempt: number;
  durationMs: number;
  status?: number;
  retryReason?: ModelError["code"];
  backoffMs?: number;
  finalError?: ModelError["code"];
  validationOutcome?: "valid-response" | "empty-response" | "invalid-blueprint";
};

export type GeminiDiagnosticResult = {
  ok: boolean;
  status?: number;
  text?: string;
  requestBytes: number;
  durationMs: number;
  attempts: number;
  error?: ModelError;
};

type GeminiContentPayload = { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
type GeminiContentResult =
  | { ok: true; status: number; text: string; requestBytes: number; durationMs: number; attempts: number }
  | { ok: false; requestBytes: number; durationMs: number; attempts: number; error: ModelError };

type CompactEvidence = {
  evidenceId: string;
  providerId: string;
  source: { id: string; category: string; name?: string };
  target: { id: string; category: string; name?: string };
  providerScore?: number;
  providerScoreLabel?: string;
  providerScoreScale?: string;
  explainability?: Record<string, unknown>;
  geography?: CulturalEvidence["geographicContext"];
  queryParameters: Record<string, string>;
  retrievedAt: string;
  sourceReference: string;
};

function compactEvidence(value: unknown): CompactEvidence | undefined {
  const parsed = CulturalEvidenceSchema.safeParse(value);
  if (!parsed.success || parsed.data.kind !== "affinity") return undefined;
  const evidence = parsed.data;
  if (typeof evidence.subjectEntityId !== "string" || typeof evidence.objectEntityId !== "string") return undefined;
  if (!evidence.provenance || typeof evidence.provenance.providerId !== "string" || typeof evidence.provenance.sourceReference !== "string" || typeof evidence.provenance.retrievedAt !== "string") return undefined;
  const queryParameters = Object.fromEntries(Object.entries(evidence.queryParameters ?? {}).filter(([key]) =>
    key === "filter.location.query" || key === "filter.type" || key === "signal.interests.entities"));
  return {
    evidenceId: evidence.id,
    providerId: evidence.provenance.providerId,
    source: { id: evidence.subjectEntityId, category: evidence.subjectEntityCategory ?? "unknown", ...(evidence.subjectEntityName ? { name: evidence.subjectEntityName } : {}) },
    target: { id: evidence.objectEntityId, category: evidence.objectEntityCategory ?? "unknown", ...(evidence.objectEntityName ? { name: evidence.objectEntityName } : {}) },
    ...(typeof evidence.providerScore === "number" ? { providerScore: evidence.providerScore } : {}),
    ...(evidence.providerScoreLabel ? { providerScoreLabel: evidence.providerScoreLabel } : {}),
    ...(evidence.providerScoreScale ? { providerScoreScale: evidence.providerScoreScale } : {}),
    ...(evidence.explainability ? { explainability: evidence.explainability } : {}),
    ...(evidence.geographicContext ? { geography: evidence.geographicContext } : {}),
    queryParameters,
    retrievedAt: evidence.provenance.retrievedAt,
    sourceReference: evidence.provenance.sourceReference,
  };
}

export function compactEvidenceForPrompt(evidence: readonly unknown[]): CompactEvidence[] {
  return evidence.flatMap((item) => {
    const compact = compactEvidence(item);
    return compact ? [compact] : [];
  });
}

export function buildGeminiPrompt(input: BlueprintModelInput): string {
  const promptEvidence = compactEvidenceForPrompt(input.evidence);
  return [
    "Return only JSON matching this shape: {who:{claims:[]},where:{claims:[]},withWhat:{claims:[]},alongsideWhom:{claims:[]},why:{claims:[]},caveats:[]}.",
    "Each claim must have text, classification (verified-observation|interpretation|unverified-suggestion), evidenceIds, and optional subjectEntityId/objectEntityId.",
    "Every evidenceIds value must be an array of exact evidenceId strings copied verbatim from the supplied evidence. The only valid IDs are listed in availableEvidenceIds. Use [] when a claim has no direct supporting evidence. Never use source IDs, target IDs, scores, names or invented identifiers as evidence IDs.",
    "Only call a claim verified-observation when the supplied evidence directly supports the exact entity pair. Never invent scores, entities, demographics, demand, partnerships, causality or commercial success.",
    "Evidence IDs, source and target IDs/categories, scores and explainability are provider-supplied facts. Do not alter or create them.",
    JSON.stringify({ productConcept: input.productConcept, launchLocation: input.launchLocation, requestedOutcome: input.requestedOutcome, availableEvidenceIds: promptEvidence.map((item) => item.evidenceId), evidence: promptEvidence }),
  ].join("\n");
}

export function buildGeminiCounterfactualPrompt(input: StrategicModelInput): string {
  const evidence = input.evidence.flatMap((item) => {
    const compact = compactEvidence(item.evidence);
    return compact ? [{ market: item.market, ...compact }] : [];
  });
  return [
    "Return only JSON matching the supplied counterfactual strategic interpretation schema, including scenarioChange, evidenceBackedObservations, potentialStrategicImplications, suggestedPositioningAdjustments, suggestedAudienceConsiderations, suggestedCulturalTouchpoints, uncertaintiesAndLimitations, and supportingEvidenceReferences.",
    "Ground every explanation in the deterministic comparison and the supplied provider observations. Explain the observed evidence changes (added, removed, or changed observations) before discussing possible launch implications. The comparison is descriptive, not a demand forecast or market-fit score.",
    "Cultural possibilities are hypotheses about what may be explored, not proof of audience demand. Positioning and launch execution must remain testable suggestions.",
    "Do not invent cultural relationships, scores, entities, demographics, demand, commercial success, partnerships or causality. Do not treat top-N absence as cultural absence.",
    "Each claim and supportingEvidenceReferences entry must identify market=baseline, alternative, or comparison. Evidence IDs must be copied exactly from availableEvidence and must belong to the named market. Use [] for a hypothesis without direct evidence; never create an ID. A verified-observation must also include the exact subjectEntityId and objectEntityId from a cited observation.",
    JSON.stringify({ productConcept: input.productConcept, baselineLocation: input.baselineLocation, alternativeLocation: input.alternativeLocation, deterministicComparison: input.comparison, availableEvidence: evidence }),
  ].join("\n");
}

export class GeminiModelProvider implements StructuredModelProvider {
  readonly id = "gemini";
  private readonly request: GeminiHttpRequest;
  private readonly config: GeminiConfig;
  private readonly sleep: Sleeper;
  private readonly onDiagnostic?: (event: GeminiDiagnosticEvent) => void;

  constructor(
    config: GeminiConfig,
    request: GeminiHttpRequest = fetch,
    sleep: Sleeper = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    onDiagnostic?: (event: GeminiDiagnosticEvent) => void,
  ) {
    this.config = config;
    this.request = request;
    this.sleep = sleep;
    this.onDiagnostic = onDiagnostic;
  }

  async generateBlueprint(input: BlueprintModelInput): Promise<ModelResult> {
    const response = await this.generateContent(buildGeminiPrompt(input), "application/json", GEMINI_BLUEPRINT_RESPONSE_SCHEMA);
    if (!response.ok) {
      const error: ModelError = response.error ?? { code: "MODEL_UPSTREAM_ERROR", message: "Gemini request failed" };
      return { ok: false, error };
    }
    try {
      return parseBlueprintModelOutput(JSON.parse((response.text ?? "").replace(/^```json\s*/u, "").replace(/\s*```$/u, "")));
    } catch {
      return { ok: false, error: { code: "MODEL_INVALID_OUTPUT", message: "Gemini returned non-JSON blueprint output" } };
    }
  }

  async generateCounterfactualInterpretation(input: StrategicModelInput): Promise<StrategicModelResult> {
    const response = await this.generateContent(buildGeminiCounterfactualPrompt(input), "application/json", GEMINI_COUNTERFACTUAL_RESPONSE_SCHEMA);
    if (!response.ok) return { ok: false, error: response.error ?? { code: "MODEL_UPSTREAM_ERROR", message: "Gemini request failed" } };
    try {
      return parseStrategicModelOutput(JSON.parse((response.text ?? "").replace(/^```json\s*/u, "").replace(/\s*```$/u, "")));
    } catch {
      return { ok: false, error: { code: "MODEL_INVALID_OUTPUT", message: "Gemini returned non-JSON counterfactual interpretation output" } };
    }
  }

  /** Development diagnostics use this same authenticated adapter path without exposing response text. */
  async generateDiagnostic(prompt: string, responseMimeType?: "application/json", responseSchema?: GeminiJsonSchema): Promise<GeminiDiagnosticResult> {
    const result = await this.generateContent(prompt, responseMimeType, responseSchema);
    return result.ok
      ? { ok: true, status: result.status, text: result.text, requestBytes: result.requestBytes, durationMs: result.durationMs, attempts: result.attempts }
      : { ok: false, requestBytes: result.requestBytes, durationMs: result.durationMs, attempts: result.attempts, error: result.error };
  }

  private async generateContent(prompt: string, responseMimeType?: "application/json", responseSchema?: GeminiJsonSchema): Promise<GeminiContentResult> {
    const generationConfig = {
      ...(responseMimeType ? { responseMimeType } : {}),
      ...(responseSchema ? { responseSchema } : {}),
      ...(this.config.thinkingLevel ? { thinkingConfig: { thinkingLevel: this.config.thinkingLevel } } : {}),
    };
    const body = { contents: [{ parts: [{ text: prompt }] }], ...(Object.keys(generationConfig).length ? { generationConfig } : {}) };
    const serializedBody = JSON.stringify(body);
    const requestBytes = new TextEncoder().encode(serializedBody).byteLength;
    const startedAt = Date.now();
    const maxAttempts = Math.max(1, this.config.maxAttempts ?? 2);
    const overallTimeoutMs = Math.max(this.config.timeoutMs, this.config.overallTimeoutMs ?? this.config.timeoutMs);
    const deadline = startedAt + overallTimeoutMs;
    let attempts = 0;
    let lastError: ModelError | undefined;
    while (attempts < maxAttempts && Date.now() < deadline) {
      attempts += 1;
      const attemptTimeoutMs = Math.min(this.config.timeoutMs, deadline - Date.now());
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
      try {
        const response = await this.request(this.config.endpoint, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": this.config.apiKey }, signal: controller.signal, body: serializedBody });
        if (response.ok) {
          let payload: GeminiContentPayload;
          try {
            payload = await response.json() as GeminiContentPayload;
          } catch {
            const durationMs = Date.now() - startedAt;
            this.emit({ model: this.config.model, requestBytes, attempt: attempts, durationMs, status: response.status, validationOutcome: "invalid-blueprint", finalError: "MODEL_INVALID_OUTPUT" });
            return { ok: false, requestBytes, durationMs, attempts, error: { code: "MODEL_INVALID_OUTPUT", message: "Gemini returned an invalid JSON response" } };
          }
          const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
          const durationMs = Date.now() - startedAt;
          this.emit({ model: this.config.model, requestBytes, attempt: attempts, durationMs, status: response.status, validationOutcome: text.trim() ? "valid-response" : "empty-response" });
          if (!text.trim()) return { ok: false, requestBytes, durationMs, attempts, error: { code: "MODEL_INVALID_OUTPUT", message: "Gemini returned an empty response" } };
          return { ok: true, status: response.status, text, requestBytes, durationMs, attempts };
        }
        lastError = this.classifyHttpError(response);
        if (!this.isRetryable(lastError) || attempts >= maxAttempts) break;
        const delay = Math.min(this.retryDelay(lastError, attempts), Math.max(0, deadline - Date.now()));
        this.emit({ model: this.config.model, requestBytes, attempt: attempts, durationMs: Date.now() - startedAt, status: response.status, retryReason: lastError.code, backoffMs: delay });
        if (delay > 0) await this.sleep(delay);
      } catch (cause) {
        const timedOut = cause instanceof Error && cause.name === "AbortError";
        lastError = timedOut
          ? { code: "MODEL_TIMEOUT", message: "Gemini request timed out" }
          : { code: "MODEL_UPSTREAM_ERROR", message: "Gemini request failed" };
        if (!this.isRetryable(lastError) || attempts >= maxAttempts || Date.now() >= deadline) break;
        const delay = Math.min(this.retryDelay(lastError, attempts), Math.max(0, deadline - Date.now()));
        this.emit({ model: this.config.model, requestBytes, attempt: attempts, durationMs: Date.now() - startedAt, retryReason: lastError.code, backoffMs: delay });
        if (delay > 0) await this.sleep(delay);
      } finally {
        clearTimeout(timeout);
      }
    }
    const error: ModelError = lastError ?? { code: "MODEL_TIMEOUT", message: "Gemini request deadline exceeded" };
    this.emit({ model: this.config.model, requestBytes, attempt: attempts, durationMs: Date.now() - startedAt, finalError: error.code });
    return { ok: false, requestBytes, durationMs: Date.now() - startedAt, attempts, error };
  }

  private isRetryable(error: ModelError): boolean {
    return error.code === "MODEL_TIMEOUT" || error.code === "MODEL_RATE_LIMITED" || (error.code === "MODEL_UPSTREAM_ERROR" && (error.status === undefined || [502, 503, 504].includes(error.status)));
  }

  private retryDelay(error: ModelError, attempt: number): number {
    if (error.retryAfterMs !== undefined) return error.retryAfterMs;
    const base = (this.config.retryBaseDelayMs ?? 250) * (2 ** (attempt - 1));
    return Math.round(base + Math.random() * base * 0.25);
  }

  private emit(event: GeminiDiagnosticEvent): void {
    try { this.onDiagnostic?.(event); } catch { /* Diagnostics must never affect production behavior. */ }
  }

  private classifyHttpError(response: Response): ModelError {
    if (response.status === 401 || response.status === 403) return { code: "MODEL_AUTHENTICATION_ERROR", message: `Gemini authentication failed with HTTP ${response.status}`, status: response.status };
    if (response.status === 404) return { code: "MODEL_NOT_FOUND", message: "Configured Gemini model or endpoint was not found", status: response.status };
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const retryAfterMs = retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : undefined;
      return { code: "MODEL_RATE_LIMITED", message: "Gemini rate limit exceeded", status: response.status, retryAfterMs };
    }
    if (response.status >= 500) return { code: "MODEL_UPSTREAM_ERROR", message: `Gemini upstream failure with HTTP ${response.status}`, status: response.status };
    return { code: "MODEL_ERROR", message: `Gemini request was rejected with HTTP ${response.status}`, status: response.status };
  }
}
