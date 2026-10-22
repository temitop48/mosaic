import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import { CulturalEvidenceSchema } from "@/core/evidence/types";
import type { StudioResearchResult, StudioScenarioInput } from "./studio-model";
import type { DecisionStability, DecisionAssessmentSnapshot } from "@/core/decision-stability/contracts";
import { validateFollowUpEvidence } from "@/core/decision-stability/assessment";

export const SAVED_ANALYSES_KEY = "mosaic:saved-analyses:v1";
export const SAVED_ANALYSIS_HANDOFF_KEY = "mosaic:saved-analysis-handoff:v1";
export const SAVED_ANALYSES_SCHEMA_VERSION = 1;
export const SAVED_ANALYSES_LIMIT = 10;

export type SavedAnalysis = {
  id: string;
  title: string;
  request: StudioScenarioInput;
  result: StudioResearchResult;
  createdAt: string;
  schemaVersion: number;
  decisionStability?: DecisionStability;
};

type StorageLike = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem">>;
type SaveOutcome = { ok: true; entry: SavedAnalysis } | { ok: false; message: string };
export type SaveValidation = { ok: true } | { ok: false; message: string };

function browserStorage(): StorageLike | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isScenarioInput(value: unknown): value is StudioScenarioInput {
  return isRecord(value) && typeof value.productConcept === "string" && typeof value.seedQuery === "string" && typeof value.baselineLocation === "string" && typeof value.alternativeLocation === "string" && typeof value.includeStrategicInterpretation === "boolean";
}

function isAgentResearch(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || !["completed", "partial", "stopped", "unavailable"].includes(String(value.status))) return false;
  if (value.error !== undefined && (!isRecord(value.error) || typeof value.error.code !== "string" || typeof value.error.message !== "string")) return false;
  return value.followUpEvidence === undefined || Array.isArray(value.followUpEvidence);
}

function isCounterfactualResult(value: unknown): value is CounterfactualResult {
  if (!isRecord(value)) return false;
  if (value.status !== "completed" && value.status !== "partial" && value.status !== "failed") return false;
  if (value.dimension !== "launchLocation" || !isRecord(value.baselineScenario) || !isRecord(value.alternativeScenario) || !isRecord(value.comparison)) return false;
  return Array.isArray(value.limitations) && Array.isArray(value.errors) && (value.strategicInterpretationStatus === "not-requested" || value.strategicInterpretationStatus === "available" || value.strategicInterpretationStatus === "unavailable") && isAgentResearch(value.agentResearch);
}

const STABILITY_CLASSIFICATIONS = new Set(["stable-conclusion-changed-evidence", "changed-conclusion", "stable-conclusion-stable-evidence", "indeterminate"]);
const STABILITY_EVIDENCE = new Set(["changed", "stable", "indeterminate"]);
const STABILITY_COMPARABILITY = new Set(["comparable", "incomparable"]);
const DECISION_STATUSES = new Set(["supported", "partial", "insufficient", "unsupported", "follow-up-required"]);
const DECISION_CONCLUSIONS = new Set(["geographic-differences-observed", "no-observed-differences", "comparison-ready", "comparison-incomplete", "evidence-insufficient", "unsupported-commercial-conclusion", "follow-up-required", "follow-up-unavailable"]);

function isDecisionAssessmentSnapshot(value: unknown): value is DecisionAssessmentSnapshot {
  if (!isRecord(value)) return false;
  return typeof value.status === "string"
    && DECISION_STATUSES.has(value.status)
    && typeof value.conclusion === "string"
    && DECISION_CONCLUSIONS.has(value.conclusion)
    && typeof value.summary === "string"
    && Array.isArray(value.evidenceIds)
    && value.evidenceIds.every((item) => typeof item === "string" && item.length > 0);
}

