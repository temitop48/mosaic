"use client";

import { useState } from "react";
import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import { compareDecisionSensitivity } from "@/core/sensitivity/compare";
import type { DecisionSensitivityDestination, DecisionSensitivityRelationship, DecisionSensitivityResult } from "@/core/sensitivity/contracts";
import { Button, Card, ErrorState, TextField } from "./primitives";
import { createCounterfactualRequest, locationForMarket, type StudioScenarioInput } from "./studio-model";

type SensitivityRequestValidation =
  | { ok: true; request: ReturnType<typeof createCounterfactualRequest>; signal: string }
  | { ok: false; message: string };

export function validateSensitivityRequest(originalRequest: StudioScenarioInput, originalResult: CounterfactualResult, alternativeSignal: string): SensitivityRequestValidation {
  const signal = alternativeSignal.trim();
  if (!signal) return { ok: false, message: "Enter an alternative cultural signal before running the experiment." };
  if (signal.localeCompare(originalRequest.seedQuery.trim(), undefined, { sensitivity: "accent" }) === 0) return { ok: false, message: "The alternative cultural signal must differ from the original signal." };
  if (originalResult.status !== "completed" || originalResult.errors.length > 0) return { ok: false, message: "Sensitivity experiments require completed original research with no research errors." };
  if (locationForMarket(originalResult, "baseline") !== originalRequest.baselineLocation.trim() || locationForMarket(originalResult, "alternative") !== originalRequest.alternativeLocation.trim()) return { ok: false, message: "The original research cities no longer match the active scenario." };
  return { ok: true, request: createCounterfactualRequest({ ...originalRequest, seedQuery: signal }), signal };
}

export function buildSensitivityResult(originalRequest: StudioScenarioInput, originalResult: CounterfactualResult, variantResult: CounterfactualResult, alternativeSignal: string): DecisionSensitivityResult {
  return compareDecisionSensitivity({
    assumption: { dimension: "culturalSignal", originalValue: originalRequest.seedQuery.trim(), alternativeValue: alternativeSignal.trim() },
    originalResult,
    variantResult,
  });
}

function relationshipLabel(item: DecisionSensitivityRelationship): string {
  return `${item.subjectEntityCategory} ${item.subjectEntityId} → ${item.objectEntityCategory} ${item.objectEntityId}`;
}

type EvidenceSource = "original" | "variant";

function EvidenceLink({ evidenceId, label, source, onInspect }: { evidenceId: string; label: string; source: EvidenceSource; onInspect: (evidenceId: string, source: EvidenceSource) => void }) {
  return <button type="button" onClick={() => onInspect(evidenceId, source)} className="font-mono text-[10px] text-[var(--mosaic-cobalt)] underline underline-offset-2">{label}</button>;
}

function RelationshipList({ title, items, onInspect }: { title: string; items: DecisionSensitivityRelationship[]; onInspect: (evidenceId: string, source: EvidenceSource) => void }) {
  if (items.length === 0) return null;
  return <div className="grid gap-2"><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--mosaic-muted)]">{title}</h4>{items.map((item) => <div key={`${item.status}:${item.providerId}:${item.subjectEntityId}:${item.objectEntityId}`} className="rounded-[var(--mosaic-radius-sm)] border border-[rgb(120_93_58_/_0.16)] bg-[rgb(251_248_241_/_0.56)] p-3"><p className="text-xs leading-5 text-[var(--mosaic-ink)]">{relationshipLabel(item)}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1"><span className="text-[10px] text-[var(--mosaic-muted)]">{item.providerId}</span>{item.originalEvidence && <EvidenceLink evidenceId={item.originalEvidence.evidenceId} label={`Original: ${item.originalEvidence.evidenceId}`} source="original" onInspect={onInspect} />}{item.variantEvidence && <EvidenceLink evidenceId={item.variantEvidence.evidenceId} label={`Modified: ${item.variantEvidence.evidenceId}`} source="variant" onInspect={onInspect} />}</div></div>)}</div>;
}

function DestinationList({ title, items, onInspect }: { title: string; items: DecisionSensitivityDestination[]; onInspect: (evidenceId: string, source: EvidenceSource) => void }) {
  if (items.length === 0) return null;
  return <div className="grid gap-2"><h5 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--mosaic-muted)]">{title}</h5>{items.map((item) => <div key={`${item.providerId}:${item.objectEntityCategory}:${item.objectEntityId}`} className="rounded-[var(--mosaic-radius-sm)] border border-[rgb(120_93_58_/_0.12)] bg-[rgb(251_248_241_/_0.42)] p-2.5"><p className="font-mono text-[10px] leading-4 text-[var(--mosaic-ink)]">{item.objectEntityCategory} {item.objectEntityId}</p><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{item.originalEvidence && <EvidenceLink evidenceId={item.originalEvidence.evidenceId} label={`Original: ${item.originalEvidence.evidenceId}`} source="original" onInspect={onInspect} />}{item.variantEvidence && <EvidenceLink evidenceId={item.variantEvidence.evidenceId} label={`Modified: ${item.variantEvidence.evidenceId}`} source="variant" onInspect={onInspect} />}</div></div>)}</div>;
}

