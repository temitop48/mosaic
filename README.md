# MOSAIC

### An agentic, evidence-backed cultural decision simulator.

MOSAIC helps a team compare cultural connections across markets using provider-backed Qloo observations. It keeps primary research, authorized follow-up research, evidence validation, geographic context, and counterfactual comparison visible in one workflow. MOSAIC is a research and decision-support tool: it does not predict demand, sales, commercial success, or guaranteed launch outcomes.

**Live application:** [mosaic-26.vercel.app](https://mosaic-26.vercel.app)

**Hackathon:** Qloo Agentic Hackathon 2026

## The problem

Cultural signals are easy to collect but difficult to compare responsibly across places. A useful answer needs more than a list of related entities: it needs market context, provider identity, provenance, evidence checks, a clear boundary around what was researched, and an honest account of what remains unsupported.

MOSAIC is designed for that evidence trail. A user supplies a cultural signal, two markets, a research target, and an objective. The application returns market-separated Qloo observations, presents the evidence in Studio and Canvas, and exposes the decisions and limits behind any additional research.

## What is implemented

- Geographic research for **Brands** and **Places** across two markets.
- Qloo entity resolution and provider-backed affinity observations.
- Evidence IDs, provider IDs, source references, retrieval metadata, query context, and provider-native affinity values.
- A Decision Brief that separates the primary conclusion, additional research coverage, geographic interpretation, and unsupported commercial conclusions.
- A bounded Research Assistant that can assess evidence coverage and execute one explicitly authorized follow-up dimension.
- Research Assistant Findings, validated follow-up evidence, and an inspectable execution trace.
- Counterfactual **Decision Sensitivity** by changing one cultural signal while keeping the rest of the scenario fixed.
- **Decision Stability** classifications that distinguish an unchanged assessment category from changed cultural evidence.
- Studio and Canvas experiences, responsive evidence visualization, and browser-local Saved Analyses.

Automated tests are available through `npm test`. The public production URL is available for demonstration, subject to provider availability and the limitations below.

## How the bounded agent works

MOSAIC uses a deterministic, bounded research policy rather than unrestricted autonomous reasoning.

1. The user enables the Research Assistant, chooses an objective, and explicitly authorizes an additional target dimension.
2. The agent evaluates whether validated primary evidence is sufficient, incomplete, mismatched, unverifiable, or missing the requested dimension.
3. If the requested dimension is supported, materially different, authorized, and actionable, the agent may approve at most one follow-up round within the configured budget and deadline.
4. Each returned observation is checked against the approved subject, target, market, schema, and provider evidence registry.
5. Valid evidence is retained; invalid or mismatched evidence cannot silently replace valid initial evidence.
6. The agent stops when evidence is sufficient, no supported action remains, the budget/deadline is reached, or a provider/validation failure requires a bounded stop.

The agent cannot decide that a product will win a market, establish demand or sales, identify an audience, prove commercial viability, or replace user authorization. The execution trace records the assessment, approved request, provider operation, validation outcome, budget use, evidence references, and stop reason; it is an audit trail, not unrestricted model reasoning.

## Why Qloo is essential

Qloo supplies the entity identities and cultural affinity observations MOSAIC researches. The application does not invent relationships or normalize scores across providers.

- **Entity resolution:** the Qloo search endpoint resolves the cultural signal and returned entities to provider identities.
- **Brand research:** market context is supplied through `signal.location.query`.
- **Place research:** market context is supplied through `filter.location.query`.
- **Evidence:** finite provider affinity values are retained with source and target IDs, categories, names when supplied, geographic context, query parameters, retrieval time, and provider provenance.
- **Validation:** evidence is schema-checked and matched to the approved subject, target type, market, and provider context before it is used in the brief or follow-up assessment.
- **Separation:** primary target evidence and an optional follow-up target dimension remain separate; they are never merged into one ranking.

Provider affinity is cultural evidence. It is not a partnership, demand, sales, causal, or market-advantage claim.

## Counterfactual research and stability

Decision Sensitivity changes one cultural signal, keeps the other scenario parameters fixed, executes new provider research, and compares the returned evidence sets. Comparisons use provider identities and validated relationship fields. The presentation reports overlap, replacement, shared relationships with changed attributes, observation differences, and Jaccard where the comparison is valid.

Decision Stability compares the supported assessment classes and the evidence change. For example, an unchanged assessment category with changed cultural evidence means that the category stayed the same while the underlying returned evidence changed. It does **not** establish that a business decision is stable or commercially equivalent.

## Studio, Canvas, and saved research

**Studio** is the guided scenario workspace for configuring a research question, running research, reading the Decision Brief, inspecting evidence, and reviewing the agent trace.

**Canvas** presents the same evidence-led workflow as a more visual research surface, including the cultural network and evidence selection.

**Saved Analyses** store validated completed research in browser local storage so it can be reopened without starting a new provider request. Saved records are local to that browser, limited to ten entries, historical rather than automatically revalidated, and do not retain enough paired counterfactual data to safely recompute fresh Decision Stability after reopening; that state is shown conservatively as indeterminate.

## Architecture

The application is a Next.js modular monolith:

```text
Studio / Canvas UI
        |
        v
API routes and request protection
        |
        +--> research engine and bounded agent orchestration
        |          |
        |          +--> evidence registry, validation, trace, decisions
        |
        +--> Qloo provider adapter       (entity search and affinity)
        +--> optional Gemini adapter     (structured interpretation)
```

Domain contracts under `app/src/core` describe evidence, relationships, counterfactuals, and decisions without importing a provider or UI framework. Provider interfaces and adapters isolate Qloo/Gemini integration. Request protection uses Upstash Redis and an HMAC-derived client identity in production. Secrets are server-side only; no `NEXT_PUBLIC_*` provider key is used.

More detail is available in [the architecture notes](app/ARCHITECTURE.md), including provider boundaries and evidence semantics.

## Technology stack

- Next.js 16, React 19, TypeScript 5
- Tailwind CSS 4
- Qloo API for entity resolution and affinity observations
- Optional Gemini structured interpretation
- Upstash Redis for production request protection and rate limiting
- `@xyflow/react` for the cultural network visualization
- Node's built-in test runner with deterministic provider fixtures

## Local setup

Requirements: a current Node.js version compatible with the project dependencies and npm.

```bash
cd app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

Create `app/.env.local` with values supplied through your own server-side deployment configuration. Never commit secrets or expose them through client-side variables.

For live Qloo research:

```text
QLOO_API_KEY=
```

Optional Qloo configuration (defaults are defined by the adapter):

```text
QLOO_API_BASE_URL=
QLOO_SEARCH_PATH=
QLOO_INSIGHTS_PATH=
QLOO_TIMEOUT_MS=
QLOO_OVERALL_TIMEOUT_MS=
QLOO_MAX_ATTEMPTS=
QLOO_RETRY_BASE_DELAY_MS=
```

For optional structured Gemini interpretation:

```text
GEMINI_API_KEY=
GEMINI_MODEL=
GEMINI_API_BASE_URL=
GEMINI_API_ENDPOINT=
GEMINI_THINKING_LEVEL=
GEMINI_TIMEOUT_MS=
GEMINI_OVERALL_TIMEOUT_MS=
GEMINI_MAX_ATTEMPTS=
GEMINI_RETRY_BASE_DELAY_MS=
```

Production request protection requires:

```text
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
RATE_LIMIT_HMAC_SECRET=
```

`REQUEST_PROTECTION_MODE=disabled` is only a non-production development option when the application explicitly permits it. Do not disable request protection in production. `MOSAIC_EVALUATION_BASE_URL` is used only by the optional evaluation script.

## Checks and commands

Run these from `app`:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Optional smoke/diagnostic scripts exist, but `qloo:smoke` and `gemini:diagnostics` can make authenticated provider requests when credentials are configured. Do not run them against production casually, and do not print their credentials or raw provider payloads.

## Known limitations

- Cultural affinity is not a demand, sales, audience, partnership, or commercial-success forecast.
- Provider results, entity resolution, latency, and returned overlap can vary between runs and snapshots.
- The agent is intentionally bounded: explicit authorization is required and only one follow-up round is allowed.
- A partial or unavailable follow-up is a valid bounded outcome; it does not justify filling gaps with invented evidence.
- Saved Analyses are browser-local and historical; they are not automatically revalidated.
- Saved counterfactuals cannot currently recompute Decision Stability safely without both scenario results.
- The current UI exposes Places and Brands as research targets; broader Qloo categories are not presented as supported user workflows.
- Standalone explainability retrieval is not supported; explainability is preserved when supplied with the Insights response.
- Responsive browser verification is strongest at the recorded 400px and desktop checks; additional device-specific verification should be performed before relying on a presentation layout.

## Screenshots and demo assets

No public screenshots are included in this repository yet. For a hackathon presentation, capture sanitized screenshots of:

1. Studio with completed geographic Brand research.
2. Canvas with the cultural network and an inspected evidence item.
3. Research Assistant Findings with the follow-up rationale, validated Place evidence, and trace.
4. Decision Sensitivity and Decision Stability with the scope/limitation wording visible.

Screenshots should show no credentials, private metadata, or misleading commercial conclusion. Local design references are not treated as product screenshots.

## License and attribution

Original MOSAIC code is released under the [MIT License](LICENSE). Third-party packages retain their own licenses and notices. Qloo and Gemini are external services and trademarks of their respective owners. Provider credentials and service access are not granted by this repository.
