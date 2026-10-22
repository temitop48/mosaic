"use client";

import "./canvas.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { DecisionSensitivityResult } from "@/core/sensitivity/contracts";
import { Button, ErrorState, SelectControl, TextField, useStrategicInterpretationPreference } from "./primitives";
import { locationForMarket, normalizeResearchTarget, RESEARCH_TARGET_OPTIONS, type StudioMarket, type StudioScenarioInput } from "./studio-model";
import { CanvasCityComposition, CanvasComparisonCard, CanvasConstellation, CanvasEvidenceInspector, CanvasRecommendations } from "./canvas-components";
import { saveAnalysis, validateSaveableAnalysis } from "./saved-analyses";
import { SensitivityPanel } from "./sensitivity-panel";

const cityOptions = ["London", "New York", "Los Angeles", "Paris", "Tokyo", "Lagos"];

export function SaveAnalysisAction({ request, result }: { request: StudioScenarioInput; result: CounterfactualResult }) {
  const [message, setMessage] = useState<string>();
  const validation = validateSaveableAnalysis(result);
  function save() {
    const outcome = saveAnalysis(request, result);
    setMessage(outcome.ok ? "Analysis saved locally." : outcome.message);
  }
  return <div className="mt-4 flex flex-wrap items-center gap-3" aria-live="polite"><Button type="button" variant="outline" onClick={save} disabled={!validation.ok} aria-describedby={!validation.ok ? "save-analysis-explanation" : undefined}>Save Analysis</Button>{message && <span className="text-xs text-[var(--mosaic-muted)]">{message}</span>}{!validation.ok && <span id="save-analysis-explanation" className="text-xs text-[var(--mosaic-muted)]">{validation.message}</span>}</div>;
}

function CanvasScenarioForm({ onSubmit, onDraftChange, busy, initial }: { onSubmit: (input: StudioScenarioInput) => void; onDraftChange: (input: StudioScenarioInput) => void; busy: boolean; initial?: StudioScenarioInput }) {
  const { enabled: strategicDefault, setEnabled: setStrategicDefault } = useStrategicInterpretationPreference();
  const strategicTouched = useRef(false);
  const [productConcept, setProductConcept] = useState(initial?.productConcept ?? "");
  const [seedQuery, setSeedQuery] = useState(initial?.seedQuery ?? "");
  const [baselineLocation, setBaselineLocation] = useState(initial?.baselineLocation ?? "London");
  const [alternativeLocation, setAlternativeLocation] = useState(initial?.alternativeLocation ?? "New York");
  const [researchTarget, setResearchTarget] = useState(initial?.researchTarget ?? normalizeResearchTarget(undefined));
  const [includeStrategicInterpretation, setIncludeStrategicInterpretation] = useState(initial?.includeStrategicInterpretation ?? strategicDefault);
  useEffect(() => {
    if (!initial && !strategicTouched.current) setIncludeStrategicInterpretation(strategicDefault);
  }, [initial, strategicDefault]);
  function updateDraft(next: Partial<StudioScenarioInput>) {
    const draft = { productConcept, seedQuery, baselineLocation, alternativeLocation, researchTarget, includeStrategicInterpretation, ...next };
    onDraftChange(draft);
  }
  return <form className="canvas-scenario-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ productConcept, seedQuery, baselineLocation, alternativeLocation, researchTarget, includeStrategicInterpretation }); }}>
    <div className="canvas-form-fields"><div className="canvas-control-region canvas-signal-region"><strong>Your Cultural Signal</strong><div className="canvas-signal-fields"><TextField required label="Launch concept" placeholder="A coffee brand for creative communities" value={productConcept} onChange={(event) => { const value = event.target.value; setProductConcept(value); updateDraft({ productConcept: value }); }} /><TextField required label="Cultural signal" placeholder="Seed brand or entity" value={seedQuery} onChange={(event) => { const value = event.target.value; setSeedQuery(value); updateDraft({ seedQuery: value }); }} /></div></div><div className="canvas-control-region canvas-city-region"><strong>Compare Cities</strong><div className="canvas-city-fields"><SelectControl label="Baseline" value={baselineLocation} onChange={(event) => { const value = event.target.value; setBaselineLocation(value); updateDraft({ baselineLocation: value }); }} options={cityOptions.map((city) => ({ label: city, value: city }))} /><SelectControl label="Alternative" value={alternativeLocation} onChange={(event) => { const value = event.target.value; setAlternativeLocation(value); updateDraft({ alternativeLocation: value }); }} options={cityOptions.map((city) => ({ label: city, value: city }))} /></div></div><Button variant="accent" type="submit" disabled={busy}><Search aria-hidden="true" />{busy ? "Researching…" : "Run analysis"}</Button></div>
    <div className="flex flex-wrap items-start gap-4"><SelectControl label="Research target" value={researchTarget} onChange={(event) => { const value = normalizeResearchTarget(event.target.value); setResearchTarget(value); updateDraft({ researchTarget: value }); }} options={RESEARCH_TARGET_OPTIONS.map((option) => ({ label: option.label, value: option.value }))} /><label className="canvas-strategic-toggle"><input type="checkbox" checked={includeStrategicInterpretation} onChange={(event) => { const value = event.target.checked; strategicTouched.current = true; setIncludeStrategicInterpretation(value); setStrategicDefault(value); updateDraft({ includeStrategicInterpretation: value }); }} /><span><strong>Include strategic interpretation</strong><small>Gemini suggestions remain clearly labeled for validation.</small></span></label></div>
  </form>;
}

