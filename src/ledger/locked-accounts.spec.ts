import { describe, expect, it } from 'vitest';
import { DomainError } from '../http/domain-error.js';
import { LockedAccounts } from './locked-accounts.js';

function accounts() {
  return new LockedAccounts([
    { id: 'wallet', type: 'company_wallet', balanceMinor: 1_000 },
    { id: 'escrow', type: 'escrow', balanceMinor: 0 },
    { id: 'bank', type: 'bank_clearing', balanceMinor: 0 },
  ]);
}

describe('LockedAccounts.apply', () => {
  it('computes each balance after the transfer and keeps it', () => {
    const locked = accounts();

    expect(
      locked.apply([
        { accountId: 'wallet', amountMinor: -400 },
        { accountId: 'escrow', amountMinor: 400 },
      ]),
    ).toEqual([
      { accountId: 'wallet', amountMinor: -400, balanceAfterMinor: 600 },
      { accountId: 'escrow', amountMinor: 400, balanceAfterMinor: 400 },
    ]);
    expect(locked.balanceOf('wallet')).toBe(600);
    expect(locked.balanceOf('escrow')).toBe(400);
  });

  it('starts a second transfer from the balances the first one left', () => {
    const locked = accounts();
    locked.apply([
      { accountId: 'bank', amountMinor: -500 },
      { accountId: 'wallet', amountMinor: 500 },
    ]);

    expect(
      locked.apply([
        { accountId: 'wallet', amountMinor: -1_500 },
        { accountId: 'escrow', amountMinor: 1_500 },
      ])[0].balanceAfterMinor,
    ).toBe(0);
    expect(locked.balanceOf('bank')).toBe(-500);
  });

  it('adds up two legs on the same account', () => {
    const locked = accounts();

    const legs = locked.apply([
      { accountId: 'wallet', amountMinor: -100 },
      { accountId: 'wallet', amountMinor: -100 },
      { accountId: 'escrow', amountMinor: 200 },
    ]);

    expect(legs.map((leg) => leg.balanceAfterMinor)).toEqual([900, 800, 200]);
    expect(locked.balanceOf('wallet')).toBe(800);
  });

  it('rejects a wallet below 0 with insufficient_balance and changes nothing', () => {
    const locked = accounts();

    expect(() =>
      locked.apply([
        { accountId: 'escrow', amountMinor: 1_001 },
        { accountId: 'wallet', amountMinor: -1_001 },
      ]),
    ).toThrow(DomainError);
    expect(locked.balanceOf('wallet')).toBe(1_000);
    expect(locked.balanceOf('escrow')).toBe(0);
  });

  it('rejects bank clearing above 0', () => {
    expect(() =>
      accounts().apply([
        { accountId: 'bank', amountMinor: 1 },
        { accountId: 'wallet', amountMinor: -1 },
      ]),
    ).toThrow(expect.objectContaining({ code: 'insufficient_balance' }));
  });

  it.each([
    [[{ accountId: 'wallet', amountMinor: 0 }], 'at least 2 legs'],
    [
      [
        { accountId: 'wallet', amountMinor: 0 },
        { accountId: 'escrow', amountMinor: 0 },
      ],
      'Invalid leg amount 0',
    ],
    [
      [
        { accountId: 'wallet', amountMinor: 1.5 },
        { accountId: 'escrow', amountMinor: -1.5 },
      ],
      'Invalid leg amount 1.5',
    ],
    [
      [
        { accountId: 'wallet', amountMinor: -1 },
        { accountId: 'escrow', amountMinor: 2 },
      ],
      'sum to 1',
    ],
    [
      [
        { accountId: 'wallet', amountMinor: -1 },
        { accountId: 'other', amountMinor: 1 },
      ],
      'Account other is not locked',
    ],
  ])('rejects wrong legs %j as a bug', (legs, message) => {
    expect(() => accounts().apply(legs)).toThrow(message);
  });

  it('refuses a balance outside the safe integer range', () => {
    const locked = new LockedAccounts([
      {
        id: 'wallet',
        type: 'company_wallet',
        balanceMinor: Number.MAX_SAFE_INTEGER,
      },
      { id: 'bank', type: 'bank_clearing', balanceMinor: 0 },
    ]);

    expect(() =>
      locked.apply([
        { accountId: 'bank', amountMinor: -1 },
        { accountId: 'wallet', amountMinor: 1 },
      ]),
    ).toThrow(RangeError);
  });

  it('rejects reading an account that is not locked', () => {
    expect(() => accounts().balanceOf('other')).toThrow('is not locked');
  });
});
