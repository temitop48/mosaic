# MOSAIC Phase 0 architecture

MOSAIC is a modular monolith. The domain contracts under `src/core` describe entities, evidence, relationships, counterfactuals, and launch decisions without importing a provider or framework. Provider contracts under `src/providers/interfaces` define the smallest capability-based boundary needed by the application. The registry composes providers at the application boundary.

## Provider adapters

`QlooProvider` is an infrastructure adapter. It receives validated server-side configuration and an injectable HTTP client, so tests do not need credentials or live requests. Its response normalizer turns only identifiable Qloo records into domain entities; absent or ambiguous records are discarded rather than invented. Its capability declaration makes unsupported features explicit.

`QLOO_API_KEY` and `QLOO_API_BASE_URL` are server-side variables. The adapter is not imported by client components, and no `NEXT_PUBLIC_QLOO_API_KEY` is used. Endpoint paths are configurable because the exact hackathon API route contract is intentionally isolated from the domain.

## Evidence and dependency direction

Every provider-backed evidence and relationship record carries both `providerId` and `sourceReference`, plus retrieval time. Provider scores remain provider-native: no cross-provider normalization or invented score is performed. Interpretations and recommendations must reference evidence and retain caveats. Commercial success probability is intentionally excluded from launch decisions.

The dependency direction is `core <- providers/interfaces <- providers/adapters <- app composition`. A future provider implements `CulturalIntelligenceProvider`, declares its own capabilities and score semantics, then registers itself; core schemas do not change.

## Assumptions and limitations

The Qloo adapter is a skeleton: its paths and response field mapping are deliberately conservative and must be aligned with the verified hackathon API documentation before production use. Affinity discovery currently returns an explicit unsupported-capability result until the response contract is verified. No database, graph store, microservice, or live intelligence is introduced in Phase 0.
