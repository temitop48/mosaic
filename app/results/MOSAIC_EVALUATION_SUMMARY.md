# MOSAIC Evaluation Summary

Mosaic is a Qloo-powered cultural decision simulator. It resolves user-provided cultural signals to Qloo entities, retrieves provider-backed observations for fixed markets, validates evidence identity and provenance, and compares original and modified signals without producing unsupported market-demand claims.

## Evaluation record

- Mocked integrity/reliability/sensitivity evaluation: 11/11 tests passed.
- Live Qloo scenarios: 8 executed; 7 complete, 1 partial, 0 failed.
- Diagnostic Qloo scenarios: 4 executed; 4 complete.
- Current automated suite: 117 passing tests.

The partial live case was the intentionally unsupported signal. It returned zero validated evidence and explicit errors rather than fabricated observations.

## Signal resolution

The diagnostic run verified distinct Qloo subject entities:

- Starbucks: `B13C02E3-BA3C-4B39-85B4-ACF12FEBC892`
- Blue Bottle Coffee: `22B1BC87-CDFE-4340-86F8-8E0E6E1E6A7D`
- Adidas: `FCEA7CA1-1D40-4680-B337-E74594D9BCF1`

Each successful market returned 20 validated Qloo-attributed observations.

## Destination continuity

Destination overlap is measured by provider ID, object category, and object ID. Jaccard overlap is shared destinations divided by the union.

| Pair | Market | Shared / union | Jaccard |
|---|---|---:|---:|
| Starbucks vs Blue Bottle Coffee | London | 1 / 39 | 0.0256 |
| Starbucks vs Blue Bottle Coffee | New York | 0 / 40 | 0 |
| Adidas vs Starbucks | London | 10 / 30 | 0.3333 |
| Adidas vs Starbucks | Lagos | 15 / 25 | 0.6 |

The 15 shared Lagos destinations do not establish equal cultural meaning, demand, market fit, or commercial performance.

## Sensitivity interpretation

Exact relationship overlap remains distinct from destination overlap. Changing the cultural-signal subject changes the provider-backed relationship identity, so Starbucks versus Blue Bottle Coffee recorded zero exact relationship overlap even though one London destination was shared.

## Why Qloo matters

Qloo is integral to Mosaic because the application’s recommendations are grounded in resolved provider entities, provider-native affinity observations, geographic query context, provenance, and validation. The evaluation demonstrates evidence handling and reproducibility, not superiority over generic LLMs or competitors.

## Reproduce

```bash
npm test
```

The recorded live runs require a configured Qloo environment and may consume API quota. Raw evidence is preserved in [evaluation-integrity.json](evaluation-integrity.json), [evaluation-live-qloo.json](evaluation-live-qloo.json), and [evaluation-diagnostic-qloo.json](evaluation-diagnostic-qloo.json). The full technical report is [MOSAIC_EVALUATION_REPORT.md](MOSAIC_EVALUATION_REPORT.md).
