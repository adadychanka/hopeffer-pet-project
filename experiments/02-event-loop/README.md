# Experiment: one process, cluster, worker_threads

One problem, three ways to live with it. A heavy endpoint blocks the event
loop, and the numbers show what that does to a light endpoint.

This folder is a separate NestJS app with its own `package.json` and
`pnpm-workspace.yaml`. The main project does not install, build, lint or
typecheck it. The heavy endpoint blocks the event loop on purpose, so this code
does not belong in the product.

## The app

- `GET /light` does no work and returns the pid of the process that answered.
  Its latency is the time a request waits for the event loop.
- `GET /heavy` runs `crypto.pbkdf2Sync` with 300 000 iterations, about 50 ms
  of CPU. `HEAVY_MODE=sync` (default) runs it on the main thread.
  `HEAVY_MODE=pool` runs it in a [piscina](https://github.com/piscinajs/piscina)
  thread pool (`src/heavy.service.ts`, `src/heavy.worker.ts`).
- `dist/main.js` starts one process. `dist/cluster.js` starts a `node:cluster`
  primary with `WEB_CONCURRENCY` workers (default 1). The primary forks a new
  worker when one dies. On SIGTERM or SIGINT it stops all workers and forks
  none (`src/cluster.ts`).

```bash
pnpm install
pnpm run build
pnpm start                                 # one process, port 3000
HEAVY_MODE=pool pnpm start                 # one process + thread pool
WEB_CONCURRENCY=4 pnpm run start:cluster   # cluster, 4 workers
pnpm run check:cluster                     # checks restart and SIGTERM rules
pnpm run bench                             # all measurements, about 16 min
```

## Method

`bench/run.mjs` runs each variant 3 times and takes the median of each number.

- The server is pinned to CPUs `0..N-1` with `taskset`, so "4 CPUs" means
  4 cores the server can use.
- Two autocannon processes run at the same time for 30 s, each on its own
  2 CPUs outside the server's set: 50 connections on `/light` and
  8 connections on `/heavy`. Before the measurement there is a 3 s warm-up.
- Peak RSS is the sum over the process and its children (the cluster primary
  and its workers), sampled every 500 ms. Worker threads are inside their
  process, so their memory is counted too.
- Errors are autocannon timeouts (20 s), socket errors and non-2xx answers.

Why 8 heavy connections and not 50: the first full run used 50. A single
thread then has 2.5 s of heavy work queued at all times, light requests hit
the 20 s timeout (up to 144 errors per run), and p99 of the requests that
survived means nothing. Eight connections keep all 4 CPUs busy in every
variant without that.

## Results

Node v24.21.0, Linux, 14 host CPUs. Full data per run: `bench/results.json`.

| Variant                   | CPUs | Light RPS | Light p50, ms | Light p99, ms | Heavy RPS | Heavy p99, ms | Errors | Peak RSS, MB |
| ------------------------- | ---: | --------: | ------------: | ------------: | --------: | ------------: | -----: | -----------: |
| light only, no heavy load |    4 |    54 231 |             0 |             1 |         - |             - |      0 |          160 |
| single process            |    4 |        78 |           405 |        10 433 |        20 |           441 |      4 |          124 |
| cluster, 1 worker         |    4 |       127 |           403 |           815 |        19 |           767 |      0 |          224 |
| cluster, 2 workers        |    4 |       239 |           166 |           473 |        37 |           481 |      0 |          345 |
| cluster, 4 workers        |    4 |       478 |           110 |           238 |        70 |           207 |      0 |          571 |
| worker_threads (piscina)  |    4 |    45 537 |             0 |             5 |        47 |           234 |      0 |          295 |
| single process            |    1 |        74 |           420 |        10 600 |        19 |           445 |      8 |          121 |
| cluster, 4 workers        |    1 |       130 |           406 |           827 |        19 |           633 |      0 |          565 |
| worker_threads (piscina)  |    1 |    18 281 |             0 |            12 |        13 |           749 |      0 |          194 |

Notes on the numbers:

- Single process, light p99: two of three runs had p99 above 10 s and some
  light requests timed out at 20 s; one run had p99 of about 0.8 s. The
  median shows the bad case. The cause of the spread was not investigated.
- The pool has `max` 6 threads on 4 CPUs and 1.5 on 1 CPU (piscina sets
  `maxThreads` to 1.5 × `os.availableParallelism()`).

## Conclusions

- **One process:** while `/heavy` runs, the event loop serves nothing else.
  `/light` drops from 54 000 to under 100 RPS, and its p99 goes from 1 ms to
  seconds. More CPUs change nothing: one thread uses one core.
- **cluster** multiplies throughput: 4 workers on 4 CPUs give 3.5× the heavy
  RPS and 6× the light RPS. It does not fix latency: each worker still blocks,
  and a light request that lands on a busy worker waits (p99 238 ms). Memory
  grows with every worker (about 110 MB each). On 1 CPU, 4 workers perform
  like 1 worker and use 2.5× the memory.
- **worker_threads** fixes the light endpoint: p99 5 ms on 4 CPUs and 12 ms on
  even 1 CPU, because the OS shares the core between the threads. It does not
  make heavy work cheaper: heavy RPS is lower than with cluster (47 against
  70), because the main thread now also serves 45 000 light RPS on the same
  4 CPUs.
- CPU-heavy code belongs off the event loop (worker_threads or another
  service). cluster or more replicas scale throughput and need real cores.

## Docker CPU limit

These runs used `taskset` because the sandbox where they ran has no access to
the Docker socket. To check the same thing with a Docker CPU limit, build on
the host, then run:

```bash
docker run --rm --cpus=1 -p 3000:3000 -e WEB_CONCURRENCY=4 \
  -v "$PWD":/app -w /app node:24 node dist/cluster.js
# in another terminal
pnpm exec autocannon -c 8 -d 30 http://localhost:3000/heavy &
pnpm exec autocannon -c 50 -d 30 http://localhost:3000/light
```

`--cpus` is a CFS quota, not CPU affinity. Check what `os.availableParallelism()`
returns inside the container, because piscina sizes its pool from it. The
Docker variant was not run.
