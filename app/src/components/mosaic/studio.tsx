"use client";

import "./studio-form-finish.css";

import "./studio-materials-4b.css";

import "./studio-composition-4a.css";

import "./studio-editorial.css";

import "./studio-comparison.css";

import { entityVisualForEntity } from "./entity-visuals";
import { CanvasView, SaveAnalysisAction } from "./canvas";
import { parseSavedAnalyses, SAVED_ANALYSIS_HANDOFF_KEY } from "./saved-analyses";

import { useEffect, useMemo, useRef, useState } from "react";
import { StudioConstellation } from "./studio-constellation";
import { ArrowRight, CircleAlert, LoaderCircle, MapPin, Search } from "lucide-react";
import type { CounterfactualResult, StrategicClaim } from "@/core/counterfactuals/contracts";
import type { DecisionSensitivityResult } from "@/core/sensitivity/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";
import { Button, Card, EmptyState, EvidenceBadge, ErrorState, ProvenanceIndicator, SectionHeading, SelectControl, StatusBadge, TextField, usePresentationView, useStrategicInterpretationPreference } from "./primitives";
import { createCounterfactualRequest, CULTURAL_CONNECTIONS_LABEL, evidenceForMarket, locationForMarket, mapCounterfactualResponse, normalizeResearchTarget, providerExplanationText, RESEARCH_TARGET_OPTIONS, researchScopeForMarket, strategicReferences, targetTypeLabel, type StudioMarket, type StudioScenarioInput } from "./studio-model";
import { buildSensitivityResult, SensitivityPanel, validateSensitivityRequest } from "./sensitivity-panel";

const cx = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(" ");
const cityOptions = ["London", "New York", "Los Angeles", "Paris", "Tokyo", "Lagos"];
const evidenceName = (evidence: CulturalEvidence) => evidence.kind === "affinity" ? (evidence.objectEntityName ?? evidence.objectEntityId) : evidence.id;
const formatScore = (score: number | undefined) => typeof score === "number" ? score.toFixed(2) : "—";

function claimSections(result: CounterfactualResult): Array<{ title: string; claims: StrategicClaim[] }> {
  const interpretation = result.strategicInterpretation;
  if (!interpretation) return [];
  return [
    { title: "Observed change", claims: [...interpretation.scenarioChange, ...interpretation.evidenceBackedObservations] },
    { title: "Possible implications", claims: [...interpretation.potentialStrategicImplications, ...interpretation.culturalPossibilities, ...interpretation.positioningAndLaunchExecution] },
    { title: "Suggestions to validate", claims: [...interpretation.suggestedPositioningAdjustments, ...interpretation.suggestedAudienceConsiderations, ...interpretation.suggestedCulturalTouchpoints, ...interpretation.assumptionsToValidate] },
  ].filter((section) => section.claims.length > 0);
}

