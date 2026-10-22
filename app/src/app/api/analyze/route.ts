import { NextResponse } from "next/server";
import { createProductionDecisionEngine } from "@/agent/factory";
import { LaunchScenarioInputSchema } from "@/agent/contracts";
import { AgentResearchConfigSchema, buildAgentAuthorization, integrateBoundedAgentResearch, type AgentResearchConfig } from "@/agent/decision/integration";
import { createRequestProtection, protectionFailureResponse, readBoundedBody, RequestProtectionUnavailableError, type RequestProtection } from "@/lib/request-protection";

export const maxDuration = 180;
const AGENT_RESEARCH_WINDOW_MS = 150_000;

function json(data: unknown, status: number, retryAfterSeconds?: number): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (retryAfterSeconds !== undefined) headers.set("Retry-After", String(retryAfterSeconds));
  return NextResponse.json(data, { status, headers });
}

let protection: RequestProtection | undefined;
let protectionChecked = false;
function getProtection(): RequestProtection | undefined {
  if (!protectionChecked) {
    protectionChecked = true;
    protection = createRequestProtection();
  }
  return protection;
}

export async function POST(request: Request): Promise<Response> {
  const startedAtMs = Date.now();
  const body = await readBoundedBody(request);
  if (!body.ok) return json({ error: { code: "INVALID_SCENARIO", message: "Request body is too large" } }, 413);
  let input: unknown;
  try { input = JSON.parse(body.body); } catch { return json({ error: { code: "INVALID_SCENARIO", message: "Request body must be valid JSON" } }, 400); }
  const parsed = LaunchScenarioInputSchema.safeParse(input);
  if (!parsed.success) return json({ error: { code: "INVALID_SCENARIO", message: parsed.error.issues[0]?.message ?? "Invalid launch scenario" } }, 400);
  const rawAgentConfig = typeof input === "object" && input !== null && "agentResearch" in input ? (input as Record<string, unknown>).agentResearch : undefined;
  const agentParsed = rawAgentConfig === undefined ? { success: true as const, data: { enabled: false } as AgentResearchConfig } : AgentResearchConfigSchema.safeParse(rawAgentConfig);
  if (!agentParsed.success) return json({ error: { code: "INVALID_SCENARIO", message: agentParsed.error.issues[0]?.message ?? "Invalid agent research configuration" } }, 400);
  const initialTargetType = parsed.data.targetTypes?.[0] ?? "urn:entity:place";
  const agentMarkets = parsed.data.launchLocation ? [parsed.data.launchLocation] : [];
  if (agentParsed.data.enabled && (parsed.data.targetTypes?.length ?? 1) !== 1) return json({ error: { code: "INVALID_SCENARIO", message: "Agent research requires exactly one initial target category" } }, 400);
  const authorizationResult = buildAgentAuthorization(agentParsed.data, initialTargetType, agentMarkets);
  if (!authorizationResult.ok) return json({ error: { code: "INVALID_SCENARIO", message: authorizationResult.message } }, 400);
  let lease: { release: () => Promise<void> } | undefined;
  try {
    const requestProtection = getProtection();
    if (!requestProtection && process.env.REQUEST_PROTECTION_MODE !== "disabled") return json({ error: { code: "REQUEST_PROTECTION_UNAVAILABLE", message: "Request protection is temporarily unavailable." } }, 503);
    if (requestProtection) {
      const admission = await requestProtection.admit(request, "analyze");
      if (!admission.ok) { const failure = protectionFailureResponse(admission); return json(failure.body, failure.status, failure.retryAfterSeconds); }
      lease = admission.lease;
    }
    const engine = createProductionDecisionEngine();
    const result = await engine.analyze(parsed.data);
    if (!agentParsed.data.enabled || !authorizationResult.authorization || result.status === "failed" || !result.scenario.launchLocation) return json(result, result.status === "failed" ? 422 : 200);
    const agentResult = await integrateBoundedAgentResearch({
      engine,
      provider: engine.getResearchProvider(),
      authorization: authorizationResult.authorization,
      researches: [{ market: result.scenario.launchLocation, result }],
      deadlineAtMs: startedAtMs + AGENT_RESEARCH_WINDOW_MS,
    });
    const agentResearch = agentResult.ok
      ? { status: agentResult.execution.status, assessment: agentResult.execution.assessment, trace: agentResult.execution.trace, stopReason: agentResult.execution.trace.stopReason, budget: agentResult.execution.trace.budget, followUpEvidence: agentResult.execution.followUpEvidence, diagnostics: agentResult.execution.diagnostics, errors: agentResult.execution.errors }
      : { status: "unavailable" as const, error: { code: agentResult.code, message: agentResult.message } };
    return json({ ...result, agentResearch }, 200);
  } catch (cause) {
    if (cause instanceof RequestProtectionUnavailableError) return json({ error: { code: "REQUEST_PROTECTION_UNAVAILABLE", message: "Request protection is temporarily unavailable." } }, 503);
    return json({ error: { code: "SERVICE_UNAVAILABLE", message: "Analysis service is unavailable" } }, 503);
  } finally {
    await lease?.release();
  }
}
