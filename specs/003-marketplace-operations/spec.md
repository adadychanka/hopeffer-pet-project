# Feature Specification: Marketplace Operations

**Feature Branch**: `003-marketplace-operations`

**Created**: 2026-10-17

**Status**: Draft

**Input**: User description: "Implement three marketplace operations on top of the existing marketplace schema: (1) Top up wallet, (2) Update the price of a lot, (3) Buy a lot."

## Clarifications

### Session 2026-10-17

- Q: When a top-up names an open invoice of the same company, and the new balance covers it, what happens? → A: The invoice is paid from the wallet in the same step (FR-034 of feature 001). The deal moves to "paid".
- Q: How do companies, wallets and lots come to exist for these operations? → A: Only as test data. Creating companies, activating wallets and creating or publishing lots belong to later features.

## Scope

This feature adds the first business operations on top of the schema that feature 002 built. The rules come from the data model of feature 001 ([`spec.md`](../001-marketplace-data-model/spec.md), [`data-model.md`](../001-marketplace-data-model/data-model.md)) and the named database rules of feature 002 ([`schema-rules.md`](../002-marketplace-schema/contracts/schema-rules.md)). This feature does not change the schema unless the plan shows that an operation cannot work without a change.

In scope:

- **Top up wallet**: the operator records a bank notification, and the money reaches the company's wallet.
- **Update the price of a lot**: the seller or the operator sets a new unit price, and the price history records it.
- **Buy a lot**: a buyer company buys units of a published lot of another company. The units are reserved, a deal and an invoice are created, and the buyer can pay at once from the wallet.

Out of scope:

- Users, authentication and permissions. The caller states who acts (an opaque actor reference), as in features 001 and 002. The security feature checks it later.
- The rest of the deal lifecycle: cancel, expire, ship, confirm, claim, refund, payout.
- Balance corrections, changes to platform settings, and changes to a lot's title, stock, visibility or photos.

## User Scenarios & Testing _(mandatory)_

Example platform settings used below (the seeded defaults): payment window 5 days, grace period 1 day, at most 3 unpaid deals per buyer, prepay-only after 2 expired deals in 30 days.

### User Story 1 - Buyer buys units of a lot (Priority: P1)

A buyer company chooses a published lot of another company and buys some units. The platform reserves the units at once, creates a deal at the current price, and issues an invoice with a due date. If the buyer asks to pay at once and the wallet covers the total, the invoice is paid from the wallet into escrow in the same step.

**Why this priority**: A purchase is the reason the marketplace exists. It is also the operation with the most rules: stock, limits, prices and money.

**Independent Test**: Prepare a seller with a published lot (price 1,000.00, stock 5) and a buyer with a wallet. Buy 3 units. Check the deal, the invoice, the stock and the balances.

**Acceptance Scenarios**:

1. **Given** the lot above and a buyer with balance 0, **When** the buyer buys 3 units on 1 March without paying at once, **Then** one deal exists in "awaiting payment" with quantity 3, unit price 1,000.00 and total 3,000.00; one invoice for 3,000.00 is "issued" with due date 6 March and expiry date 7 March; the lot's stock is 2; no money moves.
2. **Given** a buyer whose wallet holds 5,000.00, **When** the buyer buys 3 units and pays at once, **Then** the deal is "paid", its history shows "awaiting payment" and then "paid", the invoice is "paid", the buyer's balance is 2,000.00 and escrow grows by 3,000.00.
3. **Given** a buyer whose wallet holds 2,000.00, **When** the buyer buys 3 units and asks to pay at once, **Then** the purchase is rejected with "insufficient balance"; no deal is created and the stock does not change.
4. **Given** a lot with stock 2, **When** a buyer tries to buy 3 units, **Then** the purchase is rejected with "not enough stock", and nothing changes.
5. **Given** a purchase that succeeded, **When** the buyer's client sends the same purchase again with the same idempotency key, **Then** the response describes the existing deal and no second deal is created.
6. **Given** a buyer with 3 deals in "awaiting payment", **When** the buyer tries a 4th purchase without paying at once, **Then** it is rejected with "too many unpaid deals"; the same purchase paid at once is allowed.
7. **Given** a buyer with 2 expired deals in the last 30 days, **When** the buyer tries a purchase without paying at once, **Then** it is rejected with "prepay only"; the same purchase paid at once is allowed.