function ScenarioForm({ onSubmit, busy, initial }: { onSubmit: (input: StudioScenarioInput) => void; busy: boolean; initial?: StudioScenarioInput }) {
  const { enabled: strategicDefault, setEnabled: setStrategicDefault } = useStrategicInterpretationPreference();
  const strategicTouched = useRef(false);
  const [productConcept, setProductConcept] = useState(initial?.productConcept ?? "");
  const [seedQuery, setSeedQuery] = useState(initial?.seedQuery ?? "");
  const [baselineLocation, setBaselineLocation] = useState(initial?.baselineLocation ?? "London");
  const [alternativeLocation, setAlternativeLocation] = useState(initial?.alternativeLocation ?? "New York");
  const [researchTarget, setResearchTarget] = useState(initial?.researchTarget ?? normalizeResearchTarget(undefined));
  const [includeStrategicInterpretation, setIncludeStrategicInterpretation] = useState(initial?.includeStrategicInterpretation ?? strategicDefault);
  useEffect(() => {
    if (!strategicTouched.current) setIncludeStrategicInterpretation(strategicDefault);
  }, [strategicDefault]);
  return <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); onSubmit({ productConcept, seedQuery, baselineLocation, alternativeLocation, researchTarget, includeStrategicInterpretation }); }}>
    <div className="grid gap-3 min-[1400px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(160px,0.85fr)] max-[1399px]:grid-cols-2 lg:items-end">
      <TextField className="[&>label]:text-[11px] [&>label]:uppercase [&>label]:tracking-[0.12em] [&>input]:min-h-10" required label="Launch concept" placeholder="A coffee brand for creative communities" value={productConcept} onChange={(event) => setProductConcept(event.target.value)} />
      <TextField className="[&>label]:text-[11px] [&>label]:uppercase [&>label]:tracking-[0.12em] [&>input]:min-h-10" required label="Cultural signal" placeholder="Seed brand or entity" value={seedQuery} onChange={(event) => setSeedQuery(event.target.value)} />
      <SelectControl className="[&>label]:text-[11px] [&>label]:uppercase [&>label]:tracking-[0.12em] [&_select]:min-h-10" label="Baseline" value={baselineLocation} onChange={(event) => setBaselineLocation(event.target.value)} options={cityOptions.map((city) => ({ label: city, value: city }))} />
      <SelectControl className="[&>label]:text-[11px] [&>label]:uppercase [&>label]:tracking-[0.12em] [&_select]:min-h-10" label="Alternative" value={alternativeLocation} onChange={(event) => setAlternativeLocation(event.target.value)} options={cityOptions.map((city) => ({ label: city, value: city }))} />
      <Button className="min-h-10 whitespace-nowrap px-4" variant="accent" type="submit" disabled={busy}><Search aria-hidden className="size-4" />{busy ? "Researching…" : "Run analysis"}</Button>
    </div>

    <div className="mosaic-strategic-row flex flex-wrap items-start gap-4">
      <SelectControl className="[&>label]:text-[11px] [&>label]:uppercase [&>label]:tracking-[0.12em] [&_select]:min-h-10" label="Research target" value={researchTarget} onChange={(event) => setResearchTarget(normalizeResearchTarget(event.target.value))} options={RESEARCH_TARGET_OPTIONS.map((option) => ({ label: option.label, value: option.value }))} />
      <label className="mosaic-strategic-control">
        <input
          type="checkbox"
          checked={includeStrategicInterpretation}
          onChange={(event) => {
            strategicTouched.current = true;
            const nextEnabled = event.target.checked;
            setIncludeStrategicInterpretation(nextEnabled);
            setStrategicDefault(nextEnabled);
          }}
        />
        <span className="mosaic-strategic-description">
          <strong>Include strategic interpretation</strong>
          <span className="mosaic-strategic-help">
            {" "}· Gemini suggestions remain clearly labeled for validation.
          </span>
        </span>
      </label>
    </div>
  </form>;
}

