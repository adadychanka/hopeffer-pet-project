import cluster, { type Worker } from 'node:cluster';
import { bootstrap } from './app.js';

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name] ?? String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, primary: process.pid, ...data }));
}

function runPrimary(): void {
  const count = positiveInt('WEB_CONCURRENCY', 1);
  // A worker that has not exited this long after disconnect() is killed.
  const shutdownTimeoutMs = positiveInt('SHUTDOWN_TIMEOUT_MS', 10_000);
  let stopping = false;
  // Workers the primary waits for during shutdown. cluster.workers is not
  // enough: Node removes a worker from it on 'disconnect', while the worker
  // process may still be finishing requests.
  const stoppingWorkers = new Set<Worker>();

  const liveWorkers = (): Worker[] =>
    Object.values(cluster.workers ?? {}).filter(
      (worker): worker is Worker => worker !== undefined,
    );

  cluster.on('exit', (worker, code, signal) => {
    const exit = {
      pid: worker.process.pid,
      code,
      signal,
      // true only when the worker exited after worker.disconnect(), that is,
      // when the primary stopped it on purpose.
      exitedAfterDisconnect: worker.exitedAfterDisconnect,
    };
    if (worker.exitedAfterDisconnect || stopping) {
      log('worker-stopped', exit);
      stoppingWorkers.delete(worker);
      if (stopping && stoppingWorkers.size === 0) {
        log('primary-stopped');
        process.exit(0);
      }
      return;
    }
    // A crash, an OOM kill or a kill -9: keep the worker count.
    log('worker-restart', exit);
    cluster.fork();
  });

  const stop = (signal: NodeJS.Signals): void => {
    // A second SIGTERM must not start a second shutdown.
    if (stopping) {
      log('stopping-already', { signal });
      return;
    }
    stopping = true;
    log('stopping', { signal, workers: liveWorkers().length });
    if (liveWorkers().length === 0) process.exit(0);
    for (const worker of liveWorkers()) {
      stoppingWorkers.add(worker);
      // The worker stops accepting connections, finishes the requests it
      // has, and exits. Its Nest app closes on the 'disconnect' event.
      worker.disconnect();
      setTimeout(() => {
        if (!worker.isDead()) {
          log('worker-kill', { pid: worker.process.pid, shutdownTimeoutMs });
          worker.process.kill('SIGKILL');
        }
      }, shutdownTimeoutMs).unref();
    }
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  log('primary-started', { workers: count });
  for (let i = 0; i < count; i++) cluster.fork();
}

async function runWorker(): Promise<void> {
  const app = await bootstrap();
  // worker.disconnect() sends no signal, so enableShutdownHooks() does not
  // fire. Close the app here to run the Nest shutdown hooks (thread pool,
  // database connections).
  cluster.worker?.on('disconnect', () => {
    app.close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}

if (cluster.isPrimary) {
  runPrimary();
} else {
  await runWorker();
}
