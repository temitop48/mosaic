import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = (file: string) => readFileSync(resolve(process.cwd(), "src/components/mosaic", file), "utf8");

test("Studio presents the Decision Brief before the sensitivity experiment", () => {
  const studio = source("studio.tsx");
  assert.ok(studio.indexOf("<DecisionBrief") < studio.indexOf("<SensitivityPanel"));
});

test("Canvas presents the compact brief and evidence workspace before sensitivity", () => {
  const canvas = source("canvas.tsx");
  assert.ok(canvas.indexOf("<DecisionBrief") < canvas.indexOf("<main id=\"insights-workspace\""));
  assert.ok(canvas.indexOf("<main id=\"insights-workspace\"") < canvas.indexOf("<SensitivityPanel"));
  assert.match(canvas, /canvas-page \$\{result \? \"canvas-page-complete\"/);
});

test("Research Assistant control is compact, opt-in, and explicitly labelled", () => {
  const brief = source("decision-brief.tsx");
  assert.match(brief, /id="agent-research-enabled"/);
  assert.match(brief, /Optional · Off by default/);
  assert.match(brief, /Authorize one additional dimension/);
  assert.match(brief, /aria-describedby="agent-research-help"/);
});

test("Canvas configuration keeps inputs, options, and submission in ordered rows", () => {
  const canvas = source("canvas.tsx");
  assert.ok(canvas.indexOf("canvas-form-row-signals") < canvas.indexOf("canvas-form-row-markets"));
  assert.ok(canvas.indexOf("canvas-form-row-markets") < canvas.indexOf("canvas-form-row-options"));
  assert.ok(canvas.indexOf("canvas-form-row-options") < canvas.indexOf("canvas-form-actions"));
  assert.match(canvas, /label="Baseline market"/);
  assert.match(canvas, /label="Alternative market"/);
  assert.match(canvas, /label="Research target"/);
  assert.match(canvas, /type="submit"/);
});

test("mobile cultural graph keeps its radial nodes and connectors inside the touch viewport", () => {
  const canvas = source("canvas-components.tsx");
  const css = readFileSync(resolve(process.cwd(), "src/components/mosaic/canvas.css"), "utf8");
  assert.match(canvas, /canvas-graph-lines-mobile/);
  assert.match(canvas, /graph-node-\$\{index\}/);
  assert.match(canvas, /onClick=\{\(\) => evidenceId && onSelectEvidence\(evidenceId\)\}/);
  assert.match(css, /@media\(max-width:560px\)/);
  for (const index of [0, 1, 2, 3, 4, 5]) assert.match(css, new RegExp(`graph-node-${index}\\{left:`));
  assert.match(css, /canvas-node-copy strong,[\s\S]*text-overflow:ellipsis/);
  assert.match(css, /touch-action:manipulation/);
});

test("desktop graph coordinates remain the default presentation layer", () => {
  const canvas = source("canvas-components.tsx");
  const css = readFileSync(resolve(process.cwd(), "src/components/mosaic/canvas.css"), "utf8");
  assert.match(canvas, /const nodePositions = \[/);
  assert.match(canvas, /className=\"canvas-graph-lines canvas-graph-lines-desktop\"/);
  assert.match(css, /\.canvas-graph-stage\{position:relative;min-height:525px/);
  assert.match(css, /\.canvas-graph-lines-mobile\{display:none\}/);
});