function Recommendations({ result, market, selectedEvidenceId, onSelectEvidence }: { result?: CounterfactualResult; market: StudioMarket; selectedEvidenceId?: string; onSelectEvidence: (evidenceId: string) => void }) {
  const evidence = useMemo(() => result ? evidenceForMarket(result, market).filter((item) => item.kind === "affinity").sort((a, b) => (b.providerScore ?? -Infinity) - (a.providerScore ?? -Infinity)).slice(0, 5) : [], [result, market]);
  if (!result) return <Card className="p-6" as="section"><SectionHeading title={CULTURAL_CONNECTIONS_LABEL} description="Validated cultural affinities will appear here after research." /><div className="mt-6"><EmptyState title="No research yet" description="The panel will show provider entities, categories, scores, and geographic context." /></div></Card>;
  const scope = researchScopeForMarket(result, market);
  return <Card className="mosaic-recs-panel p-5" as="section"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--mosaic-cobalt)]">{scope.city}</p><h2 className="mosaic-recs-title mosaic-serif mt-2 text-2xl text-[var(--mosaic-ink)]">{CULTURAL_CONNECTIONS_LABEL}</h2><p className="mt-1 text-xs text-[var(--mosaic-muted)]">{scope.provider} {scope.targetType} affinities for {scope.signal} in {scope.city} · ordered by {scope.ordering} · {evidence.length} shown</p></div><MapPin aria-hidden className="size-5 text-[var(--mosaic-ink)]" /></div><div className="mosaic-recs-list mt-5 divide-y divide-[rgb(120_93_58_/_0.16)]">{evidence.length === 0 ? <EmptyState title="No matching evidence" description="The provider returned no validated affinity evidence for this market." /> : evidence.map((item) => <button type="button" key={item.id} onClick={() => onSelectEvidence(item.id)} aria-label={`Inspect ${item.objectEntityName ?? item.objectEntityId} evidence for ${scope.city}`} className={cx("mosaic-recs-row flex w-full items-start gap-3 py-3.5 text-left first:pt-0 last:pb-0", selectedEvidenceId === item.id && "rounded-lg bg-[var(--mosaic-blue-wash)] px-2")}><span className="mosaic-recs-thumb grid size-11 shrink-0 place-items-center overflow-hidden rounded-[0.7rem] border border-[var(--mosaic-line)] bg-[var(--mosaic-paper-deep)]"><img src={entityVisualForEntity(item.objectEntityCategory, item.provenance.providerId, item.objectEntityId)} alt="" aria-hidden="true" className="size-full object-cover" /></span><span className="min-w-0 flex-1"><span className="mosaic-recs-name block truncate text-sm font-semibold text-[var(--mosaic-ink)]">{item.objectEntityName ?? item.objectEntityId}</span><span className="mt-1 block text-xs capitalize text-[var(--mosaic-muted)]">{item.objectEntityCategory} · {item.provenance.providerId} affinity {formatScore(item.providerScore)}</span><span className="mosaic-recs-meter mt-2 block h-1 overflow-hidden rounded-full bg-[var(--mosaic-paper-deep)]"><span className="block h-full rounded-full bg-[var(--mosaic-cobalt)]" style={{ width: Math.max(4, Math.min(100, (item.providerScore ?? 0) * 100)) + "%" }} /></span></span><span className="sr-only">{scope.city} market. Evidence is available in the inspector.</span><ArrowRight aria-hidden className="mt-1 size-4 shrink-0 text-[var(--mosaic-muted)]" /></button>)}</div><div className="mosaic-recs-context mt-5 rounded-[var(--mosaic-radius-sm)] bg-[var(--mosaic-blue-wash)] p-3.5"><p className="text-sm font-semibold text-[var(--mosaic-ink)]">Evidence context</p><p className="mt-1 text-xs leading-5 text-[var(--mosaic-muted)]">{scope.provider} provider observations for {scope.signal} in {scope.city}, targeting {scope.targetType} entities and ordered by {scope.ordering}. Affinity is not market fit or commercial suitability.</p></div></Card>;
}

