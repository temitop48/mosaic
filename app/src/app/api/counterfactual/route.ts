import { NextResponse } from "next/server";
import { createProductionCounterfactualEngine } from "@/agent/factory";
import { CounterfactualRequestSchema } from "@/core/counterfactuals/contracts";
import { CounterfactualResearchEngine } from "@/core/counterfactuals/engine";
import { createRequestProtection, protectionFailureResponse, readBoundedBody, RequestProtectionUnavailableError, type RequestProtection } from "@/lib/request-protection";

export const maxDuration = 180;

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
  const body = await readBoundedBody(request);
  if (!body.ok) return json({ error: { code: "INVALID_REQUEST", message: "Request body is too large" } }, 413);
  let input: unknown;
  try { input = JSON.parse(body.body); } catch { return json({ error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON" } }, 400); }
  const parsed = CounterfactualRequestSchema.safeParse(input);
  if (!parsed.success) return json({ error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid counterfactual request" } }, 400);
  let lease: { release: () => Promise<void> } | undefined;
  try {
    const requestProtection = getProtection();
    if (!requestProtection && process.env.REQUEST_PROTECTION_MODE !== "disabled") return json({ error: { code: "REQUEST_PROTECTION_UNAVAILABLE", message: "Request protection is temporarily unavailable." } }, 503);
    if (requestProtection) {
      const admission = await requestProtection.admit(request, "counterfactual");
      if (!admission.ok) { const failure = protectionFailureResponse(admission); return json(failure.body, failure.status, failure.retryAfterSeconds); }
      lease = admission.lease;
    }
    const result = await new CounterfactualResearchEngine(createProductionCounterfactualEngine(parsed.data.includeStrategicInterpretation)).compare(parsed.data);
    return json(result, result.status === "failed" ? 422 : 200);
  } catch (cause) {
    if (cause instanceof RequestProtectionUnavailableError) return json({ error: { code: "REQUEST_PROTECTION_UNAVAILABLE", message: "Request protection is temporarily unavailable." } }, 503);
    return json({ error: { code: "SERVICE_UNAVAILABLE", message: "Counterfactual research service is unavailable" } }, 503);
  } finally {
    await lease?.release();
  }
}
