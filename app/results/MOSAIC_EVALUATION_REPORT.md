# MOSAIC Evaluation Report

## A. Executive Summary

Mosaic is an evidence-backed cultural decision simulator. It uses Qloo to resolve a cultural signal to a provider entity, retrieve location-specific affinity observations, validate those observations, and compare two fixed markets without turning provider affinity into a market-demand score.

This report consolidates the recorded Phase 8C.1–8C.2C evidence. It covers mocked contract and reliability evaluation, live Qloo research, live signal-resolution diagnostics, deterministic sensitivity comparison, and destination continuity analysis.

The evidence establishes that the evaluated signals reached Qloo, resolved to distinct provider entities, and returned validated provider-attributed observations. It also establishes that exact relationship overlap and destination overlap are different measurements. It does not establish market demand, commercial performance, cultural causation, or superiority over another system.

## B. Evaluation Methodology

### Mocked evaluation

The recorded mocked evaluation was executed from [evaluation-integrity.json](evaluation-integrity.json) with:

```text
node --experimental-strip-types --test --test-isolation=none --import ./test-aliases.mjs src/tests/evaluation-integrity.test.ts src/tests/evaluation-reliability.test.ts src/tests/evaluation-sensitivity.test.ts
```

It ran 11 tests: 4 integrity, 4 reliability, and 3 sensitivity tests. All 11 passed. No Qloo or Gemini requests were made.

### Live Qloo evaluation

The recorded live run in [evaluation-live-qloo.json](evaluation-live-qloo.json) sent eight sequential scenarios to `POST /api/counterfactual`, with a 45-second per-request timeout and a two-second delay between requests. Request-shape validation passed for all eight scenarios, and L01/L08 used identical payloads.

### Cultural signal diagnostics

The diagnostic run in [evaluation-diagnostic-qloo.json](evaluation-diagnostic-qloo.json) sent four sequential scenarios: Starbucks, Blue Bottle Coffee, Adidas, and Starbucks with Lagos as the alternative market. It retained resolved subject IDs, sanitized effective query metadata, destination IDs, attribution, and overlap sets.

### Deterministic sensitivity and continuity

The comparison implementation is in [compare.ts](../src/core/sensitivity/compare.ts), with contracts in [contracts.ts](../src/core/sensitivity/contracts.ts). Existing relationship classifications remain subject/object relationship classifications. Destination continuity is a separate set-based analysis.

## C. Evidence Integrity

The implementation and mocked tests support these guarantees:

- Provider evidence is retained only when it has valid entity identities, provider attribution, a finite provider score, query parameters, provenance, and verified status.
- Missing entities, fabricated scores, provider/category mismatches, malformed observations, and unverified observations are rejected.
- Evidence graph edges preserve subject IDs, object IDs, provider IDs, and provider scores.
- Unsupported recommendation claims are not promoted to provider-backed claims.
- Unresolved entities produce explicit partial research and no invented evidence.
- Historical evidence metadata, including provenance, query parameters, and geographic context, survives validation boundaries.
- Sensitivity comparison rejects invalid results, changed cities, changed concepts, changed non-seed parameters, and malformed or unverified evidence.

These behaviors are exercised by [evaluation-integrity.test.ts](../src/tests/evaluation-integrity.test.ts), [evaluation-reliability.test.ts](../src/tests/evaluation-reliability.test.ts), [evaluation-sensitivity.test.ts](../src/tests/evaluation-sensitivity.test.ts), and [sensitivity.test.ts](../src/tests/sensitivity.test.ts).

## D. Live Research Results

The live run executed 8 scenarios:

