import { z } from "zod";

const QlooConfigSchema = z.object({
  apiKey: z.string().trim().min(1),
  baseUrl: z.url().default("https://hackathon.api.qloo.com"),
  searchPath: z.string().startsWith("/").default("/search"),
  insightsPath: z.string().startsWith("/").default("/v2/insights"),
  timeoutMs: z.number().int().positive().max(120_000).default(10_000),
});

export type QlooConfig = z.infer<typeof QlooConfigSchema>;

export function qlooConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): QlooConfig {
  return QlooConfigSchema.parse({
    apiKey: environment.QLOO_API_KEY,
    baseUrl: environment.QLOO_API_BASE_URL ?? "https://hackathon.api.qloo.com",
    searchPath: environment.QLOO_SEARCH_PATH ?? "/search",
    insightsPath: environment.QLOO_INSIGHTS_PATH ?? "/v2/insights",
    timeoutMs: environment.QLOO_TIMEOUT_MS ? Number(environment.QLOO_TIMEOUT_MS) : 10_000,
  });
}
