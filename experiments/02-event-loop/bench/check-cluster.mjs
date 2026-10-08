// Checks the cluster rules from the task:
// 1. WEB_CONCURRENCY workers start.
// 2. A worker killed with SIGKILL is replaced.
// 3. SIGTERM on the primary stops every worker, and none is restarted.
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
    await sleep(100);
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

const primary = spawn('node', ['dist/cluster.js'], {
  env: { ...process.env, PORT: String(PORT), WEB_CONCURRENCY: String(WORKERS) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const events = [];
primary.stdout.on('data', (chunk) => {
  for (const line of chunk.toString().split('\n').filter(Boolean)) {
    events.push(JSON.parse(line));
  }
});
const listening = () => events.filter((e) => e.event === 'listening').length;

try {
  await waitFor(`${WORKERS} workers listening`, () => listening() === WORKERS);
  const before = childPids(primary.pid);
  assert.equal(before.length, WORKERS);
  assert.ok(await answers());
  console.log(`ok: ${WORKERS} workers started: ${before.join(', ')}`);

  process.kill(before[0], 'SIGKILL');
  await waitFor('replacement worker', () => listening() === WORKERS + 1);
  const after = childPids(primary.pid);
  assert.equal(after.length, WORKERS);
  assert.ok(!after.includes(before[0]));
  console.log(`ok: killed ${before[0]}, workers now: ${after.join(', ')}`);

  process.kill(primary.pid, 'SIGTERM');
  const code = await new Promise((resolve) => primary.on('exit', resolve));
  assert.equal(code, 0);
  assert.ok(after.every((pid) => !alive(pid)));
  assert.equal(listening(), WORKERS + 1, 'no worker started after SIGTERM');
  assert.ok(!(await answers()));
  console.log('ok: SIGTERM stopped the primary and all workers, no restart');
} catch (error) {
  primary.kill('SIGKILL');
  for (const pid of childPids(primary.pid)) process.kill(pid, 'SIGKILL');
  throw error;
}