| ID | Signal | Markets | Outcome | Duration | Evidence | Attribution |
|---|---|---|---|---:|---:|---|
| L01 | Starbucks | London / New York | Complete | 14,431 ms | 20 / 20 | Valid Qloo |
| L02 | Blue Bottle Coffee | London / New York | Complete | 9,702 ms | 20 / 20 | Valid Qloo |
| L03 | Nike | London / Tokyo | Complete | 13,577 ms | 20 / 20 | Valid Qloo |
| L04 | Spotify | Lagos / London | Complete | 3,999 ms | 20 / 20 | Valid Qloo |
| L05 | Netflix | New York / Tokyo | Complete | 21,020 ms | 20 / 20 | Valid Qloo |
| L06 | Adidas | London / Lagos | Complete | 3,951 ms | 20 / 20 | Valid Qloo |
| L07 | Intentionally unsupported cultural signal | London / New York | Partial | 552 ms | 0 / 0 | No Qloo evidence |
| L08 | Starbucks | London / New York | Complete | 13,463 ms | 20 / 20 | Valid Qloo |

Totals were 7 complete, 1 partial, and 0 failed. L07 returned HTTP 200 but remained partial because both markets had provider/validation errors and no validated evidence. It was not converted into a successful or synthetic result.

The live report also recorded 21 shared provider entity IDs between L01 and L08 in each market. This is a returned-entity overlap measurement; it does not guarantee identical ordering or scores.

## E. Signal Differentiation

The diagnostic run resolved the submitted signals as follows:

| Signal | Provider | Resolved Qloo ID | Category | Resolution |
|---|---|---|---|---|
| Starbucks | Qloo | `B13C02E3-BA3C-4B39-85B4-ACF12FEBC892` | Brand | Resolved |
| Blue Bottle Coffee | Qloo | `22B1BC87-CDFE-4340-86F8-8E0E6E1E6A7D` | Brand | Resolved |
| Adidas | Qloo | `FCEA7CA1-1D40-4680-B337-E74594D9BCF1` | Brand | Resolved |

The same resolved subject ID was used for the baseline and alternative market within each scenario. The diagnostic query metadata showed those IDs in `signal.interests.entities`, with the corresponding city in `filter.location.query`. This verifies that different user signals resolved to distinct Qloo provider entities and conditioned the affinity queries.

Returned geographic metadata was empty in all diagnostic markets. The city query parameter was present, but no additional provider geographic metadata was exposed in validated evidence.

## F. Destination Continuity

Destination continuity uses the provider-backed object identity:

```text
providerId + objectEntityCategory + objectEntityId
```

It does not use display names. Jaccard overlap is `shared / union`.

| Pair | Fixed market | Shared | Union | Jaccard |
|---|---|---:|---:|---:|
| Starbucks vs Blue Bottle Coffee | London | 1 | 39 | 0.0256 |
| Starbucks vs Blue Bottle Coffee | New York | 0 | 40 | 0 |
| Adidas vs Starbucks | London | 10 | 30 | 0.3333 |
| Adidas vs Starbucks | Lagos | 15 | 25 | 0.6 |

The Adidas/Starbucks Lagos result directly confirms that 15 of the 20 returned destinations were shared, while the union contained 25 unique destinations. This is destination continuity only; it does not imply equal cultural meaning or equal affinity.

## G. Decision Sensitivity

The sensitivity engine compares exact provider-backed relationships using provider ID, subject identity, subject category, object identity, and object category. It separately compares each fixed market: baseline to baseline and alternative to alternative.

For the live Starbucks versus Blue Bottle Coffee sensitivity comparison:

- Baseline: 0 stable, 0 changed, 20 newly observed, 20 not observed in the variant.
- Alternative: 0 stable, 0 changed, 20 newly observed, 20 not observed in the variant.

The diagnostic run explains this result. Starbucks and Blue Bottle Coffee have different subject IDs, so their exact relationship keys differ even when a destination object ID is shared. Consequently, exact relationship overlap can be zero while destination overlap is nonzero. The destination metric supplements relationship comparison; it does not replace or weaken it.

## H. Failure Handling

### Observed live failure behavior