function MarketReport({ result, market, onInspect }: { result: DecisionSensitivityResult; market: "baseline" | "alternative"; onInspect: (evidenceId: string, source: EvidenceSource) => void }) {
  const comparison = result.comparison[market];
  const city = locationForMarket(result.originalResult, market);
  const continuity = comparison.destinationContinuity;
  return <section className="grid gap-4" aria-labelledby={`sensitivity-${market}-title`}><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--mosaic-cobalt)]">Fixed market</p><h3 id={`sensitivity-${market}-title`} className="mosaic-serif mt-1 text-2xl text-[var(--mosaic-ink)]">{city}</h3></div><RelationshipList title="Observed in both analyses" items={comparison.stable} onInspect={onInspect} /><RelationshipList title="Observation changed" items={comparison.changed} onInspect={onInspect} /><RelationshipList title="Newly observed in the modified result" items={comparison.newInVariant} onInspect={onInspect} /><RelationshipList title="Not observed in the modified top-N results" items={comparison.notObservedInVariant} onInspect={onInspect} /><div className="mt-2 border-t border-[var(--mosaic-line)] pt-4"><h4 className="text-sm font-semibold text-[var(--mosaic-ink)]">Destination Continuity</h4><p className="mt-1 text-xs leading-5 text-[var(--mosaic-muted)]">{continuity.shared.length} destinations appear in both analyses, although their cultural relationships may differ. Jaccard overlap: {continuity.jaccardOverlap.toFixed(3)}.</p><div className="mt-3 grid gap-3"><DestinationList title={`Shared destinations (${continuity.shared.length})`} items={continuity.shared} onInspect={onInspect} /><DestinationList title={`Original-only destinations (${continuity.originalOnly.length})`} items={continuity.originalOnly} onInspect={onInspect} /><DestinationList title={`Modified-only destinations (${continuity.variantOnly.length})`} items={continuity.variantOnly} onInspect={onInspect} /></div></div></section>;
}

export function SensitivityPanel({ originalRequest, originalResult, sensitivity, busy, error, historical, onRun, onInspectEvidence }: { originalRequest?: StudioScenarioInput; originalResult?: CounterfactualResult; sensitivity?: DecisionSensitivityResult; busy: boolean; error?: string; historical?: boolean; onRun: (alternativeSignal: string) => void; onInspectEvidence: (evidenceId: string, source: EvidenceSource) => void }) {
  const [alternativeSignal, setAlternativeSignal] = useState("");
  if (!originalResult || !originalRequest || originalResult.status !== "completed") return null;
  if (historical) return <Card className="mt-7 border-[var(--mosaic-line)] bg-[var(--mosaic-blue-wash)] p-5" as="section"><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--mosaic-cobalt)]">Decision sensitivity</p><h2 className="mosaic-serif mt-2 text-2xl text-[var(--mosaic-ink)]">Fresh comparison unavailable</h2><p className="mt-2 text-sm leading-6 text-[var(--mosaic-muted)]">This is saved historical research. Run a new analysis before combining it with fresh provider observations.</p></Card>;
  return <Card className="mt-7 p-5 sm:p-6" as="section" aria-labelledby="decision-sensitivity-title"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--mosaic-cobalt)]">Decision sensitivity</p><h2 id="decision-sensitivity-title" className="mosaic-serif mt-2 text-2xl text-[var(--mosaic-ink)]">Test another cultural signal</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--mosaic-muted)]">Run a fresh provider analysis with one cultural signal changed. The product concept, cities, and strategic interpretation setting remain unchanged.</p></div><div className="rounded-full border border-[var(--mosaic-line)] px-3 py-1.5 text-xs text-[var(--mosaic-muted)]">{locationForMarket(originalResult, "baseline")} → {locationForMarket(originalResult, "alternative")}</div></div><div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><div className="rounded-[var(--mosaic-radius-sm)] bg-[var(--mosaic-blue-wash)] p-3"><span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--mosaic-muted)]">Original cultural signal</span><strong className="mt-1 block text-sm text-[var(--mosaic-ink)]">{originalRequest.seedQuery}</strong></div><TextField label="Alternative cultural signal" placeholder="Enter another signal" value={alternativeSignal} onChange={(event) => setAlternativeSignal(event.target.value)} disabled={busy} /><Button type="button" variant="accent" disabled={busy} onClick={() => onRun(alternativeSignal)}>{busy ? "Running…" : "Run Experiment"}</Button></div>{busy && <p className="mt-3 text-xs text-[var(--mosaic-muted)]" role="status" aria-live="polite">Researching the modified signal in both fixed markets…</p>}{error && <div className="mt-3"><ErrorState description={error} /></div>}{sensitivity && <div className="mt-7 border-t border-[var(--mosaic-line)] pt-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--mosaic-cobalt)]">Comparison report</p><h3 className="mosaic-serif mt-1 text-2xl text-[var(--mosaic-ink)]">{sensitivity.assumption.originalValue} <span className="text-[var(--mosaic-muted)]">→</span> {sensitivity.assumption.alternativeValue}</h3></div><p className="text-xs text-[var(--mosaic-muted)]">Same fixed markets · separate observations</p></div><div className="mt-6 grid gap-6 lg:grid-cols-2"><MarketReport result={sensitivity} market="baseline" onInspect={onInspectEvidence} /><MarketReport result={sensitivity} market="alternative" onInspect={onInspectEvidence} /></div><div className="mt-6 border-t border-[var(--mosaic-line)] pt-4"><h4 className="text-sm font-semibold text-[var(--mosaic-ink)]">Limitations</h4><ul className="mt-2 grid gap-1 text-xs leading-5 text-[var(--mosaic-muted)]">{sensitivity.limitations.map((limitation) => <li key={limitation}>• {limitation}</li>)}</ul></div></div>}</Card>;
}
