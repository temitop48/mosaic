"use client";

import { useMemo } from "react";
import { ArrowRight, Check, MapPin, Scale, Sparkles } from "lucide-react";
import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import type { CulturalEvidence } from "@/core/evidence/types";
import { entityVisualForEntity } from "./entity-visuals";
import { CULTURAL_CONNECTIONS_LABEL, evidenceForMarket, locationForMarket, observedTargetComparison, providerExplanationText, researchScopeForMarket, studioGraphForDisplay, buildStudioGraph, type StudioMarket } from "./studio-model";

const cx = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(" ");
const score = (value: number | undefined) => typeof value === "number" ? value.toFixed(2) : "—";
const evidenceName = (item: CulturalEvidence) => item.kind === "affinity" ? (item.objectEntityName ?? item.objectEntityId) : item.id;

const nodePositions = [
  { left: "16%", top: "16%", tone: "cobalt", color: "#2d79c7" },
  { left: "69%", top: "15%", tone: "ochre", color: "#e0a315" },
  { left: "82%", top: "47%", tone: "forest", color: "#4a9666" },
  { left: "68%", top: "77%", tone: "vermilion", color: "#df4c2e" },
  { left: "18%", top: "78%", tone: "pink", color: "#db718b" },
  { left: "6%", top: "48%", tone: "lilac", color: "#8465b7" },
] as const;