L07, the intentionally unsupported signal, returned a partial result with zero validated evidence in both markets. The report recorded explicit application-level validation errors and did not claim Qloo evidence.

### Mocked failure behavior

The four mocked reliability tests passed and verified that:

- Provider errors become partial research, not successful results.
- Malformed provider observations are rejected.
- Unresolved entities do not produce invented evidence.
- Identical valid fixture inputs produce deterministic research output.

The mocked integrity and sensitivity suites also passed all 7 corresponding tests, covering invalid evidence, unsupported claims, relationship identity, deterministic ordering, missing top-N observations, and input preservation.

## I. Limitations

- Qloo affinity values are provider-native observations and are not calibrated market-fit scores.
- Results are limited to provider-returned top-N sets, with 20 affinity observations per successful market in these runs.
- Absence from a top-N response is not evidence of cultural absence.
- Geographic metadata was unavailable in the diagnostic evidence, although city query parameters were retained.
- No calibrated confidence, market ranking, commercial demand, sales prediction, partnership suitability, or launch-success estimate is produced.
- Provider results may vary across time, request timing, upstream normalization, and provider updates.
- The live sample contains eight scenarios and the diagnostic sample contains four scenarios; it is not a benchmark of provider accuracy.
- The recorded live evidence is tied to its execution window and local endpoint environment.
- Saved analyses use browser-local persistence and therefore are not a shared server-side historical store.
- Upstream provider caching cannot be established or excluded from the endpoint response alone.
- No comparative evaluation against a generic LLM or competitor was performed.

## J. Reproducibility

From the application directory, the mocked evaluation can be reproduced with:

```bash
node --experimental-strip-types --test --test-isolation=none --import ./test-aliases.mjs src/tests/evaluation-integrity.test.ts src/tests/evaluation-reliability.test.ts src/tests/evaluation-sensitivity.test.ts
```

The full automated suite can be run with:

```bash
npm test
```

The recorded live runner uses the existing endpoint and requires a configured Qloo environment in the running application. It may consume provider quota:

```bash
node --experimental-strip-types scripts/evaluation/live-qloo.mjs --base-url=http://localhost:3000
node --experimental-strip-types scripts/evaluation/live-qloo.mjs --diagnostic --base-url=http://localhost:3000
```

The live commands are not required to reproduce the mocked test results and should be run only when fresh provider observations are intended.

## K. Conclusion

The recorded evidence establishes that Mosaic performs provider-backed cultural signal resolution, validates returned evidence, preserves explicit partial failures, and compares fixed markets deterministically. Starbucks, Blue Bottle Coffee, and Adidas resolved to distinct Qloo entities. Destination continuity explains why exact relationship comparison can report zero shared relationships while destination sets still overlap, including 15 shared Lagos destinations for Adidas versus Starbucks.

The evidence does not establish that shared destinations have equal cultural meaning, that any city is preferred, or that any result predicts market demand or commercial performance. Phase 8C is ready for closure on the basis of the recorded evaluation scope; broader provider accuracy or commercial validation would require a separately designed study.

## Evidence Sources

- [Mocked integrity report](evaluation-integrity.json)
- [Live Qloo report](evaluation-live-qloo.json)
- [Live Qloo summary](evaluation-live-qloo.md)
- [Diagnostic Qloo report](evaluation-diagnostic-qloo.json)
- [Diagnostic Qloo summary](evaluation-diagnostic-qloo.md)
- [Sensitivity contracts](../src/core/sensitivity/contracts.ts)
- [Sensitivity comparison](../src/core/sensitivity/compare.ts)
- [Sensitivity presentation](../src/components/mosaic/sensitivity-panel.tsx)
- [Evaluation tests](../src/tests/evaluation-integrity.test.ts), [reliability tests](../src/tests/evaluation-reliability.test.ts), [sensitivity tests](../src/tests/evaluation-sensitivity.test.ts), and [comparison tests](../src/tests/sensitivity.test.ts)