export function CanvasView({ result, busy, error, lastRequest, selectedEvidenceId, selectedEvidenceSource, onSubmit, onSelectEvidence, savedResearchAt, sensitivity, experimentBusy, experimentError, onRunExperiment, onInspectSensitivityEvidence }: { result?: CounterfactualResult; busy: boolean; error?: string; lastRequest?: StudioScenarioInput; selectedEvidenceId?: string; selectedEvidenceSource: "original" | "variant"; onSubmit: (input: StudioScenarioInput) => void; onSelectEvidence: (id: string) => void; savedResearchAt?: string; sensitivity?: DecisionSensitivityResult; experimentBusy: boolean; experimentError?: string; onRunExperiment: (alternativeSignal: string) => void; onInspectSensitivityEvidence: (evidenceId: string, source: "original" | "variant") => void }) {
  const [market, setMarket] = useState<StudioMarket>("baseline");
  const [draftScenario, setDraftScenario] = useState<StudioScenarioInput>(lastRequest ?? { productConcept: "", seedQuery: "", baselineLocation: "London", alternativeLocation: "New York", includeStrategicInterpretation: false });
  const selectedEvidence = useMemo(() => {
    if (!result || !selectedEvidenceId) return undefined;
    const evidence = selectedEvidenceSource === "variant" && sensitivity ? [...(sensitivity.variantResult.baselineResearch?.evidence ?? []), ...(sensitivity.variantResult.alternativeResearch?.evidence ?? [])] : [...(result.baselineResearch?.evidence ?? []), ...(result.alternativeResearch?.evidence ?? [])];
    return evidence.find((item) => item.id === selectedEvidenceId);
  }, [result, selectedEvidenceId, selectedEvidenceSource, sensitivity]);
  const baseline = result ? locationForMarket(result, "baseline") : draftScenario.baselineLocation;
  const alternative = result ? locationForMarket(result, "alternative") : draftScenario.alternativeLocation;

  function selectEvidence(id: string) { if (id) onSelectEvidence(id); }
  return <div className="canvas-page">
    <div className="canvas-decor canvas-decor-blue" aria-hidden="true" /><div className="canvas-decor canvas-decor-red" aria-hidden="true" /><div className="canvas-decor canvas-decor-green" aria-hidden="true" />
    <header className="canvas-hero"><div><h1>What if you<br />launched in...?</h1><p className="canvas-hero-copy">Explore how culture shifts across cities,<br className="canvas-desktop-break" /> and discover where your idea belongs.</p></div><CanvasCityComposition result={result} baselineCity={baseline} alternativeCity={alternative} /></header>
    <section id="scenario-workspace" className="canvas-scenario paper-panel" aria-labelledby="canvas-scenario-title"><div className="canvas-scenario-heading"><h2 id="canvas-scenario-title">Shape the comparison</h2><span className="canvas-scenario-cities">{baseline} <i>→</i> {alternative}</span></div><CanvasScenarioForm key={lastRequest ? `${lastRequest.seedQuery}:${lastRequest.productConcept}:${lastRequest.baselineLocation}:${lastRequest.alternativeLocation}:${lastRequest.researchTarget ?? "urn:entity:place"}` : "empty"} onSubmit={onSubmit} onDraftChange={setDraftScenario} busy={busy} initial={lastRequest} /></section>
    {error && <div className="canvas-error"><ErrorState description={error} /></div>}
    {busy && <div className="canvas-loading" aria-live="polite"><LoaderCircle aria-hidden="true" />Researching both markets and validating evidence…</div>}
    {savedResearchAt && <div className="mt-4 rounded-[var(--mosaic-radius-sm)] border border-[var(--mosaic-line)] bg-[var(--mosaic-blue-wash)] px-4 py-3 text-sm text-[var(--mosaic-ink)]" role="status"><strong>Saved research</strong><span className="ml-2 text-xs text-[var(--mosaic-muted)]">Original research saved {new Date(savedResearchAt).toLocaleString()}</span></div>}
    <SensitivityPanel key={lastRequest ? `${lastRequest.seedQuery}:${lastRequest.productConcept}:${lastRequest.baselineLocation}:${lastRequest.alternativeLocation}:${lastRequest.researchTarget ?? "urn:entity:place"}` : "empty"} originalRequest={lastRequest} originalResult={result} sensitivity={sensitivity} busy={experimentBusy} error={experimentError} historical={Boolean(savedResearchAt)} onRun={onRunExperiment} onInspectEvidence={onInspectSensitivityEvidence} />
    {result && lastRequest && <SaveAnalysisAction request={lastRequest} result={result} />}
    <main id="insights-workspace" className="canvas-layout" aria-label="Research insights"><section className="canvas-collage-constellation"><CanvasConstellation result={result} market={market} selectedEvidenceId={selectedEvidenceId} onSelectEvidence={selectEvidence} onMarketChange={setMarket} /></section><section className="canvas-collage-recommendations"><CanvasRecommendations result={result} market={market} selectedEvidenceId={selectedEvidenceId} onSelectEvidence={selectEvidence} onMarketChange={setMarket} /></section><section className="canvas-collage-insight"><CanvasComparisonCard result={result} /></section></main>
    <CanvasEvidenceInspector evidence={selectedEvidence} result={result} />
  </div>;
}
