"use client";

import { entityVisualForEntity } from "./entity-visuals";

import { useMemo, useState } from "react";
import type { CounterfactualResult } from "@/core/counterfactuals/contracts";
import { buildStudioGraph, locationForMarket, studioGraphForDisplay, type StudioMarket } from "./studio-model";
import { EmptyState } from "./primitives";

const positions = [
  { x: 258, y: 105 }, { x: 627, y: 105 }, { x: 785, y: 295 },
  { x: 627, y: 480 }, { x: 258, y: 480 }, { x: 105, y: 295 },
];
const center = { x: 445, y: 290 };
const colors = ["#d3a852", "#8bafe0", "#a3c3ab", "#edbb77", "#e8a3aa", "#a99ed1"];

export function StudioConstellation({ result, market, onMarketChange, onSelectEvidence, selectedEvidenceId }: {
  result?: CounterfactualResult;
  market: StudioMarket;
  onMarketChange: (market: StudioMarket) => void;
  onSelectEvidence: (id: string) => void;
  selectedEvidenceId?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const graph = useMemo(() => result ? buildStudioGraph(result, market) : undefined, [result, market]);
  const visible = useMemo(() => graph ? studioGraphForDisplay(graph) : undefined, [graph]);
  const nodes = visible?.nodes.filter((node) => !node.isSignal).slice(0, 6) ?? [];
  const additional = graph?.nodes.filter((node) => !node.isSignal).slice(6) ?? [];
  const evidenceByTarget = new Map((graph?.edges ?? []).map((edge) => [edge.target, edge]));
  const signal = visible?.nodes.find((node) => node.isSignal);
  const marketName = result ? locationForMarket(result, market) : "London";
  return <section className="mosaic-reference-graph" aria-label="Cultural signal connections">
    <div className="mosaic-reference-graph-head">
      <label className="mosaic-city-select"><span aria-hidden="true">⌖</span> <span className="sr-only">Visible market</span><select value={market} onChange={(event) => { onMarketChange(event.target.value as StudioMarket); setShowAll(false); }} aria-label="Choose graph market"><option value="baseline">{result ? locationForMarket(result, "baseline") : "London"}</option><option value="alternative">{result ? locationForMarket(result, "alternative") : "New York"}</option></select></label>
      <div className="mosaic-graph-heading"><strong>Cultural connections</strong><small>{nodes.length} visible · {marketName} · Qloo evidence</small></div>
      {additional.length > 0 && <button className="mosaic-text-link" type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show less" : `View all ${graph!.nodes.length - 1} connections`} ↗</button>}
    </div>
    {!result || !signal ? <div className="mosaic-constellation-empty"><EmptyState title="Your cultural map starts here" description="Enter a cultural signal and run an analysis to discover validated connections across cities." /></div> : <div className="mosaic-constellation-stage">
      <svg className="mosaic-constellation-svg" viewBox="0 0 900 590" role="group" aria-label={`Cultural connections for ${signal.label} in ${marketName}`}>
        <defs><filter id="mosaic-soft-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#504028" floodOpacity="0.12" /></filter></defs>
        {nodes.map((node, index) => { const point = positions[index]!; const edge = evidenceByTarget.get(node.id); const midX = (point.x + center.x) / 2; const midY = (point.y + center.y) / 2; const bend = index % 2 === 0 ? -13 : 13; return <path key={`edge-${node.id}`} d={`M ${center.x} ${center.y} Q ${midX + bend} ${midY - bend} ${point.x} ${point.y}`} fill="none" stroke="#9babb0" strokeWidth="1.5" opacity="0.82"><title>{edge ? `Validated Qloo affinity ${edge.providerScore?.toFixed(2) ?? ""}` : "Validated cultural connection"}</title></path>; })}
        <circle cx={center.x} cy={center.y} r="62" fill="#dfe9db" opacity="0.75" /><circle cx={center.x} cy={center.y} r="54" fill="#fffaf1" stroke="#30624b" strokeWidth="2" />
        <image href={entityVisualForEntity(signal.category, signal.providerId, signal.entityId)} x={center.x - 47} y={center.y - 47} width="94" height="94" preserveAspectRatio="xMidYMid slice" clipPath="inset(0 round 50%)" />
        <text x={center.x} y={center.y + 82} fontSize="18" textAnchor="middle" fontWeight="700" fill="#16171b">{signal.label.length > 21 ? `${signal.label.slice(0, 20)}…` : signal.label}</text>
        <text x={center.x} y={center.y + 104} textAnchor="middle" fontSize="13" fill="#6e6a64">Cultural signal</text>
        {nodes.map((node, index) => { const p = positions[index]!; const edge = evidenceByTarget.get(node.id); const selected = Boolean(selectedEvidenceId && node.evidenceIds.includes(selectedEvidenceId)); return <g key={node.id} role="button" tabIndex={0} aria-label={`Inspect ${node.label}, Qloo ${edge?.providerScore?.toFixed(2) ?? ""}`} onClick={() => node.evidenceIds[0] && onSelectEvidence(node.evidenceIds[0])} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && node.evidenceIds[0]) { event.preventDefault(); onSelectEvidence(node.evidenceIds[0]); } }} className="mosaic-constellation-node" style={{ cursor: "pointer", outline: "none" }}>
          <circle cx={p.x + 5} cy={p.y + 5} r="55" fill={colors[index]} opacity="0.52" /><circle cx={p.x} cy={p.y} r="52" fill="#fffaf1" stroke={selected ? "#125bc0" : "#ede5da"} strokeWidth={selected ? "5" : "3"} filter="url(#mosaic-soft-shadow)" />
          <image href={entityVisualForEntity(node.category, node.providerId, node.entityId)} x={p.x - 47} y={p.y - 47} width="94" height="94" clipPath="inset(0 round 50%)" preserveAspectRatio="xMidYMid slice" />
          <text x={p.x} y={p.y + 73} textAnchor="middle" fontSize="14" fontWeight="700" fill="#16171b">{node.label.length > 24 ? `${node.label.slice(0, 23)}…` : node.label}</text>
          <text x={p.x} y={p.y + 92} textAnchor="middle" fontSize="12" fill="#6e6a64">{node.category}</text>
          {edge?.providerScore !== undefined && <g><rect x={p.x - 25} y={p.y + 104} width="50" height="22" rx="11" fill={colors[index]} opacity="0.65" /><text x={p.x} y={p.y + 119} textAnchor="middle" fontSize="13" fontWeight="700" fill="#1b2322">{edge.providerScore.toFixed(2)}</text></g>}
          <circle cx={p.x + 60} cy={p.y - 4} r="5" fill={colors[index]} />
          <title>{node.label}. Select for supporting evidence.</title>
        </g>; })}
      </svg>
      <div className="mosaic-graph-decor mosaic-graph-decor-blue" aria-hidden="true" /><div className="mosaic-graph-decor mosaic-graph-decor-red" aria-hidden="true" />
    </div>}
    {showAll && additional.length > 0 && <div className="mosaic-more-evidence"><strong>Additional validated connections</strong><div>{additional.map((node) => { const edge = evidenceByTarget.get(node.id); return <button key={node.id} type="button" onClick={() => node.evidenceIds[0] && onSelectEvidence(node.evidenceIds[0])}>{node.label}<span>{edge?.providerScore?.toFixed(2) ?? "View evidence"} ↗</span></button>; })}</div></div>}
  </section>;
}
