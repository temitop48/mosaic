export type GeminiConfig = {
  apiKey: string;
  model: string;
  endpoint: string;
  timeoutMs: number;
  overallTimeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  thinkingLevel?: "low" | "medium" | "high";
};

export function buildGeminiGenerateContentEndpoint(baseUrl: string, model: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/u, "");
  const normalizedModel = model.trim().replace(/^models\//u, "");
  return `${normalizedBaseUrl}/models/${encodeURIComponent(normalizedModel)}:generateContent`;
}

export function geminiConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): GeminiConfig | undefined {
  const apiKey = environment.GEMINI_API_KEY;
  const model = environment.GEMINI_MODEL?.trim().replace(/^models\//u, "");
  if (!apiKey || !model) return undefined;
  const baseUrl = environment.GEMINI_API_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";
  const configuredThinkingLevel = environment.GEMINI_THINKING_LEVEL?.trim().toLowerCase();
  const thinkingLevel = configuredThinkingLevel === "low" || configuredThinkingLevel === "medium" || configuredThinkingLevel === "high"
    ? configuredThinkingLevel
    : undefined;
  return {
    apiKey,
    model,
    endpoint: environment.GEMINI_API_ENDPOINT ?? buildGeminiGenerateContentEndpoint(baseUrl, model),
    timeoutMs: Number(environment.GEMINI_TIMEOUT_MS ?? "15000"),
    overallTimeoutMs: Number(environment.GEMINI_OVERALL_TIMEOUT_MS ?? "45000"),
    maxAttempts: Number(environment.GEMINI_MAX_ATTEMPTS ?? "2"),
    retryBaseDelayMs: Number(environment.GEMINI_RETRY_BASE_DELAY_MS ?? "250"),
    thinkingLevel,
  };
}