function Comparison({ result }: { result: CounterfactualResult }) {
  const comparison = result.comparison;
  const rows = [
    { market: "baseline" as const, color: "var(--mosaic-cobalt)" },
    { market: "alternative" as const, color: "var(--mosaic-vermilion)" },
  ];
  return <section className="mosaic-compare-strip" aria-label="Compare cities">
    <div className="mosaic-compare-intro">
      <div><p className="mosaic-compare-eyebrow">THE COUNTERFACTUAL</p><h2>Two cities. Two cultural maps.</h2></div>
      <p>Independent Qloo observations. Affinity is not a demand or market-fit score.</p>
    </div>
    <div className="mosaic-compare-markets">{rows.map(({ market, color }) => {
      const evidence = evidenceForMarket(result, market).filter((item) => item.kind === "affinity");
      const top = [...evidence].sort((a, b) => (b.providerScore ?? -Infinity) - (a.providerScore ?? -Infinity))[0];
      return <div key={market} className="mosaic-compare-market" style={{ borderTopColor: color }}>
        <div className="mosaic-compare-market-heading"><strong>{locationForMarket(result, market)}</strong><span>{evidence.length} observations</span></div>
        <p className="mosaic-compare-top">Highest observed affinity</p>
        <div className="mosaic-compare-observation"><span title={top ? evidenceName(top) : undefined}>{top ? evidenceName(top) : "No validated evidence"}</span><strong style={{ color }}>{formatScore(top?.providerScore)}</strong></div>
      </div>;
    })}</div>
    <div className="mosaic-compare-footnote">
      <span>{comparison.sharedEntities.length} shared entities</span>
      <span>{comparison.baselineOnlyEntities.length} baseline-only</span>
      <span>{comparison.alternativeOnlyEntities.length} alternative-only</span>
    </div>
    <details className="mosaic-compare-disclosure"><summary>Methodology and limitations</summary><p>These are geographically separate provider result sets. Their differences do not prove demand, commercial suitability, partnerships or causation.</p><ul>{[...new Set(comparison.limitations)].map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></details>
  </section>;
}

function StrategicPanel({ result, onSelectEvidence }: { result: CounterfactualResult; onSelectEvidence: (evidenceId: string) => void }) {
  if (result.strategicInterpretationStatus === "not-requested") return null;
  if (result.strategicInterpretationStatus === "unavailable") return <Card className="mt-8 border-[#d89b8f] bg-[#f9e2dd] p-6" as="section"><div className="flex gap-3 text-[#79291e]"><CircleAlert aria-hidden className="mt-1 size-5 shrink-0" /><div><h2 className="mosaic-serif text-2xl">Strategic interpretation unavailable</h2><p className="mt-2 text-sm leading-6">{result.strategicInterpretationError?.message ?? "The validated comparison is still available; no strategic conclusion was generated."}</p></div></div></Card>;
  return <Card className="mt-8 p-6 sm:p-8" as="section"><SectionHeading eyebrow="Optional interpretation" title="What the comparison may suggest" description="Gemini-generated interpretation is kept separate from provider observations and remains subject to validation." /><div className="mt-7 grid gap-6 lg:grid-cols-3">{claimSections(result).map((section) => <div key={section.title}><h3 className="text-sm font-semibold text-[var(--mosaic-ink)]">{section.title}</h3><div className="mt-3 grid gap-3">{section.claims.map((claim, index) => <div key={claim.text + index} className="rounded-[var(--mosaic-radius-sm)] border border-[rgb(120_93_58_/_0.16)] bg-[rgb(251_248_241_/_0.56)] p-3"><EvidenceBadge classification={claim.classification} /><p className="mt-2 text-sm leading-5 text-[var(--mosaic-ink)]">{claim.text}</p><div className="mt-2 flex flex-wrap gap-2">{claim.evidenceIds.map((id) => <button type="button" key={id} onClick={() => onSelectEvidence(id)} className="font-mono text-[10px] text-[var(--mosaic-cobalt)] underline">{id}</button>)}</div></div>)}</div></div>)}</div>{(result.strategicInterpretation?.uncertaintiesAndLimitations.length || result.strategicInterpretation?.caveats.length || strategicReferences(result).length) ? <div className="mt-7 grid gap-5 border-t border-[rgb(120_93_58_/_0.16)] pt-5 sm:grid-cols-2"><div><h3 className="text-sm font-semibold">Uncertainties and limitations</h3><ul className="mt-2 grid gap-1 text-xs leading-5 text-[var(--mosaic-muted)]">{[...(result.strategicInterpretation?.uncertaintiesAndLimitations ?? []), ...(result.strategicInterpretation?.caveats ?? [])].map((item) => <li key={item}>• {item}</li>)}</ul></div><div><h3 className="text-sm font-semibold">Supporting evidence</h3><div className="mt-2 flex flex-wrap gap-2">{strategicReferences(result).map((reference) => <button type="button" key={reference.market + reference.evidenceId} onClick={() => onSelectEvidence(reference.evidenceId)} className="rounded-full bg-[var(--mosaic-blue-wash)] px-2.5 py-1 font-mono text-[10px] text-[var(--mosaic-cobalt)]">{reference.market}: {reference.evidenceId}</button>)}</div></div></div> : null}</Card>;
}

function ResearchStatus({ result }: { result: CounterfactualResult }) {
  const tone = result.status === "completed" ? "positive" : result.status === "partial" ? "attention" : "alert";
  const label = result.status === "completed" ? "Research complete" : result.status === "partial" ? "Partial research" : "Research failed";
  return <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-[var(--mosaic-radius-sm)] border border-[var(--mosaic-line)] bg-[rgb(251_248_241_/_0.58)] px-4 py-3" role="status"><div className="flex items-center gap-3"><StatusBadge label={label} tone={tone} /><p className="text-xs text-[var(--mosaic-muted)]">{result.comparison.baselineEvidenceCount} baseline observations · {result.comparison.alternativeEvidenceCount} alternative observations</p></div>{result.errors.length > 0 && <p className="max-w-2xl text-xs leading-5 text-[var(--mosaic-muted)]">{result.errors.map((error) => error.message).join(" ")}</p>}</div>;
}

export function StudioWorkspace() {
  const { view } = usePresentationView();
  const [result, setResult] = useState<CounterfactualResult>();
  const [market, setMarket] = useState<StudioMarket>("baseline");
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string>();
  const [selectedEvidenceSource, setSelectedEvidenceSource] = useState<"original" | "variant">("original");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [lastRequest, setLastRequest] = useState<StudioScenarioInput>();
  const [savedResearchAt, setSavedResearchAt] = useState<string>();
  const [sensitivity, setSensitivity] = useState<DecisionSensitivityResult>();
  const [experimentBusy, setExperimentBusy] = useState(false);
  const [experimentError, setExperimentError] = useState<string>();
  const experimentController = useRef<AbortController | undefined>(undefined);
  const experimentRun = useRef(0);
  const selectedEvidence = result && selectedEvidenceId ? (selectedEvidenceSource === "variant" && sensitivity ? [...evidenceForMarket(sensitivity.variantResult, "baseline"), ...evidenceForMarket(sensitivity.variantResult, "alternative")] : [...evidenceForMarket(result, "baseline"), ...evidenceForMarket(result, "alternative")]).find((item) => item.id === selectedEvidenceId) : undefined;
  useEffect(() => {
    let raw: string | null = null;
    try { raw = window.sessionStorage.getItem(SAVED_ANALYSIS_HANDOFF_KEY); } catch { return; }
    if (!raw) return;
    try { window.sessionStorage.removeItem(SAVED_ANALYSIS_HANDOFF_KEY); } catch { /* The handoff is still consumed in memory below. */ }
    const entry = parseSavedAnalyses(raw)[0];
    if (!entry) return;
    queueMicrotask(() => {
      setResult(entry.result);
      setLastRequest(entry.request);
      setSelectedEvidenceId(undefined);
      setSelectedEvidenceSource("original");
      setMarket("baseline");
      setError(undefined);
      setBusy(false);
      setSavedResearchAt(entry.createdAt);
      setSensitivity(undefined);
      setExperimentError(undefined);
      setExperimentBusy(false);
    });
  }, []);
  function selectOriginalEvidence(id: string) { setSelectedEvidenceSource("original"); setSelectedEvidenceId(id); }
  function selectSensitivityEvidence(id: string, source: "original" | "variant") { setSelectedEvidenceSource(source); setSelectedEvidenceId(id); }
  async function submit(input: StudioScenarioInput) {
    experimentRun.current += 1;
    experimentController.current?.abort();
    setSensitivity(undefined); setExperimentError(undefined); setExperimentBusy(false);
    setBusy(true); setError(undefined); setLastRequest(input); setSelectedEvidenceId(undefined); setSelectedEvidenceSource("original"); setSavedResearchAt(undefined);
    try {
      const response = await fetch("/api/counterfactual", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(createCounterfactualRequest(input)) });
      const payload: unknown = await response.json();
      const mapped = mapCounterfactualResponse(payload);
      if (!mapped) throw new Error(typeof payload === "object" && payload && "error" in payload ? String((payload as { error?: { message?: string } }).error?.message ?? "Counterfactual request failed") : "Counterfactual response was invalid");
      setResult(mapped);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Counterfactual request failed"); }
    finally { setBusy(false); }
  }
  async function runExperiment(alternativeSignal: string) {
    if (!result || !lastRequest) return;
    const checked = validateSensitivityRequest(lastRequest, result, alternativeSignal);
    if (!checked.ok) { setExperimentError(checked.message); return; }
    const run = experimentRun.current + 1;
    experimentRun.current = run;
    experimentController.current?.abort();
    const controller = new AbortController();
    experimentController.current = controller;
    setExperimentBusy(true); setExperimentError(undefined); setSensitivity(undefined); setSelectedEvidenceId(undefined); setSelectedEvidenceSource("original");
    try {
      const response = await fetch("/api/counterfactual", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(checked.request), signal: controller.signal });
      const payload: unknown = await response.json();
      if (run !== experimentRun.current) return;
      const variant = mapCounterfactualResponse(payload);
      if (!variant) throw new Error("The variant response was malformed.");
      setSensitivity(buildSensitivityResult(lastRequest, result, variant, checked.signal));
    } catch (cause) {
      if (controller.signal.aborted || run !== experimentRun.current) return;
      setExperimentError(cause instanceof Error ? cause.message : "The sensitivity experiment failed.");
    } finally {
      if (run === experimentRun.current) { setExperimentBusy(false); experimentController.current = undefined; }
    }
  }
  if (view === "canvas") return <CanvasView result={result} busy={busy} error={error} lastRequest={lastRequest} selectedEvidenceId={selectedEvidenceId} selectedEvidenceSource={selectedEvidenceSource} onSubmit={submit} onSelectEvidence={selectOriginalEvidence} savedResearchAt={savedResearchAt} sensitivity={sensitivity} experimentBusy={experimentBusy} experimentError={experimentError} onRunExperiment={runExperiment} onInspectSensitivityEvidence={selectSensitivityEvidence} />;
  return <><div className="mosaic-studio-page mosaic-studio-v2 mosaic-studio-stable">
    <div className="mosaic-studio-heading">
      <div><p className="mosaic-studio-eyebrow">Cultural counterfactual</p><h1>Same signal.<br />Different worlds.</h1><p>See how your cultural signal connects to different experiences in different cities.</p></div>
      <div className="mosaic-signal-identity"><span className="mosaic-identity-icon" aria-hidden="true">✳</span><div><small>Your signal</small><strong>{lastRequest?.seedQuery || "Choose a signal"}</strong><span>{lastRequest?.productConcept || "Discover cultural connections"}</span></div></div>
    </div>
    <div id="scenario-workspace" className="mosaic-studio-edit" aria-label="Scenario workspace">
      {result ? <details><summary>↗ New analysis or edit scenario <span>{lastRequest?.baselineLocation} · {lastRequest?.alternativeLocation}</span></summary><div className="mosaic-studio-edit-form"><ScenarioForm onSubmit={submit} busy={busy} initial={lastRequest} /></div></details> : <ScenarioForm onSubmit={submit} busy={busy} />}
    </div>
    {error && <div className="mt-3"><ErrorState description={error} /></div>}
    {busy && <div className="mosaic-studio-loading" aria-live="polite"><LoaderCircle aria-hidden className="size-4 animate-spin" />Researching both markets and validating evidence…</div>}
    {result && <div className="mosaic-studio-status"><ResearchStatus result={result} /></div>}
    {savedResearchAt && <div className="mt-4 rounded-[var(--mosaic-radius-sm)] border border-[var(--mosaic-line)] bg-[var(--mosaic-blue-wash)] px-4 py-3 text-sm text-[var(--mosaic-ink)]" role="status"><strong>Saved research</strong><span className="ml-2 text-xs text-[var(--mosaic-muted)]">Original research saved {new Date(savedResearchAt).toLocaleString()}</span></div>}
    <SensitivityPanel key={lastRequest ? `${lastRequest.seedQuery}:${lastRequest.productConcept}:${lastRequest.baselineLocation}:${lastRequest.alternativeLocation}:${lastRequest.researchTarget ?? "urn:entity:place"}` : "empty"} originalRequest={lastRequest} originalResult={result} sensitivity={sensitivity} busy={experimentBusy} error={experimentError} historical={Boolean(savedResearchAt)} onRun={runExperiment} onInspectEvidence={selectSensitivityEvidence} />
    {result && lastRequest && <SaveAnalysisAction request={lastRequest} result={result} />}
    {lastRequest && result?.status === "failed" && <ErrorState title="Research could not complete" description={result.errors.map((item) => item.message).join(" ") || "No validated comparison was returned."} />}
    <div id="insights-workspace" className="mosaic-studio-main-grid" aria-label="Research insights">
      <div className="mosaic-studio-main-column">
        <StudioConstellation result={result} market={market} onMarketChange={setMarket} selectedEvidenceId={selectedEvidenceId} onSelectEvidence={selectOriginalEvidence} />
        {result && <Comparison result={result} />}
      </div>
      <div className="mosaic-studio-right-column">
        {result && <div className="mosaic-market-summary" aria-label="Compared markets">
          {(["baseline", "alternative"] as const).map((side) => <button key={side} type="button" onClick={() => setMarket(side)} aria-pressed={market === side} className={cx("mosaic-market-tile", side === "baseline" ? "mosaic-market-london" : "mosaic-market-newyork", market === side && "mosaic-market-active")}><MapPin aria-hidden="true" className="size-4" /><span><strong>{locationForMarket(result, side)}</strong><small>{evidenceForMarket(result, side).length} observed connections</small></span></button>)}
        </div>}
        <Recommendations result={result} market={market} selectedEvidenceId={selectedEvidenceId} onSelectEvidence={selectOriginalEvidence} />
      </div>
    </div>
    {selectedEvidence && <Card className="mt-7 p-5" as="section"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--mosaic-cobalt)]">Selected evidence</p><h2 className="mosaic-serif mt-2 text-2xl">{evidenceName(selectedEvidence)}</h2></div><ProvenanceIndicator provider={selectedEvidence.provenance.providerId} detail={selectedEvidence.provenance.sourceReference} /></div><div className="mt-4 grid gap-3 text-xs text-[var(--mosaic-muted)] sm:grid-cols-4"><p><span className="font-semibold text-[var(--mosaic-ink)]">Category</span><br />{selectedEvidence.kind === "affinity" ? selectedEvidence.objectEntityCategory : "—"}</p><p><span className="font-semibold text-[var(--mosaic-ink)]">Provider score</span><br />{selectedEvidence.kind === "affinity" ? formatScore(selectedEvidence.providerScore) : "—"}</p><p><span className="font-semibold text-[var(--mosaic-ink)]">Geographic context</span><br />{selectedEvidence.geographicContext?.city ?? "Query context retained"}</p><p><span className="font-semibold text-[var(--mosaic-ink)]">Target type</span><br />{selectedEvidence.kind === "affinity" ? targetTypeLabel(selectedEvidence.queryParameters["filter.type"]) : "—"}</p></div>{selectedEvidence.kind === "affinity" && <div className="mt-4 rounded-[var(--mosaic-radius-sm)] bg-[var(--mosaic-blue-wash)] p-3.5"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--mosaic-cobalt)]">Qloo-provided explanation</p><p className="mt-1 text-sm leading-5 text-[var(--mosaic-ink)]">{providerExplanationText(selectedEvidence.explainability) ?? "Detailed provider explanation unavailable."}</p></div>}</Card>}
    {result && <StrategicPanel result={result} onSelectEvidence={selectOriginalEvidence} />}
  </div></>;
}
