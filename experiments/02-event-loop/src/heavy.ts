import { pbkdf2Sync } from 'node:crypto';

// About 50 ms of CPU on a modern core. HEAVY_ITERATIONS changes it.
const ITERATIONS = Number(process.env.HEAVY_ITERATIONS ?? 300_000);

// Synchronous on purpose: while it runs, the thread that calls it does
// nothing else.
export function heavyWork(): string {
  return pbkdf2Sync('password', 'salt', ITERATIONS, 64, 'sha512').toString(
    'hex',
  );
}
