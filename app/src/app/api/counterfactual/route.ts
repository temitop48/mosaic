import { NextResponse } from "next/server";
import { createProductionCounterfactualEngine } from "@/agent/factory";
import { CounterfactualRequestSchema } from "@/core/counterfactuals/contracts";
import { CounterfactualResearchEngine } from "@/core/counterfactuals/engine";

const MAX_REQUEST_BYTES = 16_384;

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_REQUEST_BYTES) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Request body is too large" } }, { status: 413 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON" } }, { status: 400 }); }
  const parsed = CounterfactualRequestSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid counterfactual request" } }, { status: 400 });
  try {
    const result = await new CounterfactualResearchEngine(createProductionCounterfactualEngine(parsed.data.includeStrategicInterpretation)).compare(parsed.data);
    return NextResponse.json(result, { status: result.status === "failed" ? 422 : 200 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Counterfactual research service is unavailable";
    return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message } }, { status: 503 });
  }
}
