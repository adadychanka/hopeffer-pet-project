import cluster, { type Worker } from 'node:cluster';
import { bootstrap } from './app.js';

function workerCount(): number {
  const raw = process.env.WEB_CONCURRENCY ?? '1';
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`WEB_CONCURRENCY must be a positive integer, got "${raw}"`);
  }
  return count;
}

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, primary: process.pid, ...data }));
}

function runPrimary(): void {
  const count = workerCount();
  let stopping = false;

  const liveWorkers = (): Worker[] =>
    Object.values(cluster.workers ?? {}).filter(
      (worker): worker is Worker => worker !== undefined,
    );

  cluster.on('exit', (worker, code, signal) => {
    if (stopping) {
      log('worker-stopped', { pid: worker.process.pid, code, signal });
      if (liveWorkers().length === 0) {
        log('primary-stopped');
        process.exit(0);
      }
      return;
    }
    // A crash, an OOM kill or a kill -9: keep the worker count.
    log('worker-restart', { pid: worker.process.pid, code, signal });
    cluster.fork();
  });

  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    log('stopping', { signal, workers: liveWorkers().length });
    if (liveWorkers().length === 0) process.exit(0);
    for (const worker of liveWorkers()) worker.process.kill('SIGTERM');
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  log('primary-started', { workers: count });
  for (let i = 0; i < count; i++) cluster.fork();
}

if (cluster.isPrimary) {
  runPrimary();
} else {
  await bootstrap();
}