function isDecisionStability(value: unknown): value is DecisionStability {
  if (!isRecord(value)) return false;
  return typeof value.classification === "string"
    && STABILITY_CLASSIFICATIONS.has(value.classification)
    && typeof value.explanation === "string"
    && typeof value.evidenceChange === "string"
    && STABILITY_EVIDENCE.has(value.evidenceChange)
    && typeof value.conclusionChange === "string"
    && STABILITY_EVIDENCE.has(value.conclusionChange)
    && typeof value.comparability === "string"
    && STABILITY_COMPARABILITY.has(value.comparability)
    && isDecisionAssessmentSnapshot(value.originalAssessment)
    && isDecisionAssessmentSnapshot(value.counterfactualAssessment)
    && Array.isArray(value.supportingEvidenceIds)
    && value.supportingEvidenceIds.every((item) => typeof item === "string" && item.length > 0)
    && Array.isArray(value.limitations)
    && value.limitations.every((item) => typeof item === "string" && item.length > 0);
}

function savedEvidenceIds(result: CounterfactualResult): string[] {
  return [...(result.baselineResearch?.evidence ?? []), ...(result.alternativeResearch?.evidence ?? [])]
    .filter((item) => item.verified === true && CulturalEvidenceSchema.safeParse(item).success)
    .map((item) => item.id);
}

function indeterminateSavedStability(result: CounterfactualResult, reason: string): DecisionStability {
  const evidenceIds = savedEvidenceIds(result);
  const snapshot: DecisionAssessmentSnapshot = {
    status: "insufficient",
    conclusion: "comparison-incomplete",
    summary: "Decision stability is unavailable because both counterfactual scenario results were not persisted.",
    evidenceIds,
  };
  return {
    classification: "indeterminate",
    originalAssessment: snapshot,
    counterfactualAssessment: snapshot,
    evidenceChange: "indeterminate",
    conclusionChange: "indeterminate",
    comparability: "incomparable",
    supportingEvidenceIds: evidenceIds,
    limitations: [reason, "Decision Stability requires the original and counterfactual results together; saved research contains only the original result."],
    explanation: "Saved Decision Stability is unavailable because it cannot be recomputed safely from the persisted research alone.",
  };
}

function normalizePersistedStability(result: CounterfactualResult, persisted: unknown): DecisionStability | undefined {
  if (persisted === undefined) return undefined;
  const primaryEvidenceValid = hasValidatedResearch(result.baselineResearch) && hasValidatedResearch(result.alternativeResearch);
  const followUp = validateFollowUpEvidence(result);
  if (!isDecisionStability(persisted)) return indeterminateSavedStability(result, "Persisted Decision Stability data is malformed or uses unsupported values.");
  if (!primaryEvidenceValid) return indeterminateSavedStability(result, "Persisted research evidence is incomplete or unverifiable.");
  if (!followUp.valid) return indeterminateSavedStability(result, followUp.reason);
  return indeterminateSavedStability(result, "Persisted Decision Stability cannot be recomputed because the counterfactual result is not stored.");
}

function isSavedAnalysis(value: unknown): value is SavedAnalysis {
  return isRecord(value) && value.schemaVersion === SAVED_ANALYSES_SCHEMA_VERSION && typeof value.id === "string" && value.id.length > 0 && typeof value.title === "string" && value.title.length > 0 && isScenarioInput(value.request) && isCounterfactualResult(value.result) && typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt));
}

function normalizeSavedAnalysis(value: unknown): SavedAnalysis | undefined {
  if (!isSavedAnalysis(value)) return undefined;
  const stability = normalizePersistedStability(value.result, value.decisionStability);
  return stability ? { ...value, decisionStability: stability } : value;
}

export function parseSavedAnalyses(raw: string | null): SavedAnalysis[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSavedAnalysis).filter((entry): entry is SavedAnalysis => Boolean(entry));
  } catch {
    return [];
  }
}

export function loadSavedAnalyses(storage: StorageLike | undefined = browserStorage()): SavedAnalysis[] {
  if (!storage) return [];
  try {
    return parseSavedAnalyses(storage.getItem(SAVED_ANALYSES_KEY));
  } catch {
    return [];
  }
}

