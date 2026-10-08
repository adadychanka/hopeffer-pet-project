Load: 50 connections on /light and 8 on /heavy at the same time, 30 s, autocannon. Median of 3 runs.
Node v24.21.0, 14 host CPUs, server pinned with taskset.

| Variant | CPUs | Light RPS | Light p50, ms | Light p99, ms | Heavy RPS | Heavy p99, ms | Errors | Peak RSS, MB |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| light only, no heavy load | 4 | 54231 | 0 | 1 | - | - | 0 | 160 |
| single process | 4 | 78 | 405 | 10433 | 20 | 441 | 4 | 124 |
| cluster, 1 worker | 4 | 127 | 403 | 815 | 19 | 767 | 0 | 224 |
| cluster, 2 workers | 4 | 239 | 166 | 473 | 37 | 481 | 0 | 345 |
| cluster, 4 workers | 4 | 478 | 110 | 238 | 70 | 207 | 0 | 571 |
| worker_threads (piscina) | 4 | 45537 | 0 | 5 | 47 | 234 | 0 | 295 |
| single process | 1 | 74 | 420 | 10600 | 19 | 445 | 8 | 121 |
| cluster, 4 workers | 1 | 130 | 406 | 827 | 19 | 633 | 0 | 565 |
| worker_threads (piscina) | 1 | 18281 | 0 | 12 | 13 | 749 | 0 | 194 |
