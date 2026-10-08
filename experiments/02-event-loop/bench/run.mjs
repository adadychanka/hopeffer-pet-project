// Runs every variant under the same load and writes bench/results.md.
//
//   node bench/run.mjs                  # all variants, 3 runs of 30 s each
//   ONLY=cluster DURATION=10 REPEAT=1 node bench/run.mjs
//
// /light gets 50 connections and /heavy gets 8. Eight heavy connections keep
// 4 CPUs busy in every variant. Many more only make the heavy queue deeper:
// with 50, a single process queues 2.5 s of work and light requests hit the
// timeout, so their p99 no longer means anything.
//
// The server is pinned to CPUs 0..N-1 with taskset. Each autocannon runs on
// its own CPUs at the top of the range, so the load generator does not take
// CPU from the server.
import { spawn, execFileSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const DURATION = Number(process.env.DURATION ?? 30);
const LIGHT_CONNECTIONS = Number(process.env.LIGHT_CONNECTIONS ?? 50);
const HEAVY_CONNECTIONS = Number(process.env.HEAVY_CONNECTIONS ?? 8);
const REPEAT = Number(process.env.REPEAT ?? 3);
const ONLY = process.env.ONLY;
const PORT = 3100;
const TOTAL_CPUS = availableParallelism();
const LIGHT_CPUS = `${TOTAL_CPUS - 4},${TOTAL_CPUS - 3}`;
const HEAVY_CPUS = `${TOTAL_CPUS - 2},${TOTAL_CPUS - 1}`;

const VARIANTS = [
  { name: 'light only, no heavy load', script: 'main', cpus: 4, heavy: false },
  { name: 'single process', script: 'main', cpus: 4 },
  { name: 'cluster, 1 worker', script: 'cluster', workers: 1, cpus: 4 },
  { name: 'cluster, 2 workers', script: 'cluster', workers: 2, cpus: 4 },
  { name: 'cluster, 4 workers', script: 'cluster', workers: 4, cpus: 4 },
  { name: 'worker_threads (piscina)', script: 'main', mode: 'pool', cpus: 4 },
  { name: 'single process', script: 'main', cpus: 1 },
  { name: 'cluster, 4 workers', script: 'cluster', workers: 4, cpus: 1 },
  { name: 'worker_threads (piscina)', script: 'main', mode: 'pool', cpus: 1 },
].filter((v) => !ONLY || v.name.includes(ONLY));

if (TOTAL_CPUS < 8) {
  throw new Error(`needs 8 CPUs (4 server + 4 load), found ${TOTAL_CPUS}`);
}

function treePids(pid) {
  const pids = [pid];
  for (let i = 0; i < pids.length; i++) {
    try {
      const out = execFileSync('pgrep', ['-P', String(pids[i])], {
        encoding: 'utf8',
      });
      pids.push(...out.trim().split('\n').filter(Boolean).map(Number));
    } catch {
      // no children
    }
  }
  return pids;
}

// Resident memory of the process and all its children, in MB. Worker
// threads live inside their process, so they are counted too.
function treeRssMb(pid) {
  try {
    const out = execFileSync(
      'ps',
      ['-o', 'rss=', '-p', treePids(pid).join(',')],
      {
        encoding: 'utf8',
      },
    );
    const kb = out
      .trim()
      .split('\n')
      .reduce((sum, line) => sum + Number(line.trim() || 0), 0);
    return kb / 1024;
  } catch {
    return 0;
  }
}

function autocannon(path, cpus, duration, connections) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'taskset',
      [
        '-c',
        cpus,
        'node',
        'node_modules/autocannon/autocannon.js',
        '-j',
        '-c',
        String(connections),
        '-d',
        String(duration),
        '--timeout',
        '20',
        `http://127.0.0.1:${PORT}${path}`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve(JSON.parse(out))
        : reject(new Error(`autocannon exit ${code}`)),
    );
  });
}

function summary(result) {
  return {
    rps: Math.round(result.requests.average),
    p50: result.latency.p50,
    p99: result.latency.p99,
    max: result.latency.max,
    errors: result.errors + result.timeouts + result.non2xx,
  };
}