export function readSavedAnalysesSnapshot(): string {
  const storage = browserStorage();
  if (!storage) return "[]";
  try {
    return storage.getItem(SAVED_ANALYSES_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

export function subscribeToSavedAnalyses(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const handleChange = () => onChange();
  window.addEventListener("storage", handleChange);
  window.addEventListener("mosaic:saved-analyses-change", handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener("mosaic:saved-analyses-change", handleChange);
  };
}

function writeSavedAnalyses(entries: SavedAnalysis[], storage: StorageLike): SaveOutcome {
  try {
    storage.setItem(SAVED_ANALYSES_KEY, JSON.stringify(entries));
    if (typeof window !== "undefined") window.dispatchEvent(new Event("mosaic:saved-analyses-change"));
    return { ok: true, entry: entries[0]! };
  } catch {
    return { ok: false, message: "This analysis could not be saved. Browser storage may be unavailable or full." };
  }
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `saved-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function savedAnalysisTitle(request: StudioScenarioInput) {
  const concept = request.productConcept.trim() || request.seedQuery.trim() || "Cultural signal";
  return `${concept} · ${request.baselineLocation} → ${request.alternativeLocation}`;
}

function hasValidatedResearch(value: unknown): boolean {
  if (!isRecord(value) || value.status !== "completed" || !Array.isArray(value.evidence) || value.evidence.length === 0) return false;
  if (!Array.isArray(value.errors) || value.errors.length > 0) return false;
  return value.evidence.every((item) => {
    if (!isRecord(item) || item.verified !== true) return false;
    const parsed = CulturalEvidenceSchema.safeParse(item);
    return parsed.success && parsed.data.kind === "affinity" && parsed.data.providerScore !== undefined && Number.isFinite(parsed.data.providerScore);
  });
}

export function validateSaveableAnalysis(result: unknown): SaveValidation {
  if (!isRecord(result) || result.status !== "completed") return { ok: false, message: "Save unavailable: only completed research can be saved." };
  if (result.dimension !== "launchLocation" || !isRecord(result.comparison) || !Array.isArray(result.limitations) || !Array.isArray(result.errors)) return { ok: false, message: "Save unavailable: the research result is structurally invalid." };
  if (result.errors.length > 0) return { ok: false, message: "Save unavailable: the completed result contains research errors." };
  if (!hasValidatedResearch(result.baselineResearch)) return { ok: false, message: "Save unavailable: validated baseline evidence is required." };
  if (!hasValidatedResearch(result.alternativeResearch)) return { ok: false, message: "Save unavailable: validated alternative evidence is required." };
  return { ok: true };
}

export function saveAnalysis(request: StudioScenarioInput, result: StudioResearchResult, storage: StorageLike | undefined = browserStorage(), now = new Date(), decisionStability?: DecisionStability): SaveOutcome {
  const validation = validateSaveableAnalysis(result);
  if (!validation.ok) return validation;
  if (!storage) return { ok: false, message: "This analysis could not be saved because browser storage is unavailable." };
  const existing = loadSavedAnalyses(storage);
  if (existing.length >= SAVED_ANALYSES_LIMIT) return { ok: false, message: `You can keep up to ${SAVED_ANALYSES_LIMIT} saved analyses. Delete one before saving another.` };
  const entry: SavedAnalysis = { id: createId(), title: savedAnalysisTitle(request), request: { ...request }, result, createdAt: now.toISOString(), schemaVersion: SAVED_ANALYSES_SCHEMA_VERSION, ...(decisionStability ? { decisionStability } : {}) };
  const written = writeSavedAnalyses([entry, ...existing], storage);
  return written.ok ? { ok: true, entry } : written;
}

export function deleteSavedAnalysis(id: string, storage: StorageLike | undefined = browserStorage()): { ok: true } | { ok: false; message: string } {
  if (!storage) return { ok: false, message: "Saved analyses are unavailable because browser storage cannot be accessed." };
  const existing = loadSavedAnalyses(storage);
  if (!existing.some((entry) => entry.id === id)) return { ok: true };
  try {
    storage.setItem(SAVED_ANALYSES_KEY, JSON.stringify(existing.filter((entry) => entry.id !== id)));
    if (typeof window !== "undefined") window.dispatchEvent(new Event("mosaic:saved-analyses-change"));
    return { ok: true };
  } catch {
    return { ok: false, message: "This saved analysis could not be deleted." };
  }
}
