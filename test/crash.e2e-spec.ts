import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:net';

// Starts the built app (dist/main.js) as its own process with a setting that
// stops it from starting, and reads what it leaves on stdout. stdout is a pipe
// here, not a terminal, so the app must report the crash as JSON. The child
// inherits NODE_ENV=test, which silences the app logs but never the crash line.
let child: ChildProcess | undefined;
let blocker: Server | undefined;

interface Crash {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runApp(env: Record<string, string>): Promise<Crash> {
  const app = spawn(process.execPath, ['dist/main.js'], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child = app;
  let stdout = '';
  let stderr = '';
  app.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  app.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const [code] = (await once(app, 'close')) as [number | null];
  return { code, stdout, stderr };
}

function jsonLines(stdout: string): Record<string, unknown>[] {
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('Crash reporting (e2e)', () => {
  afterEach(async () => {
    child?.kill('SIGKILL');
    child = undefined;
    if (blocker) {
      blocker.close();
      await once(blocker, 'close');
      blocker = undefined;
    }
  });

  it('reports an invalid environment as one fatal JSON line and exits with code 1', async () => {
    const { code, stdout, stderr } = await runApp({
      DATABASE_URL: 'not-a-url',
      APP_VERSION: 'abc1234',
    });

    expect(code).toBe(1);
    expect(stderr).toBe('');
    // JSON.parse fails on plain text, so this also proves stdout is JSON only.
    const lines = jsonLines(stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'fatal',
      service: 'hopeffer-pet-project',
      version: 'abc1234',
      msg: 'Application failed to start',
      err: {
        message: expect.stringMatching(
          /Invalid environment variables:[\s\S]*DATABASE_URL/,
        ) as string,
      },
    });
  }, 60_000);

  it('reports a failure after the app has started its services, here a port in use', async () => {
    blocker = createServer();
    blocker.listen(0);
    await once(blocker, 'listening');
    const address = blocker.address();
    if (address === null || typeof address === 'string') {
      throw new Error('No port assigned');
    }

    const { code, stdout } = await runApp({ PORT: String(address.port) });

    expect(code).toBe(1);
    const lines = jsonLines(stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'fatal',
      msg: 'Application failed to start',
      err: { code: 'EADDRINUSE' },
    });
  }, 60_000);
});
