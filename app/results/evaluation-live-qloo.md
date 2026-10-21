# Mosaic Live Qloo Evaluation

- Execution: 2026-10-20T15:16:53.297Z
- Mode: LIVE
- Base URL: http://localhost:3000
- Scenarios attempted: 8
- Complete: 7
- Partial: 1
- Failed: 0

## Scenario outcomes

| ID | Signal | Cities | Outcome | HTTP | Duration (ms) | Baseline evidence | Alternative evidence | Qloo evidence | Attribution |
|---|---|---|---|---:|---:|---:|---:|---|---|
| L01 | Starbucks | London → New York | complete | 200 | 14431 | 20 | 20 | yes | valid |
| L02 | Blue Bottle Coffee | London → New York | complete | 200 | 9702 | 20 | 20 | yes | valid |
| L03 | Nike | London → Tokyo | complete | 200 | 13577 | 20 | 20 | yes | valid |
| L04 | Spotify | Lagos → London | complete | 200 | 3999 | 20 | 20 | yes | valid |
| L05 | Netflix | New York → Tokyo | complete | 200 | 21020 | 20 | 20 | yes | valid |
| L06 | Adidas | London → Lagos | complete | 200 | 3951 | 20 | 20 | yes | valid |
| L07 | Intentionally unsupported cultural signal | London → New York | partial | 200 | 552 | 0 | 0 | no | not confirmed |
| L08 | Starbucks | London → New York | complete | 200 | 13463 | 20 | 20 | yes | valid |

## Repeatability

L01/L08 payload identical: **yes**. Baseline shared IDs: **21**; alternative shared IDs: **21**.

## Sensitivity

Validation: **valid**. Baseline stable/changed/new/not-observed: 0/0/20/20. Alternative stable/changed/new/not-observed: 0/0/20/20.

## Limitations

- Live results are provider observations from the evaluation window, not accuracy, demand, or superiority measurements.
- Affinity scores are provider-native observations and are not compared as cross-market quantitative rankings.
- A missing top-N observation is not evidence of cultural absence.
- This run uses no automatic retries and makes no Gemini requests.
