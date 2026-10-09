// Checks the cluster rules from the task:
// 1. WEB_CONCURRENCY workers start.
// 2. A worker killed with SIGKILL is replaced.
// 3. Two SIGTERMs in a row stop every worker: requests in flight get their
//    answer, and no worker is started again.
// 4. A worker that does not finish within SHUTDOWN_TIMEOUT_MS is killed.
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const PORT = 3998;
const WORKERS = 2;

function childPids(pid) {
  try {
    return execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(Number);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(what, check, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for: ${what}`);
}

async function answers() {
  try {
    return (await fetch(`http://127.0.0.1:${PORT}/light`)).ok;
  } catch {
    return false;
  }
}

// Starts the cluster and collects the JSON lines it prints.
function startCluster(env) {
  const primary = spawn('node', ['dist/cluster.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      WEB_CONCURRENCY: String(WORKERS),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const events = [];
  primary.stdout.on('data', (chunk) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      events.push(JSON.parse(line));
    }
  });
  const exited = new Promise((resolve) => primary.on('exit', resolve));
  const count = (name) => events.filter((e) => e.event === name).length;
  const kill = () => {
    for (const pid of childPids(primary.pid)) process.kill(pid, 'SIGKILL');
    primary.kill('SIGKILL');
  };
  return { primary, events, exited, count, kill };
}

// Sends GET /heavy and resolves with the status code, or with the error
// message when the connection fails.
function heavyRequest() {
  return fetch(`http://127.0.0.1:${PORT}/heavy`).then(
    (res) => res.status,
    (error) => error.cause?.code ?? error.message,
  );
}

async function checkRestartAndStop() {
  // About 0.5 s per heavy request, so the requests are still running when
  // SIGTERM arrives.
  const app = startCluster({ HEAVY_ITERATIONS: '3000000' });
  try {
    await waitFor(
      `${WORKERS} workers`,
      () => app.count('listening') === WORKERS,
    );
    const before = childPids(app.primary.pid);
    assert.equal(before.length, WORKERS);
    assert.ok(await answers());
    console.log(`ok: ${WORKERS} workers started: ${before.join(', ')}`);

    process.kill(before[0], 'SIGKILL');
    await waitFor(
      'replacement worker',
      () => app.count('listening') === WORKERS + 1,
    );
    const after = childPids(app.primary.pid);
    assert.equal(after.length, WORKERS);
    assert.ok(!after.includes(before[0]));
    const restart = app.events.find((e) => e.event === 'worker-restart');
    assert.equal(restart.exitedAfterDisconnect, false);
    console.log(
      `ok: kill -9 ${before[0]} -> new worker, exitedAfterDisconnect=false, workers now: ${after.join(', ')}`,
    );

    const inFlight = Array.from({ length: 4 }, heavyRequest);
    await sleep(100);
    process.kill(app.primary.pid, 'SIGTERM');
    // Without a pause the kernel may merge the two signals into one.
    await sleep(100);
    process.kill(app.primary.pid, 'SIGTERM');

    assert.deepEqual(await Promise.all(inFlight), [200, 200, 200, 200]);
    assert.equal(await app.exited, 0);
    assert.equal(app.count('stopping'), 1);
    assert.equal(app.count('stopping-already'), 1);
    const stopped = app.events.filter((e) => e.event === 'worker-stopped');
    assert.equal(stopped.length, WORKERS);
    assert.ok(stopped.every((e) => e.exitedAfterDisconnect === true));
    assert.equal(
      app.count('listening'),
      WORKERS + 1,
      'no worker started after SIGTERM',
    );
    assert.ok(after.every((pid) => !alive(pid)));
    assert.ok(!(await answers()));
    console.log(
      'ok: SIGTERM x2 -> 4/4 in-flight requests got 200, exitedAfterDisconnect=true, no restart, primary exit 0',
    );
  } catch (error) {
    app.kill();
    throw error;
  }
}

async function checkShutdownTimeout() {
  // About 3 s per heavy request, longer than the 500 ms shutdown timeout.
  const app = startCluster({
    HEAVY_ITERATIONS: '18000000',
    SHUTDOWN_TIMEOUT_MS: '500',
  });
  try {
    await waitFor(
      `${WORKERS} workers`,
      () => app.count('listening') === WORKERS,
    );
    const stuck = heavyRequest();
    await sleep(100);
    process.kill(app.primary.pid, 'SIGTERM');

    assert.equal(await app.exited, 0);
    assert.equal(app.count('worker-kill'), 1);
    assert.equal(
      app.count('listening'),
      WORKERS,
      'no worker started after SIGTERM',
    );
    const result = await stuck;
    assert.notEqual(result, 200);
    console.log(
      `ok: worker busy past SHUTDOWN_TIMEOUT_MS=500 -> SIGKILL, its request failed (${result}), no restart`,
    );
  } catch (error) {
    app.kill();
    throw error;
  }
}

await checkRestartAndStop();
await checkShutdownTimeout();
