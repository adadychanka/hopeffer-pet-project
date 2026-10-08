import { heavyWork } from './heavy.js';

// Piscina calls the default export in a worker thread.
export default function run(): string {
  return heavyWork();
}