---

### User Story 2 - Operator tops up a company wallet (Priority: P1)

A company sends money to the platform's bank account. The operator records the bank notification: the company, the amount, the bank reference, the transfer date and, if the payment reference names one, the invoice. The money reaches the company's wallet. If the top-up names an open invoice of the same company, and the new balance covers it, the invoice is paid from the wallet into escrow in the same step.

**Why this priority**: A top-up is the only way money enters the platform. Without it, no buyer can pay.

**Independent Test**: Prepare a company with a wallet at balance 0. Record a top-up of 3,000.00. Check the balance, the top-up record and the ledger.

**Acceptance Scenarios**:

1. **Given** a company with balance 0, **When** the operator records a top-up of 3,000.00 with bank reference "TRX-1", **Then** the company's balance is 3,000.00, the incoming bank money account goes down by 3,000.00, and the ledger holds one top-up transfer with two entries, the operator reference and the top-up as its source.
2. **Given** a top-up with bank reference "TRX-1" exists, **When** the operator records another top-up with bank reference " trx-1" (same reference, other letter case and spacing), **Then** it is rejected with "already recorded" and no balance changes.
3. **Given** a company without a wallet, **When** the operator records a top-up for it, **Then** it is rejected with "wallet not activated", and nothing is recorded.
4. **Given** any top-up, **When** the amount is 0 or negative, **Then** it is rejected and nothing is recorded.
5. **Given** a deal in "awaiting payment" with an "issued" invoice for 3,000.00 and a buyer balance of 0, **When** the operator records a top-up of 3,000.00 for the buyer that names the invoice, **Then** the ledger holds two transfers (the top-up, then the invoice payment from the wallet to escrow); the buyer's balance is 0; escrow grows by 3,000.00; the invoice and the deal are "paid".
6. **Given** the same deal, **When** the top-up names the invoice but is only 2,000.00 and the wallet held 0, **Then** the wallet holds 2,000.00 and the invoice and the deal stay unpaid.
7. **Given** a top-up that names an invoice of another company, or an invoice that is not "issued", **When** it is recorded, **Then** the money stays in the company's wallet and no invoice changes.

---

### User Story 3 - Seller changes the price of a lot (Priority: P2)

The seller, or the operator on the seller's behalf, sets a new unit price for a lot. New purchases use the new price. Deals and invoices that already exist keep the price the buyer agreed to.

**Why this priority**: Sellers need to react to the market, but the marketplace can run with fixed prices for a while.

**Independent Test**: Prepare a lot at 1,000.00 with one deal. Change the price to 1,200.00. Check the lot, the price history and the deal.

**Acceptance Scenarios**:

1. **Given** a lot at 1,000.00, **When** the seller sets the price to 1,200.00, **Then** the lot's price is 1,200.00 and the price history gains one row "from 1,000.00 to 1,200.00" with the time, the actor type "seller" and the actor reference.
2. **Given** a deal for that lot at 1,000.00, **When** the price changes to 1,200.00, **Then** the deal and its invoice still show unit price 1,000.00 and total 3,000.00.
3. **Given** a lot at 1,000.00, **When** the seller sets the price to 1,000.00, **Then** the request is rejected with "price unchanged", and no history row is added.
4. **Given** a lot of seller A, **When** company B tries to change its price as the seller, **Then** the request is rejected with "not the seller of this lot" if the lot is published, or "lot not found" if it is hidden, so hidden lots stay invisible to other companies; nothing changes.
5. **Given** any lot, **When** the new price is 0, negative or not a whole number of cents, **Then** the request is rejected and nothing changes.

---

### Edge Cases

