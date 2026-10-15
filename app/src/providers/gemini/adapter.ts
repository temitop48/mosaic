import { parseBlueprintModelOutput, type BlueprintModelInput, type ModelResult, type StructuredModelProvider } from "@/agent/model";
import type { GeminiConfig } from "@/providers/gemini/config";

type GeminiHttpRequest = (input: string, init: RequestInit) => Promise<Response>;

export class GeminiModelProvider implements StructuredModelProvider {
  readonly id = "gemini";
  private readonly request: GeminiHttpRequest;
  private readonly config: GeminiConfig;

  constructor(config: GeminiConfig, request: GeminiHttpRequest = fetch) {
    this.config = config;
    this.request = request;
  }

  async generateBlueprint(input: BlueprintModelInput): Promise<ModelResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.request(this.config.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.config.apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: this.prompt(input) }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      });
      if (!response.ok) return { ok: false, error: { code: "MODEL_ERROR", message: `Gemini request failed with HTTP ${response.status}` } };
      const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      try {
        return parseBlueprintModelOutput(JSON.parse(text.replace(/^```json\s*/u, "").replace(/\s*```$/u, "")));
      } catch {
        return { ok: false, error: { code: "MODEL_INVALID_OUTPUT", message: "Gemini returned non-JSON blueprint output" } };
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return { ok: false, error: { code: "MODEL_TIMEOUT", message: "Gemini request timed out" } };
      return { ok: false, error: { code: "MODEL_ERROR", message: "Gemini request failed" } };
    } finally {
      clearTimeout(timeout);
    }
  }

  private prompt(input: BlueprintModelInput): string {
    return [
      "Return only JSON matching this shape: {who:{claims:[]},where:{claims:[]},withWhat:{claims:[]},alongsideWhom:{claims:[]},why:{claims:[]},caveats:[]}.",
      "Each claim must have text, classification (verified-observation|interpretation|unverified-suggestion), evidenceIds, and optional subjectEntityId/objectEntityId.",
      "Only call a claim verified-observation when the supplied evidence directly supports the exact entity pair. Never invent scores, entities, demographics, demand, partnerships, causality or commercial success.",
      JSON.stringify({ productConcept: input.productConcept, launchLocation: input.launchLocation, requestedOutcome: input.requestedOutcome, evidence: input.evidence }),
    ].join("\n");
  }
}