function categoryLabel(category: string) {
  return category.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function CanvasCityComposition({ result, baselineCity, alternativeCity }: { result?: CounterfactualResult; baselineCity?: string; alternativeCity?: string }) {
  const cities = result ? [locationForMarket(result, "baseline"), locationForMarket(result, "alternative")] : [baselineCity ?? "London", alternativeCity ?? "New York"];
  return <div className="canvas-city-composition" aria-label="Compared cities">
    <div className="canvas-city-card canvas-city-card-baseline">
      <span className="canvas-city-label">Baseline</span>
      <strong>{cities[0]}</strong>
      <img src="/design-assets/category-icons/location-paper-2.svg" alt="" aria-hidden="true" />
      <span className="canvas-city-note">the signal as it is</span>
    </div>
    <div className="canvas-city-card canvas-city-card-alternative">
      <span className="canvas-city-label">Counterfactual</span>
      <strong>{cities[1]}</strong>
      <img src="/design-assets/category-icons/location-paper-6.svg" alt="" aria-hidden="true" />
      <span className="canvas-city-note">a different cultural map</span>
    </div>
    <div className="canvas-city-arrow" aria-hidden="true">↘</div>
  </div>;
}

export function CanvasConstellation({ result, market, selectedEvidenceId, onSelectEvidence, onMarketChange }: {
  result?: CounterfactualResult;
  market: StudioMarket;
  selectedEvidenceId?: string;
  onSelectEvidence: (evidenceId: string) => void;
  onMarketChange?: (market: StudioMarket) => void;
}) {
  const graph = useMemo(() => result ? buildStudioGraph(result, market) : undefined, [result, market]);
  const visible = useMemo(() => graph ? studioGraphForDisplay(graph) : undefined, [graph]);
  const nodes = visible?.nodes.filter((node) => !node.isSignal).slice(0, 6) ?? [];
  const signal = visible?.nodes.find((node) => node.isSignal);
  const edges = graph?.edges ?? [];
  const edgeByTarget = new Map(edges.map((edge) => [edge.target, edge]));
  const marketName = result ? locationForMarket(result, market) : "your selected market";
  const total = graph ? graph.nodes.length - (signal ? 1 : 0) : 0;

  return <section className="canvas-constellation paper-panel" aria-labelledby="canvas-constellation-title">
    <div className="canvas-section-topline">
      <div>
        <p className="canvas-kicker">Cultural signal</p>
        <h2 id="canvas-constellation-title">What gathers around it</h2>
      </div>
      <span className="canvas-constellation-count">{nodes.length} of {total || 0} observations</span>
    </div>
    {nodes.length > 0 && <div className="canvas-category-legend" aria-label="Observed entity categories">{[...new Set(nodes.map((node) => node.category))].map((category, index) => <span key={category}><i className={`legend-dot legend-dot-${index % 6}`} aria-hidden="true" />{categoryLabel(category)}</span>)}</div>}
    <div className="canvas-market-tabs" role="tablist" aria-label="Constellation market">
      {(["baseline", "alternative"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={market === item} className={cx(market === item && "is-active")} onClick={() => onMarketChange?.(item)}>
        <MapPin aria-hidden="true" />{result ? locationForMarket(result, item) : item === "baseline" ? "Baseline" : "Alternative"}
      </button>)}
    </div>
    {!result || !signal ? <div className="canvas-empty-map"><Sparkles aria-hidden="true" /><p>Run a scenario to reveal the cultural connections.</p></div> : <div className="canvas-graph-stage" aria-label={`Six cultural connections for ${signal.label} in ${marketName}`}>
      <svg className="canvas-graph-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {nodes.map((node, index) => { const point = nodePositions[index]!; const x = parseInt(point.left, 10) + 5; const y = parseInt(point.top, 10) + 7; return <g key={node.id}><line x1="50" y1="51" x2={x} y2={y} stroke={point.color} /><circle cx={x} cy={y} r="1.25" fill={point.color} /></g>; })}
      </svg>
      <div className="canvas-graph-signal">
        <div className="canvas-signal-art"><img src={entityVisualForEntity(signal.category, signal.providerId, signal.entityId)} alt="" aria-hidden="true" /></div>
        <strong>{signal.label}</strong><span>{signal.category}</span>
      </div>
      {nodes.map((node, index) => { const point = nodePositions[index]!; const edge = edgeByTarget.get(node.id); const evidenceId = node.evidenceIds[0]; const selected = Boolean(selectedEvidenceId && node.evidenceIds.includes(selectedEvidenceId)); return <button key={node.id} type="button" className={cx("canvas-graph-node", `tone-${point.tone}`, selected && "is-selected")} style={{ left: point.left, top: point.top }} onClick={() => evidenceId && onSelectEvidence(evidenceId)} aria-label={`Inspect ${node.label}, ${node.category}, Qloo affinity ${score(edge?.providerScore)}`}>
          <span className="canvas-node-art"><img src={entityVisualForEntity(node.category, node.providerId, node.entityId)} alt="" aria-hidden="true" /></span><span className="canvas-node-copy"><strong>{node.label}</strong><small>{node.category}</small><em>{score(edge?.providerScore)}</em></span>
        </button>; })}
    </div>}
    {graph && total > 6 && <details className="canvas-all-observations"><summary>Retain access to all {total} observations <span>⌄</span></summary><div>{graph.nodes.filter((node) => !node.isSignal).slice(6).map((node) => <button type="button" key={node.id} onClick={() => node.evidenceIds[0] && onSelectEvidence(node.evidenceIds[0])}>{node.label}<span>{score(edgeByTarget.get(node.id)?.providerScore)} ↗</span></button>)}</div></details>}
  </section>;
}

export function CanvasRecommendations({ result, market, selectedEvidenceId, onSelectEvidence, onMarketChange }: {
  result?: CounterfactualResult;
  market: StudioMarket;
  selectedEvidenceId?: string;
  onSelectEvidence: (evidenceId: string) => void;
  onMarketChange?: (market: StudioMarket) => void;
}) {
  const recommendationsFor = (target: StudioMarket) => result ? evidenceForMarket(result, target).filter((item): item is Extract<CulturalEvidence, { kind: "affinity" }> => item.kind === "affinity").sort((a, b) => (b.providerScore ?? -Infinity) - (a.providerScore ?? -Infinity)).slice(0, 5) : [];
  const groups: Array<{ market: StudioMarket; title: string }> = [{ market: "baseline", title: result ? locationForMarket(result, "baseline") : "London" }, { market: "alternative", title: result ? locationForMarket(result, "alternative") : "New York" }];
  return <section className="canvas-recommendations paper-panel" aria-labelledby="canvas-recommendations-title">
    <div className="canvas-section-topline"><div><p className="canvas-kicker">Provider observations</p><h2 id="canvas-recommendations-title">{CULTURAL_CONNECTIONS_LABEL}</h2></div><span className="canvas-rail-mark" aria-hidden="true">✳</span></div>
    {!result ? <p className="canvas-muted-copy">Validated cultural affinities will appear here after the first analysis.</p> : <div className="canvas-recommendation-groups">{groups.map(({ market: groupMarket, title }) => { const recommendations = recommendationsFor(groupMarket); const scope = researchScopeForMarket(result, groupMarket); return <section key={groupMarket} className={cx("canvas-recommendation-group", market === groupMarket && "is-focused")} aria-labelledby={`recommendations-${groupMarket}`}>
      <div className="canvas-recommendation-group-heading"><button type="button" onClick={() => onMarketChange?.(groupMarket)} aria-pressed={market === groupMarket}><i className={`market-dot market-dot-${groupMarket}`} aria-hidden="true" /><strong id={`recommendations-${groupMarket}`}>{title}</strong></button><button type="button" className="canvas-details-link" onClick={() => onMarketChange?.(groupMarket)}>See details <ArrowRight aria-hidden="true" /></button></div>
      <p className="canvas-muted-copy">{scope.provider} {scope.targetType} affinities for {scope.signal} in {scope.city} · ordered by {scope.ordering}</p>
      {recommendations.length === 0 ? <p className="canvas-muted-copy">No validated affinity evidence.</p> : <div className="canvas-recommendation-list">{recommendations.map((item) => <button type="button" key={item.id} className={cx("canvas-recommendation", selectedEvidenceId === item.id && "is-selected")} onClick={() => onSelectEvidence(item.id)} aria-label={`Inspect ${item.objectEntityName ?? item.objectEntityId} evidence for ${title}`}>
        <span className="canvas-recommendation-art"><img src={entityVisualForEntity(item.objectEntityCategory, item.provenance.providerId, item.objectEntityId)} alt="" aria-hidden="true" /></span><span className="canvas-recommendation-copy"><strong>{item.objectEntityName ?? item.objectEntityId}</strong><small>{categoryLabel(item.objectEntityCategory)} · {item.provenance.providerId}</small></span><span className="canvas-recommendation-score">{score(item.providerScore)}</span>
      </button>)}</div>}
    </section>; })}</div>}
    <p className="canvas-provider-note"><Check aria-hidden="true" /> Affinity is provider-native evidence, not market-fit.</p>
  </section>;
}

export function CanvasEvidenceInspector({ evidence, result }: { evidence?: CulturalEvidence; result?: CounterfactualResult }) {
  if (!evidence) return null;
  return <aside className="canvas-evidence-inspector" aria-live="polite"><div><p className="canvas-kicker">Selected evidence</p><h2>{evidenceName(evidence)}</h2></div><span className="canvas-inspector-provider">{evidence.provenance.providerId}</span><dl><div><dt>Category</dt><dd>{evidence.kind === "affinity" ? evidence.objectEntityCategory : "—"}</dd></div><div><dt>Affinity</dt><dd>{evidence.kind === "affinity" ? score(evidence.providerScore) : "—"}</dd></div><div><dt>Market</dt><dd>{evidence.geographicContext?.city ?? (result ? "Compared market" : "Query context")}</dd></div><div><dt>Target type</dt><dd>{evidence.kind === "affinity" ? evidence.queryParameters["filter.type"] ?? "Unavailable" : "—"}</dd></div></dl>{evidence.kind === "affinity" && <div className="mt-3"><p className="canvas-kicker">Qloo-provided explanation</p><p>{providerExplanationText(evidence.explainability) ?? "Detailed provider explanation unavailable."}</p></div>}</aside>;
}

export function CanvasComparisonCard({ result }: { result?: CounterfactualResult }) {
  const baselineTop = result ? evidenceForMarket(result, "baseline").filter((item): item is Extract<CulturalEvidence, { kind: "affinity" }> => item.kind === "affinity").sort((a, b) => (b.providerScore ?? -Infinity) - (a.providerScore ?? -Infinity))[0] : undefined;
  const alternativeTop = result ? evidenceForMarket(result, "alternative").filter((item): item is Extract<CulturalEvidence, { kind: "affinity" }> => item.kind === "affinity").sort((a, b) => (b.providerScore ?? -Infinity) - (a.providerScore ?? -Infinity))[0] : undefined;
  const verified = Boolean(baselineTop?.providerScore !== undefined || alternativeTop?.providerScore !== undefined);
  const interpretation = result?.strategicInterpretationStatus === "available" ? result.strategicInterpretation?.evidenceBackedObservations?.[0] : undefined;
  const observedTargets = result ? observedTargetComparison(result) : undefined;
  return <section className="canvas-counterfactual-note" aria-labelledby="canvas-comparison-title">
    <div className="canvas-note-pin" aria-hidden="true">✳</div><Scale aria-hidden="true" className="canvas-note-icon" /><div><p className="canvas-kicker">Evidence-backed comparison</p><h2 id="canvas-comparison-title">Counterfactual Insight</h2>
      {!result ? <p>Run an analysis to compare observed provider affinities across the two cities.</p> : verified ? <><p>The strongest observed provider affinity is {baselineTop?.providerScore !== undefined ? `${score(baselineTop.providerScore)} in ${locationForMarket(result, "baseline")}` : "not available"} and {alternativeTop?.providerScore !== undefined ? `${score(alternativeTop.providerScore)} in ${locationForMarket(result, "alternative")}` : "not available"}.</p><div className="canvas-comparison-bars" aria-label="Provider-native affinity comparison">{[{ market: "baseline" as const, item: baselineTop, color: "#2d79c7" }, { market: "alternative" as const, item: alternativeTop, color: "#df7184" }].map(({ market: comparisonMarket, item, color }) => <div key={comparisonMarket} className="canvas-comparison-bar-group"><span>{locationForMarket(result, comparisonMarket)}</span><div className="canvas-comparison-bar-track"><i style={{ width: `${Math.max(3, Math.min(100, (item?.providerScore ?? 0) * 100))}%`, backgroundColor: color }} /></div><strong>{score(item?.providerScore)}</strong></div>)}</div>{observedTargets?.available && <p className="canvas-note-limit">{observedTargets.sharedCount} shared observed targets · {observedTargets.baselineOnlyCount} baseline-only · {observedTargets.alternativeOnlyCount} alternative-only. The shared entity count also includes the cultural signal.</p>}{observedTargets?.exactObservedEquality && <p className="canvas-note-limit">No observed differentiation in the returned results for these market queries. The same target entities, ordering and provider affinity values were observed. This does not establish that the markets have identical cultural landscapes.</p>}<p className="canvas-note-limit">Observed affinity only. This does not indicate demand, commercial suitability, or launch success.</p>{interpretation && <div className="canvas-note-interpretation"><span>Optional Gemini interpretation</span><p>{interpretation.text}</p></div>}<span className="canvas-handwritten-note">same signal,<br />different context ↗</span></> : <p>No provider affinity values are available for a comparative visual yet. Differences between geographic result sets do not prove demand or commercial suitability.</p>}
    </div>
  </section>;
}