- Two buyers try to buy the last unit at the same time: exactly one purchase succeeds; the other gets "not enough stock"; the stock never goes below 0.
- One buyer makes two purchases paid at once at the same time that together exceed the balance: only those the balance covers succeed; the balance never goes below 0.
- One buyer sends two purchases with the same idempotency key at the same time: exactly one deal is created, and both responses describe it.
- The same idempotency key is reused with a different lot or quantity: the purchase is rejected with "idempotency key reused"; the first deal stays unchanged.
- Two price changes of one lot arrive at the same time: both are applied one after the other; the history shows both, and each row's old price is the previous row's new price.
- The price changes while a purchase is in progress: the deal gets either the old or the new price, never a mix, and the invoice matches the deal.
- A buyer tries to buy their own lot: rejected with "cannot buy your own lot".
- A buyer tries to buy a hidden lot, an unknown lot, or a lot with stock 0: rejected; the response does not reveal a hidden lot's details.
- A buyer requests 0 units, a negative number or a fraction: rejected.
- A total above the largest exact amount the platform stores: rejected, not rounded.
- A buyer or a seller has no wallet: the purchase is rejected with "wallet not activated".
- A top-up names an invoice whose deal already expired: the money stays in the wallet and the expired deal does not come back.
- A top-up is larger than the invoice it names: the remainder stays in the wallet.
- Two top-ups with the same bank reference arrive at the same time: exactly one is recorded.
- Two top-ups with different bank references name the same invoice at the same time: the invoice is paid once; the other top-up's money stays in the wallet.
- The price of a hidden lot changes: allowed; the lot stays hidden.

## Requirements _(mandatory)_

### Functional Requirements

**General**

- **FR-001**: Each operation MUST be all-or-nothing: either every record it writes is saved, or none is.
- **FR-002**: Each operation MUST record who acted: an actor type and an opaque actor reference supplied by the caller.
- **FR-003**: Each rejection MUST tell the caller the reason as a stable, machine-readable code and a human-readable message. A rejection caused by a database rule MUST map to the same code as the check the service makes before it.
- **FR-004**: All amounts MUST be whole numbers of minor units (cents). An amount that is not a whole number, or that exceeds the largest exact amount the platform stores, MUST be rejected, never rounded.
- **FR-005**: Every operation MUST keep the ledger invariants of feature 001: each account's balance equals the sum of its entries, all balances together sum to 0, and escrow equals the totals of paid deals.

**Top up wallet**

- **FR-006**: The operator MUST be able to record a top-up with: the company, the amount (greater than 0), the bank reference, the transfer date from the bank notification, and optionally the invoice the payment reference names.
- **FR-007**: The system MUST normalize the bank reference (upper case, no whitespace) before it stores or compares it, and MUST reject a reference that is already recorded.
- **FR-008**: A recorded top-up MUST move the amount from the incoming bank money account to the company's wallet in one transfer, with the operator as the actor and the top-up as its source.
- **FR-009**: A top-up for a company without a wallet MUST be rejected.
- **FR-010**: A top-up that names an invoice MUST store the link. An invoice of another company, or one that is not "issued", MUST NOT be changed by the top-up.
- **FR-010a**: When a top-up names an "issued" invoice of the same company, and the wallet balance after the top-up covers the invoice amount, the same step MUST pay the invoice: move the amount from the wallet to escrow in an invoice payment transfer, mark the invoice "paid" with the payment time, and move the deal to "paid" with a status change. The operator is the actor of both transfers and of the status change. If the balance does not cover the invoice, the top-up is still recorded and the invoice stays "issued".

**Update the price of a lot**

- **FR-011**: The seller of a lot, or the operator, MUST be able to set a new unit price greater than 0 for any lot, hidden or published.
- **FR-012**: A price change MUST update the lot's current price and add one price history row with the old price, the new price, the time, the actor type and the actor reference.
- **FR-013**: A price equal to the current price MUST be rejected, and no history row is added.
- **FR-014**: A seller MUST NOT change the price of another seller's lot.
- **FR-015**: A price change MUST NOT change any existing deal or invoice.

**Buy a lot**

