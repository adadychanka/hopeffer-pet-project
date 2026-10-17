// Story 5: the pipeline fails when the entities and the migrations disagree,
// or when an entity is not registered by any feature module.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { entityClasses, openTestDataSource } from './helpers.js';

describe('schema drift', () => {
  let db: DataSource;

  beforeAll(async () => {
    db = await openTestDataSource();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('needs no schema change: the migrations build exactly what the entities declare', async () => {
    // The same computation as `typeorm migration:generate --check`.
    const sql = await db.driver.createSchemaBuilder().log();
    expect(sql.upQueries.map((query) => query.query)).toEqual([]);
  });
});

describe('entity registration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('registers every *.entity.ts class in a feature module, with schema sync off', () => {
    const dataSource = app.get(DataSource);
    expect(
      new Set(dataSource.entityMetadatas.map((metadata) => metadata.target)),
    ).toEqual(new Set(entityClasses()));
    expect(dataSource.options.synchronize).not.toBe(true);
  });
});
