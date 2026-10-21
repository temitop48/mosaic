import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function routeSource(route: string): string {
  return readFileSync(new URL(`../app/api/${route}/route.ts`, import.meta.url), "utf8");
}

test("counterfactual route uses a fixed client-safe unexpected-error message", () => {
  const source = routeSource("counterfactual");
  assert.match(source, /code: "SERVICE_UNAVAILABLE", message: "Counterfactual research service is unavailable"/);
  assert.doesNotMatch(source, /const message = cause instanceof Error \? cause\.message/);
});

test("analyze route uses a fixed client-safe unexpected-error message", () => {
  const source = routeSource("analyze");
  assert.match(source, /code: "SERVICE_UNAVAILABLE", message: "Analysis service is unavailable"/);
  assert.doesNotMatch(source, /const message = cause instanceof Error \? cause\.message/);
});
