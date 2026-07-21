# Large Repository Benchmark Report

This report covers deterministic static-analysis stages only. It does not include LLM inference or dashboard generation.

## Run

| Metric | Value |
| --- | --- |
| Status | degraded |
| Pair ID | d7a047c6-9c05-41b2-9923-43a1e71e9634 |
| Subject | understand-anything-pr587-full-sample |
| Subject commit | 851ca14ebab22c81fde136986263d550daa38ee3 |
| Subject dirty | false |
| Tool commit | 851ca14ebab22c81fde136986263d550daa38ee3 |
| Tool dirty | false |
| Tool version | 2.9.3 |
| Started (UTC) | 2026-07-17T11:45:14.919Z |
| Total duration | 11734.69 ms |
| Concurrency | 5 |
| LLM invoked | No |

## Scale

| Metric | Value |
| --- | --- |
| Files | 459 |
| Lines | 127155 |
| Source bytes | 8918520 |
| Filtered by user ignore | 0 |
| Missing during measurement | 0 |

## Stages

| Stage | Status | Duration | Peak / max worker RSS (bytes) | User CPU (micros) | System CPU (micros) | Output (bytes) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| scan | ok | 783.46 ms | 80,211,968 | 281,000 | 407,000 | 82,572 |
| imports | ok | 1172.55 ms | 190,054,400 | 906,000 | 562,000 | 71,809 |
| batching | ok | 1169.17 ms | 191,143,936 | 875,000 | 578,000 | 354,328 |
| structure | ok | 8070.21 ms | 193,888,256 | 18,300,000 | 21,344,000 | 1,636,826 |

## Integrity and reproducibility

| Metric | Value |
| --- | --- |
| All scanned files batched | true |
| Structure coverage | 1 |
| Files skipped | 20 |
| Failed batches | 0 |
| Missing structure paths | 0 |
| Duplicate structure paths | 0 |
| Unexpected structure paths | 0 |
| Malformed structure batches | 0 |
| Input digest (SHA-256) | ff0ab0d785f92f6324bc36c389a50abdbfa86ddb6a892a0439be1162a4da6a6f |
| Output digest (SHA-256) | 69f6cee48ef7e3febf0c5bb7dd04528010fc5764386b9982a44865813d9ec24a |
| Schema version | 1.0.0 |

## Environment

| Metric | Value |
| --- | --- |
| Platform | win32 |
| OS release | 10.0.26200 |
| Architecture | x64 |
| Node.js | v22.18.0 |
| CPU | 13th Gen Intel(R) Core(TM) i9-13900HX |
| Logical cores | 32 |
| Memory (bytes) | 16907100160 |

## Warnings

- batching: 5