async function runVariant(variant) {
  const workers = variant.workers ?? 1;
  const cpuList = variant.cpus === 1 ? '0' : `0-${variant.cpus - 1}`;
  const server = spawn(
    'taskset',
    ['-c', cpuList, 'node', `dist/${variant.script}.js`],
    {
      env: {
        ...process.env,
        PORT: String(PORT),
        HEAVY_MODE: variant.mode ?? 'sync',
        WEB_CONCURRENCY: String(workers),
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  let listening = 0;
  let poolThreads;
  server.stdout.on('data', (chunk) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.event === 'listening') {
        listening++;
        poolThreads = event.poolThreads;
      }
    }
  });

  try {
    const start = Date.now();
    while (listening < workers) {
      if (Date.now() - start > 15_000) throw new Error('server did not start');
      await sleep(100);
    }

    // Warm-up: JIT, pool threads, keep-alive sockets.
    await Promise.all([
      autocannon('/light', LIGHT_CPUS, 3, 10),
      variant.heavy === false ? null : autocannon('/heavy', HEAVY_CPUS, 3, 4),
    ]);
    // Lets the server finish heavy requests left over from the warm-up.
    await sleep(1000);

    let peakRssMb = 0;
    const sampler = setInterval(() => {
      peakRssMb = Math.max(peakRssMb, treeRssMb(server.pid));
    }, 500);
    const [light, heavy] = await Promise.all([
      autocannon('/light', LIGHT_CPUS, DURATION, LIGHT_CONNECTIONS),
      variant.heavy === false
        ? null
        : autocannon('/heavy', HEAVY_CPUS, DURATION, HEAVY_CONNECTIONS),
    ]);
    clearInterval(sampler);

    return {
      name: variant.name,
      cpus: variant.cpus,
      poolThreads,
      light: summary(light),
      heavy: heavy ? summary(heavy) : null,
      peakRssMb: Math.round(peakRssMb),
    };
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.on('exit', resolve));
  }
}

function table(results) {
  const rows = [
    '| Variant | CPUs | Light RPS | Light p50, ms | Light p99, ms | Heavy RPS | Heavy p99, ms | Errors | Peak RSS, MB |',
    '| --- | --: | --: | --: | --: | --: | --: | --: | --: |',
  ];
  for (const r of results) {
    const errors = r.light.errors + (r.heavy?.errors ?? 0);
    rows.push(
      `| ${r.name} | ${r.cpus} | ${r.light.rps} | ${r.light.p50} | ${r.light.p99} | ${r.heavy?.rps ?? '-'} | ${r.heavy?.p99 ?? '-'} | ${errors} | ${r.peakRssMb} |`,
    );
  }
  return rows.join('\n');
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Each number in the table is the median of that number over the runs.
function medianResult(runs) {
  const pick = (get) => median(runs.map(get));
  const side = (key) =>
    runs[0][key] === null
      ? null
      : Object.fromEntries(
          Object.keys(runs[0][key]).map((k) => [k, pick((r) => r[key][k])]),
        );
  return {
    ...runs[0],
    light: side('light'),
    heavy: side('heavy'),
    peakRssMb: pick((r) => r.peakRssMb),
    runs,
  };
}

const results = [];
for (const variant of VARIANTS) {
  const runs = [];
  for (let i = 1; i <= REPEAT; i++) {
    process.stderr.write(
      `running: ${variant.name}, ${variant.cpus} CPU, run ${i}/${REPEAT}\n`,
    );
    const result = await runVariant(variant);
    process.stderr.write(`${JSON.stringify(result)}\n`);
    runs.push(result);
  }
  results.push(medianResult(runs));
}

const md = [
  `Load: ${LIGHT_CONNECTIONS} connections on /light and ${HEAVY_CONNECTIONS} on /heavy at the same time, ${DURATION} s, autocannon. Median of ${REPEAT} runs.`,
  `Node ${process.version}, ${TOTAL_CPUS} host CPUs, server pinned with taskset.`,
  '',
  table(results),
  '',
].join('\n');
writeFileSync(new URL('./results.md', import.meta.url), md);
writeFileSync(
  new URL('./results.json', import.meta.url),
  `${JSON.stringify(results, null, 2)}\n`,
);
console.log(md);
