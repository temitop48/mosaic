export type GeminiConfig = {
  apiKey: string;
  endpoint: string;
  timeoutMs: number;
};

export function geminiConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): GeminiConfig | undefined {
  const apiKey = environment.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  return {
    apiKey,
    endpoint: environment.GEMINI_API_ENDPOINT ?? "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    timeoutMs: Number(environment.GEMINI_TIMEOUT_MS ?? "15000"),
  };
}
