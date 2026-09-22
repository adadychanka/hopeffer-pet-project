import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from './prisma.service.js';

describe('PrismaService', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
  });

  afterEach(() => {
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('connects on module init and disconnects on module destroy', async () => {
    const service = new PrismaService();
    const connectSpy = vi
      .spyOn(service, '$connect')
      .mockResolvedValue(undefined);
    const disconnectSpy = vi
      .spyOn(service, '$disconnect')
      .mockResolvedValue(undefined);

    await service.onModuleInit();
    expect(connectSpy).toHaveBeenCalledOnce();

    await service.onModuleDestroy();
    expect(disconnectSpy).toHaveBeenCalledOnce();
  });
});
