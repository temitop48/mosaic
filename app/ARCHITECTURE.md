# MOSAIC Phase 1 architecture

MOSAIC is a modular monolith. The domain contracts under `src/core` describe entities, evidence, relationships, counterfactuals, and launch decisions without importing a provider or framework. Provider contracts under `src/providers/interfaces` define the smallest capability-based boundary needed by the application. The registry composes providers at the application boundary.

## Provider adapters

`QlooProvider` is an infrastructure adapter. It receives validated server-side configuration and an injectable HTTP client, so tests do not need credentials or live requests. `QlooHttpClient` owns the server-side `X-Api-Key` header and timeout boundary. The adapter uses `GET /search` for entity resolution and `GET /v2/insights` for entity-based affinity discovery.

The adapter normalizes only identifiable Qloo records into domain entities and only emits affinity evidence when Qloo supplies a finite `query.affinity` value. Popularity is retained as metadata and is never used as affinity. Per-result explainability is preserved as provider-native data when requested. Supported Insights target types are explicitly allow-listed from Qloo's documented entity categories; unsupported types fail before a request is made.

`QLOO_API_KEY`, `QLOO_API_BASE_URL`, `QLOO_SEARCH_PATH`, `QLOO_INSIGHTS_PATH`, and `QLOO_TIMEOUT_MS` are server-side variables. The adapter is not imported by client components, and no `NEXT_PUBLIC_QLOO_API_KEY` is used. The default base URL is the verified hackathon host and the default paths are `/search` and `/v2/insights`.

## Evidence and dependency direction

Every provider-backed evidence and relationship record carries both `providerId` and `sourceReference`, plus retrieval time. Qloo affinity evidence additionally retains source and target IDs, their normalized categories and names where supplied, the actual provider affinity, explainability, geographic context, and the exact non-secret query parameters. A brand entity and an individual place entity remain distinct domain entities. Provider scores remain provider-native: no cross-provider normalization or invented score is performed. Affinity evidence is not a partnership, demand, or causal claim, and the adapter does not create commercial relationships from it. Interpretations and recommendations must reference evidence and retain caveats. Commercial success probability is intentionally excluded from launch decisions.

The dependency direction is `core <- providers/interfaces <- providers/adapters <- app composition`. A future provider implements `CulturalIntelligenceProvider`, declares its own capabilities and score semantics, then registers itself; core schemas do not change.

## Phase 1 assumptions and limitations

Entity search, documented entity-based Insights discovery, geographic locality filtering, per-result explainability preservation, timeout handling, and structured authentication/rate-limit/upstream errors are implemented with mocked automated tests. Standalone explainability retrieval remains unsupported because the verified contract supplies explainability as part of the Insights response. No audience, tag-only, demographics, or other cross-domain operation is claimed beyond the documented entity target types. No database, graph store, microservice, live research workflow, or UI change is introduced in Phase 1.
