# Mosaic Diagnostic Qloo Evaluation

- Execution: 2026-10-20T15:29:36.644Z
- Mode: LIVE diagnostic
- Base URL: http://localhost:3000
- Scenarios executed: 4

## Scenario outcomes

| ID | Signal | Cities | Outcome | HTTP | Duration (ms) | Baseline evidence | Alternative evidence | Live Qloo attribution |
|---|---|---|---|---:|---:|---:|---:|---|
| D01 | Starbucks | London → New York | complete | 200 | 16058 | 20 | 20 | verified-by-qloo-attribution |
| D02 | Blue Bottle Coffee | London → New York | complete | 200 | 9997 | 20 | 20 | verified-by-qloo-attribution |
| D03 | Adidas | London → Lagos | complete | 200 | 3891 | 20 | 20 | verified-by-qloo-attribution |
| D04 | Starbucks | London → Lagos | complete | 200 | 3996 | 20 | 20 | verified-by-qloo-attribution |

## Comparable overlaps

- D01/D02 (same-city-sensitivity): baseline destination Jaccard 0.02564102564102564; alternative destination Jaccard 0. Exact relationship Jaccard: 0 / 0.
- D03/D04 (lagos-destination-overlap): baseline destination Jaccard 0.3333333333333333; alternative destination Jaccard 0.6. Exact relationship Jaccard: 0 / 0.

## Verified facts and limitations

- Provider mode is marked verified only when returned evidence has provider attribution `qloo`; this does not expose raw upstream HTTP traces.
- Destination overlap uses provider ID, object category, and object entity ID; display names are not used for identity.
- Exact relationship overlap additionally includes provider-backed subject identity.
- Equal destination sets do not imply equal cultural meaning, and affinity does not establish market demand.
- The endpoint response does not expose raw Qloo HTTP requests or cache headers.
- Provider attribution verifies returned Qloo evidence, not the absence of upstream provider caching.
- Returned geographic metadata is reported only when present in validated evidence.
