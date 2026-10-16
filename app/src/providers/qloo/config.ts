import { z } from "zod";

const QlooConfigSchema = z.object({
  apiKey: z.string().trim().min(1),
  baseUrl: z.url().default("https://hackathon.api.qloo.com"),
  searchPath: z.string().startsWith("/").default("/search"),
  insightsPath: z.string().startsWith("/").default("/v2/insights"),
  timeoutMs: z.number().int().positive().max(120_000).default(25_000),
  overallTimeoutMs: z.number().int().positive().max(300_000).optional(),
  maxAttempts: z.number().int().positive().max(3).optional(),
  retryBaseDelayMs: z.number().int().nonnegative().max(2_000).optional(),
}).superRefine((value, context) => {
  if (value.overallTimeoutMs !== undefined && value.overallTimeoutMs < value.timeoutMs) {
    context.addIssue({ code: "custom", path: ["overallTimeoutMs"], message: "Qloo overall timeout must be at least the per-request timeout" });
  }
});

export type QlooConfig = z.infer<typeof QlooConfigSchema>;

export function qlooConfigFromEnvironment(
  environment: Partial<NodeJS.ProcessEnv> = process.env,
): QlooConfig {
  return QlooConfigSchema.parse({
    apiKey: environment.QLOO_API_KEY,
    baseUrl: environment.QLOO_API_BASE_URL ?? "https://hackathon.api.qloo.com",
    searchPath: environment.QLOO_SEARCH_PATH ?? "/search",
    insightsPath: environment.QLOO_INSIGHTS_PATH ?? "/v2/insights",
    timeoutMs: environment.QLOO_TIMEOUT_MS ? Number(environment.QLOO_TIMEOUT_MS) : 25_000,
    overallTimeoutMs: environment.QLOO_OVERALL_TIMEOUT_MS ? Number(environment.QLOO_OVERALL_TIMEOUT_MS) : 60_000,
    maxAttempts: environment.QLOO_MAX_ATTEMPTS ? Number(environment.QLOO_MAX_ATTEMPTS) : undefined,
    retryBaseDelayMs: environment.QLOO_RETRY_BASE_DELAY_MS ? Number(environment.QLOO_RETRY_BASE_DELAY_MS) : undefined,
  });
}
