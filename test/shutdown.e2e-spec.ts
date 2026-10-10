import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

// Starts the built app (dist/main.js) as its own process, because only a real
// signal exercises the shutdown hooks set up in main.ts. The child inherits
// the container settings that test/setup/env.ts put in process.env.
const DRAIN_MS = 2000;

let child: ChildProcess | undefined;

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  server.close();
  if (address === null || typeof address === 'string') {
    throw new Error('No port assigned');
  }
  return address.port;
}

async function waitUntilLive(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = await fetch(`${url}/live`).then(
      (res) => res.status,
      () => 0,
    );
    if (status === 200) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('The app did not start within 30 s');
}

// Resolves with how the child process ended. events.once() would type the
// result as any[].
function exitOf(
  process: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    process.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function startApp(): Promise<{ app: ChildProcess; url: string }> {
  const port = await freePort();
  const app = spawn(process.execPath, ['dist/main.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      SHUTDOWN_DRAIN_MS: String(DRAIN_MS),
    },
    stdio: 'ignore',
  });
  child = app;
  const url = `http://127.0.0.1:${port}`;
  await waitUntilLive(url);
  return { app, url };
}

describe('Graceful shutdown (e2e)', () => {
  afterEach(() => {
    child?.kill('SIGKILL');
    child = undefined;
  });

  it('on SIGTERM answers /ready with 503 and /live with 200 during the drain, then exits with code 0', async () => {
    const { app, url } = await startApp();
    const exited = exitOf(app);

    app.kill('SIGTERM');
    // Give the signal handler a moment to start the shutdown.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const ready = await fetch(`${url}/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({ status: 'shutting_down' });
    expect((await fetch(`${url}/live`)).status).toBe(200);

    expect(await exited).toEqual({ code: 0, signal: null });
    await expect(fetch(`${url}/ready`)).rejects.toThrow();
  }, 60_000);

  it('on SIGINT exits with code 0 without the drain wait', async () => {
    const { app } = await startApp();
    const exited = exitOf(app);
    const started = Date.now();

    app.kill('SIGINT');
    expect(await exited).toEqual({ code: 0, signal: null });
    expect(Date.now() - started).toBeLessThan(DRAIN_MS);
  }, 60_000);
});
