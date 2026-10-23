// Shared pieces of the operation tests: the booted app, actor headers and
// ledger checks. Every test creates its own companies, wallets and lots (the
// fixtures in test/schema/helpers.ts), because all e2e files share one
// database and run in parallel. The escrow and bank clearing rows are shared
// too, so tests never assert their balances or a global sum; they check
// their own wallets and their own ledger entries.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { expect } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import type { Queryable } from '../schema/helpers.js';

export interface BootedApp {
  app: INestApplication<App>;
  db: DataSource;
}

// Once per test file, in beforeAll; close the app in afterAll.
export async function bootApp(): Promise<BootedApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  await app.init();
  return { app, db: app.get(DataSource) };
}

export function operatorHeaders(ref = 'operator-1'): Record<string, string> {
  return { 'X-Actor-Role': 'operator', 'X-Actor-Ref': ref };
}

export function companyHeaders(
  companyId: string,
  ref = 'person-1',
): Record<string, string> {
  return {
    'X-Actor-Role': 'company',
    'X-Actor-Ref': ref,
    'X-Company-Id': companyId,
  };
}

export function expectProblem(
  response: Response,
  status: number,
  code: string,
): void {
  expect(
    {
      status: response.status,
      code: (response.body as { code?: string }).code,
    },
    JSON.stringify(response.body),
  ).toEqual({ status, code });
  expect(response.headers['content-type']).toMatch(
    /^application\/problem\+json/,
  );
}

// SC-003 for the given companies' wallets: the balance equals the sum of the
// wallet's entries, and the newest entry's balance_after_minor equals it.
export async function expectWalletConsistent(
  db: Queryable,
  companyIds: string[],
): Promise<void> {
  const rows = (await db.query(
    `SELECT a.company_id, a.balance_minor,
            COALESCE(SUM(e.amount_minor), 0) AS entries_sum,
            (SELECT balance_after_minor FROM ledger_entries
              WHERE account_id = a.id ORDER BY id DESC LIMIT 1) AS last_after
     FROM accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
     WHERE a.company_id = ANY($1::uuid[])
     GROUP BY a.id`,
    [companyIds],
  )) as {
    company_id: string;
    balance_minor: string;
    entries_sum: string;
    last_after: string | null;
  }[];
  expect(rows).toHaveLength(companyIds.length);
  for (const row of rows) {
    expect(row.entries_sum, row.company_id).toBe(row.balance_minor);
    expect(row.last_after ?? '0', row.company_id).toBe(row.balance_minor);
  }
}
