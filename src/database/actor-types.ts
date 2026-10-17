// Who made a change: a person acting for the buyer or the seller, a platform
// operator, or the system itself (expiry, auto-confirmation). Shared by
// deal_status_changes and ledger_transfers.
export const ACTOR_TYPES = ['buyer', 'seller', 'operator', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
