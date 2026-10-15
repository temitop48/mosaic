import { NextResponse } from "next/server";
import { createProductionDecisionEngine } from "@/agent/factory";
import { LaunchScenarioInputSchema } from "@/agent/contracts";

const MAX_REQUEST_BYTES = 16_384;

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: { code: "INVALID_SCENARIO", message: "Request body is too large" } }, { status: 413 });
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_SCENARIO", message: "Request body must be valid JSON" } }, { status: 400 });
  }
  const parsed = LaunchScenarioInputSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "INVALID_SCENARIO", message: parsed.error.issues[0]?.message ?? "Invalid launch scenario" } }, { status: 400 });
  }
  try {
    const engine = createProductionDecisionEngine();
    const result = await engine.analyze(parsed.data);
    return NextResponse.json(result, { status: result.status === "failed" ? 422 : 200 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Analysis service is unavailable";
    return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message } }, { status: 503 });
  }
}
