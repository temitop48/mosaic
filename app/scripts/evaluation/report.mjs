import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const files = [
  { file: "src/tests/evaluation-integrity.test.ts", category: "integrity", tests: 4 },
  { file: "src/tests/evaluation-reliability.test.ts", category: "reliability", tests: 4 },
  { file: "src/tests/evaluation-sensitivity.test.ts", category: "sensitivity", tests: 3 },
];
const fileNames = files.map((item) => item.file);
const execution = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-isolation=none", "--import", "./test-aliases.mjs", ...fileNames], { cwd: root, encoding: "utf8" });
const totalTests = files.reduce((sum, item) => sum + item.tests, 0);
const passed = execution.status === 0 ? totalTests : 0;
const report = {
  evaluation: "Mosaic evidence integrity and deterministic evaluation",
  evaluationMode: "MOCKED",
  executedAt: new Date().toISOString(),
  command: `node --experimental-strip-types --test --test-isolation=none --import ./test-aliases.mjs ${fileNames.join(" ")}`,
  status: execution.status === 0 ? "passed" : "failed",
  categories: files.map((item) => ({ category: item.category, testFile: item.file, tests: item.tests, status: execution.status === 0 ? "passed" : "failed" })),
  summary: { tests: totalTests, passed, failed: totalTests - passed },
  failures: execution.status === 0 ? [] : ["One or more evaluation test files exited non-zero; rerun the command above for detailed test output."],
  limitations: ["Mocked fixtures only; no Qloo or Gemini requests were made.", "This report evaluates contract and failure-handling behavior, not live provider accuracy or commercial outcomes."],
};
const outputPath = resolve(root, "results/evaluation-integrity.json");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = execution.status ?? 1;
