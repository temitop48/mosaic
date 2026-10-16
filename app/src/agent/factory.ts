import { DecisionEngine } from "@/agent/engine";
import { geminiConfigFromEnvironment } from "@/providers/gemini/config";
import { GeminiModelProvider } from "@/providers/gemini/adapter";
import { QlooProvider } from "@/providers/qloo/adapter";
import { qlooConfigFromEnvironment } from "@/providers/qloo/config";

export function createProductionDecisionEngine(): DecisionEngine {
  let qlooConfig;
  try {
    qlooConfig = qlooConfigFromEnvironment();
  } catch {
    throw new Error("Qloo server configuration is unavailable");
  }
  const geminiConfig = geminiConfigFromEnvironment();
  if (!geminiConfig) throw new Error("GEMINI_API_KEY is not configured on the server");
  return new DecisionEngine(new QlooProvider(qlooConfig), new GeminiModelProvider(geminiConfig));
}

export function createProductionResearchEngine(): DecisionEngine {
  let qlooConfig;
  try {
    qlooConfig = qlooConfigFromEnvironment();
  } catch {
    throw new Error("Qloo server configuration is unavailable");
  }
  return new DecisionEngine(new QlooProvider(qlooConfig));
}

export function createProductionCounterfactualEngine(includeStrategicInterpretation = false): DecisionEngine {
  let qlooConfig;
  try {
    qlooConfig = qlooConfigFromEnvironment();
  } catch {
    throw new Error("Qloo server configuration is unavailable");
  }
  if (!includeStrategicInterpretation) return new DecisionEngine(new QlooProvider(qlooConfig));
  const geminiConfig = geminiConfigFromEnvironment();
  return new DecisionEngine(new QlooProvider(qlooConfig), geminiConfig ? new GeminiModelProvider(geminiConfig) : undefined);
}
