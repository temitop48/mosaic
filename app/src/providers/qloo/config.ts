import { z } from "zod";

const QlooConfigSchema = z.object({
  apiKey: z.string().trim().min(1),
  baseUrl: z.url(),
  searchPath: z.string().startsWith("/"),
  affinityPath: z.string().startsWith("/"),
});

export type QlooConfig = z.infer<typeof QlooConfigSchema>;

export function qlooConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): QlooConfig {
  return QlooConfigSchema.parse({
    apiKey: environment.QLOO_API_KEY,
    baseUrl: environment.QLOO_API_BASE_URL,
    searchPath: environment.QLOO_SEARCH_PATH ?? "/search",
    affinityPath: environment.QLOO_AFFINITY_PATH ?? "/affinity",
  });
}
