import { DecisionEngine } from "@/agent/engine";
import { geminiConfigFromEnvironment } from "@/providers/gemini/config";
import { GeminiModelProvider } from "@/providers/gemini/adapter";
import { QlooProvider } from "@/providers/qloo/adapter";
import { qlooConfigFromEnvironment } from "@/providers/qloo/config";

export function createProductionDecisionEngine(): DecisionEngine {
  const qlooConfig = qlooConfigFromEnvironment();
  if (!qlooConfig) throw new Error("QLOO_API_KEY is not configured on the server");
  const geminiConfig = geminiConfigFromEnvironment();
  if (!geminiConfig) throw new Error("GEMINI_API_KEY is not configured on the server");
  return new DecisionEngine(new QlooProvider(qlooConfig), new GeminiModelProvider(geminiConfig));
}

