# MOSAIC

### An agentic, evidence-backed cultural decision simulator.

MOSAIC helps teams explore how cultural relationships differ across markets using Qloo-powered research. It combines geographic comparison, an explicitly authorized research agent, evidence inspection, and counterfactual analysis in one interactive workspace. Cultural affinity is evidence for cultural interpretation—not a prediction of demand, sales, revenue, market superiority, or guaranteed commercial outcomes.

**Live application:** [mosaic-26.vercel.app](https://mosaic-26.vercel.app)

**Source repository:** [github.com/temitop48/mosaic](https://github.com/temitop48/mosaic)
**Hackathon:** Qloo Agentic Hackathon 2026

## The problem

Cultural signals are easy to collect but difficult to compare responsibly across places. A useful answer needs more than a list of related entities: it needs market context, provider identity, provenance, evidence checks, a clear boundary around what was researched, and an honest account of what remains unsupported.

MOSAIC is designed for research and product teams exploring cultural context across markets. A user supplies a cultural signal, two markets, a research target, and an objective. The application returns market-separated Qloo observations, presents the evidence in Studio and Canvas, and exposes the decisions and limits behind any additional research.

## Why Qloo is essential

Qloo supplies the entity identities and cultural affinity observations MOSAIC researches. The application does not invent relationships or normalize scores across providers.

- **Entity resolution:** the Qloo search endpoint resolves the cultural signal and returned entities to provider identities.
- **Brand research:** market context is supplied through `signal.location.query`.
- **Place research:** market context is supplied through `filter.location.query`.
- **Geographic context:** evidence retains the market, query context, source and target IDs, categories, names when supplied, and retrieval metadata.
- **Validation and provenance:** finite provider affinity values are checked against the approved subject, target type, market, schema, and provider evidence registry before they are used.
- **Interpretation boundary:** Qloo affinity is cultural evidence. It does not establish demand, sales, partnerships, causation, or commercial suitability.

## What MOSAIC does

- **Geographic Brand and Place research** compares provider-backed cultural observations across two markets while keeping each market's evidence separate.
- **Qloo evidence and provenance** preserve provider IDs, evidence IDs, source references, query parameters, geographic context, retrieval time, and provider-native affinity values.
- **Authorized bounded Research Assistant** assesses evidence coverage and may execute one explicitly authorized follow-up dimension when the policy allows it.
- **Decision Brief and evidence inspection** separate the primary assessment, additional research coverage, geographic interpretation, and unsupported commercial conclusions.
- **Counterfactual Decision Sensitivity** changes one cultural signal while keeping the rest of the scenario fixed, then compares the resulting evidence sets.
- **Decision Stability** describes whether supported assessment classes and underlying cultural evidence changed. It does not establish commercial or business stability.
- **Studio and Canvas** provide guided and visual workspaces for research configuration, evidence review, cultural network inspection, and trace review.
- **Saved Analyses** keep completed validated research in browser-local storage so it can be reopened without a new provider request. Saved records are historical and are not automatically revalidated. Reopened counterfactuals do not retain enough paired scenario data to safely recompute Decision Stability, so that state is shown conservatively as indeterminate.

## How the bounded agent works

MOSAIC uses a deterministic, bounded research policy rather than unrestricted autonomous reasoning.

1. The user enables the Research Assistant, chooses an objective, and explicitly authorizes an additional target dimension.
2. The policy evaluates whether validated primary evidence is sufficient, incomplete, mismatched, unverifiable, or missing the requested dimension.
3. A follow-up is considered only when the requested dimension is supported, materially different, authorized, and actionable.
4. At most one follow-up round may run, within the configured research budget and deadline. Authorization does not guarantee that a follow-up will execute.
5. Each returned observation is checked against the approved subject, target, market, schema, and provider evidence registry. Invalid or mismatched evidence cannot silently replace valid initial evidence.
6. The agent stops when evidence is sufficient, no supported action remains, the budget or deadline is reached, or a provider or validation failure requires a bounded stop.

The execution trace records the assessment, approved request, provider operation, validation outcome, budget use, evidence references, and stop reason. It is an audit trail, not unrestricted model reasoning. MOSAIC cannot decide that a product will win a market, establish demand or sales, identify an audience, prove commercial viability, or replace user authorization.

## Counterfactual research and stability

**Decision Sensitivity** changes one cultural signal, keeps the other scenario parameters fixed, executes new provider research, and compares the returned evidence sets. Comparisons use provider identities and validated relationship fields. The presentation reports overlap, replacement, shared relationships with changed attributes, observation differences, and Jaccard where the comparison is valid.

**Decision Stability** compares supported assessment classes with the evidence change. An unchanged assessment category with changed cultural evidence means the category stayed the same while the underlying returned evidence changed. It does not establish that a business decision is stable or commercially equivalent.

## Studio, Canvas, and Saved Analyses

**Studio** is the guided scenario workspace for configuring a research question, running research, reading the Decision Brief, inspecting evidence, and reviewing the agent trace.

**Canvas** presents the same evidence-led workflow as a more visual research surface, including the cultural network and evidence selection.

**Saved Analyses** are limited to ten browser-local entries. They can be reopened without starting a new provider request, but remain historical rather than automatically revalidated. Saved counterfactuals cannot safely recompute Decision Stability after reopening without both scenario results.

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

From the repository root:

```bash
cd app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment configuration

Copy the committed [sanitized environment example](app/.env.example) to `app/.env.local` and supply values through your own server-side configuration. Never commit secrets or expose them through client-side variables.

- `QLOO_API_KEY` is required for live Qloo-backed research.
- Gemini settings are optional and enable structured interpretation when configured.
- Qloo and Gemini timeout, retry, endpoint, and model settings are optional overrides with adapter defaults.
- Production request protection uses the Upstash variables and `RATE_LIMIT_HMAC_SECRET` documented in the example. Do not disable production request protection.
- `MOSAIC_EVALUATION_BASE_URL` is for the optional evaluation script only.

Live provider-backed research requires valid credentials supplied by the developer. Local startup, deterministic fixtures, and code inspection do not require publishing credentials.

## Checks and commands

Run these from `app`:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Optional smoke and diagnostic scripts exist, but `qloo:smoke` and `gemini:diagnostics` can make authenticated provider requests when credentials are configured. Do not run them against production casually, and do not print credentials or raw provider payloads.

## License and attribution

Original MOSAIC code is released under the [MIT License](LICENSE). Third-party packages retain their own licenses and notices. Qloo and Gemini are external services and trademarks of their respective owners. Provider credentials and service access are not granted by this repository.
