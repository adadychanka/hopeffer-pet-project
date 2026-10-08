import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Piscina } from 'piscina';
import { heavyWork } from './heavy.js';

export type HeavyMode = 'sync' | 'pool';

@Injectable()
export class HeavyService implements OnApplicationShutdown {
  readonly mode: HeavyMode =
    process.env.HEAVY_MODE === 'pool' ? 'pool' : 'sync';

  // Piscina sizes the pool from os.availableParallelism(), which follows the
  // CPU affinity that taskset sets.
  private readonly pool =
    this.mode === 'pool'
      ? new Piscina({
          filename: new URL('./heavy.worker.js', import.meta.url).href,
        })
      : undefined;

  get poolThreads(): { min: number; max: number } | undefined {
    return this.pool
      ? { min: this.pool.options.minThreads, max: this.pool.options.maxThreads }
      : undefined;
  }

  async run(): Promise<string> {
    if (this.pool) {
      return (await this.pool.run(undefined)) as string;
    }
    return heavyWork();
  }

  // Nest calls this after the HTTP server has closed, so requests that wait
  // for the pool still get their answer. close() lets queued tasks finish.
  async onApplicationShutdown(): Promise<void> {
    await this.pool?.close();
  }
}