- **FR-016**: A buyer company MUST be able to buy a quantity (a whole number, 1 or more) of one lot, with an idempotency key generated by its client and a choice to pay at once or later.
- **FR-017**: A purchase MUST be rejected when the lot is unknown or hidden, the stock is lower than the quantity, the buyer is the seller, or the buyer or the seller has no wallet.
- **FR-018**: A purchase MUST reduce the lot's stock by the quantity, create a deal in "awaiting payment" with the lot's current price as the unit price and quantity × unit price as the total, record the first status change, and issue an invoice for the total with a unique number, a due date (issue time plus the payment window) and an expiry date (due date plus the grace period).
- **FR-019**: A purchase without immediate payment MUST be rejected when the buyer already has the platform limit of deals in "awaiting payment", or when the buyer is prepay-only (at least the expiry limit of expired deals within the look-back period).
- **FR-020**: A purchase paid at once MUST, in the same step, move the total from the buyer's wallet to escrow, mark the invoice "paid" with the payment time, and move the deal to "paid" with a second status change. If the balance does not cover the total, the whole purchase MUST be rejected.
- **FR-021**: A repeated purchase with the same buyer and idempotency key MUST return the existing deal in its current state and change nothing. A reused key with a different lot or quantity MUST be rejected. A different payment choice alone is answered as a repeat, because the deal does not record the choice (plan research R9).
- **FR-022**: Purchases that run at the same time MUST NOT reserve more units than the stock or spend more than a balance.

### Key Entities _(include if feature involves data)_

All entities exist already (feature 002). This feature writes to them:

- **Top-up**: the operator's record of one bank notification. Created by "Top up wallet".
- **Ledger transfer and entries**: one money movement and its sides. Created by "Top up wallet" (type top-up, and type invoice payment when the top-up pays an invoice) and by a purchase paid at once (type invoice payment).
- **Account**: a company wallet, escrow, or incoming bank money. Its balance changes with each transfer.
- **Lot**: its current price changes with "Update the price of a lot"; its stock goes down with "Buy a lot".
- **Lot price change**: one row per price change.
- **Deal, deal status change, invoice**: created by "Buy a lot". A purchase paid at once also moves the deal and the invoice to "paid".
- **Platform settings**: read by "Buy a lot" for the payment window, the grace period and the limits.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: When 10 buyers try at the same time to buy the last unit of a lot, exactly 1 purchase succeeds and the stock ends at 0.
- **SC-002**: When one buyer sends 10 purchases paid at once at the same time that together need twice the balance, the balance never goes below 0 and the successful purchases total no more than the starting balance.
- **SC-003**: After any mix of the three operations, 100% of accounts have a balance equal to the sum of their entries, the sum of all balances is 0, and escrow equals the totals of paid deals.
- **SC-004**: 100% of attempts to record the same bank reference twice, in any letter case or spacing, are rejected.
- **SC-005**: 100% of repeated purchases with the same idempotency key, sent one after the other or at the same time, leave exactly one deal.
- **SC-006**: 100% of purchases that break the unpaid deal limit or the prepay-only rule without immediate payment are rejected, and 100% of the same purchases paid at once are allowed when the balance covers them.
- **SC-007**: For 100% of price changes, the lot's current price equals the newest history row, and no existing deal or invoice changes.
- **SC-008**: Every rejection listed in the scenarios and edge cases returns its own documented reason code.
- **SC-009**: 100% of top-ups that name an "issued" invoice of the same company and cover it leave that invoice paid exactly once; 100% of other top-ups leave every invoice unchanged.

## Assumptions

- Companies, wallets and lots already exist when these operations run. Tests create them as data. Creating companies, activating wallets and creating or publishing lots belong to later features, so the operations cannot be used end to end through the API yet.
- A buyer who bought without paying at once pays through a top-up that names the invoice. A separate "pay an invoice from the wallet" operation is a later feature.
- The operations are offered to client applications over the platform's HTTP API. Until the security feature exists, the caller states the actor type and reference, and the system trusts them.
- "Top up wallet" is an operator action. "Update the price" is a seller or operator action. "Buy a lot" is a buyer action.
- The payment window, grace period, unpaid limit, expiry limit and look-back period are read from platform settings at the moment of purchase. The due and expiry dates are stored on the invoice, so a later settings change does not move them.
- The look-back period for the prepay-only rule is counted from the moment of purchase, over the expiry dates of the buyer's expired deals.
- One currency, no commission, no partial payments, as in feature 001.
- Response time follows normal web API expectations: each operation answers within 1 second under normal load.
