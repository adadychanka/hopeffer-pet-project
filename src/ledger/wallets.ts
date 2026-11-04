import type { EntityManager } from 'typeorm';
import { DomainError } from '../http/domain-error.js';

// The id of a company's wallet. Rejects an unknown company with
// company_not_found, and a company without a wallet with
// wallet_not_activated (a wallet is a separate step, feature 002).
export async function walletIdOf(
  manager: EntityManager,
  companyId: string,
): Promise<string> {
  const rows = await manager.query<{ wallet_id: string | null }[]>(
    `SELECT a.id AS wallet_id FROM companies c
     LEFT JOIN accounts a ON a.company_id = c.id
     WHERE c.id = $1`,
    [companyId],
  );
  if (rows.length === 0) {
    throw new DomainError('company_not_found');
  }
  if (rows[0].wallet_id === null) {
    throw new DomainError(
      'wallet_not_activated',
      'The company has no wallet yet.',
    );
  }
  return rows[0].wallet_id;
}
