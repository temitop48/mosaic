export type GeminiConfig = {
  apiKey: string;
  endpoint: string;
  timeoutMs: number;
};

export function geminiConfigFromEnvironment(): GeminiConfig | undefined {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  return {
    apiKey,
    endpoint: process.env.GEMINI_API_ENDPOINT ?? "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS ?? "15000"),
  };
}

