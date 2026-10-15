# Feature Specification: Marketplace Data Model

**Feature Branch**: `001-marketplace-data-model`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "I want to design entities and relations between them. Let's focus now on the architecture and design of the entities. No code changes are required. It would be nice to have an ERD as mermaid and drawio schema. Don't care about users and auth right now, security will be handled separately. Requirements: sellers and buyers are companies; lots have a title, a price and a stock (how many units are available), a seller publishes a lot and can hide it; lot photos have metadata and a key in S3; companies have wallets; deals record who bought what from whom, how many units and at what price; the wallet journal records who was topped up, when and by how much, and what was debited and credited. Where money comes from: the platform does not accept or pay out money, external systems do that. When a bank notification about a transfer arrives, an administrator records in the system whose wallet was topped up and by how much. All settlements between buyer and seller happen inside the platform."

## Clarifications

### Session 2026-10-15

- Q: When does the seller get the money? → A: Hybrid of invoice and escrow, with abuse protection. A purchase reserves the stock and issues an invoice with a due date. The buyer pays the invoice from the wallet into a platform escrow. The escrow releases the money to the seller after the buyer confirms delivery. Limits stop a buyer from blocking stock with invoices that are never paid.
- Q: Should this feature leave `docs/architecture/` unchanged and keep the ERD in the spec folder, with the ERD moving into `docs/architecture/` only when the tables are actually built? → A: Yes. The ERD lives in the feature folder. `docs/architecture/` shows only what the system has today, so it does not change in this feature. The feature that implements the entities adds the ERD there.
- Q: The v1 case README says the marketplace doesn't move money and buyers pay sellers by bank transfer, while this spec moves all settlements inside the platform. What should happen to that README? → A: Create a new case version, `docs/system-design/marketplace-v2/`, with the v1 content, the new money flow and the ERD. The v1 folder stays unchanged as a snapshot.
- Q: The root README links to v1 as "everything that is planned". Should that one line change to v2, as an exception to FR-038? → A: Yes. Only that link changes; the rest of the Architecture section stays as is.
- Q: When the operator credited the wrong company and that company already spent the money, may its wallet go below 0? → A: No. The rule "a company wallet never goes below 0" stays. The operator takes back only what is left in the wrong wallet and credits the right company in full at once. The rest is recovered outside the platform; when it comes back by bank transfer, it is recorded as a top-up to the wrong company followed by a negative correction.

## Scope

This feature designs the data model of the marketplace: the entities, their attributes, their relationships and the rules that keep the data consistent. The outcome is documentation. No application behavior changes in this feature.

In scope:

- Companies acting as sellers and buyers.
- Lots, their visibility and their stock.
- Lot photos: descriptive metadata and the key of the stored file.
- Deals, from the purchase to the payout or the refund.
- Invoices with due dates, and stock reservation while an invoice is unpaid.
- Company wallets, platform accounts (escrow, incoming bank money) and the ledger of money movements.
- Wallet top-ups and balance corrections recorded by the platform operator.
- Rules that stop a buyer from blocking stock with unpaid invoices.
- A new version of the system design case, `docs/system-design/marketplace-v2/`, that describes the target system with this money flow.

Out of scope:

- Users, authentication, roles and permissions. Security is a separate feature. Where the model must record _who did it_ (for example, which operator recorded a top-up), it stores an opaque actor reference that the security feature will later link to a user.
- Accepting payments and paying money out. External systems handle real money.
- Integration with banks or payment providers. The operator enters top-ups by hand.
- Sending notifications and invoice reminders, and bonuses for paying on time, from the marketplace v1 case. This model stores the dates and statuses they need; sending and calculating them is a later feature.
- Shipping and logistics. The seller only marks a deal as shipped.
- Dispute handling as a process. The operator can refund a deal, with a reason; the dispute conversation is out of scope.

## Deal lifecycle

One deal moves through these statuses. A status only moves forward along the arrows.

| From             | Event                                                                          | To               | Money                   | Stock                  |
| ---------------- | ------------------------------------------------------------------------------ | ---------------- | ----------------------- | ---------------------- |
| (none)           | Buyer purchases; an invoice is issued                                          | awaiting payment | none                    | reserved (reduced)     |
| awaiting payment | Buyer cancels                                                                  | cancelled        | none                    | returned to the lot    |
| awaiting payment | Payment window plus grace period ends unpaid                                   | expired          | none                    | returned to the lot    |
| awaiting payment | Invoice is paid from the buyer's wallet                                        | paid             | buyer wallet to escrow  | stays reserved         |
| paid             | Seller marks the deal shipped                                                  | shipped          | none                    | stays sold             |
| paid             | Seller cancels, or operator refunds                                            | refunded         | escrow to buyer wallet  | returned to the lot    |
| shipped          | Buyer confirms delivery, or the confirmation window ends without a buyer claim | completed        | escrow to seller wallet | stays sold             |
| shipped          | Buyer raises a claim within the confirmation window                            | disputed         | none                    | stays sold             |
| disputed         | Operator completes the deal                                                    | completed        | escrow to seller wallet | stays sold             |
| disputed         | Operator refunds                                                               | refunded         | escrow to buyer wallet  | not returned (shipped) |

`cancelled`, `expired`, `refunded` and `completed` are final.

## User Scenarios & Testing _(mandatory)_

The scenarios describe what the data model must support. A scenario "passes" when the model can record every fact the scenario produces, and the consistency rules hold after it.

Example platform settings used below: payment window 5 days, grace period 1 day, at most 3 unpaid deals per buyer, prepay-only after 2 expired deals in 30 days, delivery confirmation window 14 days.

### User Story 1 - Buyer purchases units of a lot (Priority: P1)

A buyer company chooses a published lot of another company and buys some units. The platform reserves the units and issues an invoice with a due date. The buyer's wallet does not need to hold the money yet.

**Why this priority**: The deal is the reason the marketplace exists. Reserving stock before the money arrives matters here, because money reaches a wallet only after a bank transfer and a manual top-up, which can take days.

**Independent Test**: Start with a seller company that has a published lot (price 1,000.00, stock 5) and a buyer company with balance 0. Buy 3 units. Check the recorded data.

**Acceptance Scenarios**:

1. **Given** the lot and wallets above, **When** the buyer buys 3 units on 1 March, **Then** one deal exists in status "awaiting payment" with the buyer, the seller, the lot, quantity 3, unit price 1,000.00 and total 3,000.00; one invoice exists for 3,000.00 with a unique number and due date 6 March; the lot's stock is 2; no money has moved.
2. **Given** the deal above, **When** the seller changes the lot's price to 1,200.00, **Then** the deal and the invoice still show unit price 1,000.00 and total 3,000.00.
3. **Given** a buyer whose wallet already holds 5,000.00, **When** the buyer buys 3 units and pays at once, **Then** the deal goes to "paid" in the same step, and 3,000.00 moves from the buyer's wallet to escrow.
4. **Given** a lot with stock 2, **When** a buyer tries to buy 3 units, **Then** no deal and no invoice are created, and the stock does not change.

---

### User Story 2 - Operator records a top-up that pays an invoice (Priority: P1)

The buyer transfers money to the platform's bank account and puts the invoice number in the transfer reference. The operator records the top-up from the bank notification. The money reaches the buyer's wallet, and the open invoice it names is paid from the wallet into escrow.

**Why this priority**: A top-up is the only way money enters the platform. Linking it to an invoice means the buyer does not miss the due date because of a separate manual step.

**Independent Test**: Start with the deal from Story 1 ("awaiting payment", 3,000.00) and a buyer balance of 0. Record a top-up of 3,000.00 that names the invoice. Check the balances, the deal and the ledger.

**Acceptance Scenarios**:

1. **Given** the deal above, **When** the operator records a top-up of 3,000.00 with bank reference "TRX-1" that names the invoice, **Then** the buyer's balance grows by 3,000.00 and goes back to 0; escrow holds 3,000.00; the invoice is "paid"; the deal is "paid".
2. **Given** the same top-up, **When** the ledger is read, **Then** it holds two transfers: incoming bank money to the buyer's wallet (top-up), and the buyer's wallet to escrow (invoice payment). Each transfer shows its time, its actor reference and its source record.
3. **Given** a top-up with bank reference "TRX-1" already exists, **When** the operator records another top-up with bank reference "TRX-1", **Then** the second top-up is rejected and no balance changes.
4. **Given** a top-up that names no invoice, or whose amount is less than the invoice total, **When** it is recorded, **Then** the money stays in the buyer's wallet, and the invoice stays unpaid until the buyer pays it from the wallet.
5. **Given** the operator recorded a top-up with the wrong amount, **When** the operator corrects it, **Then** the original transfer stays unchanged and a new correction transfer, with a reason and the operator reference, restores the right balance.

---

### User Story 3 - Delivery and payout to the seller (Priority: P1)

The seller ships the goods and marks the deal shipped. The buyer confirms delivery, and the escrow releases the money to the seller. If the buyer neither confirms nor raises a claim within the confirmation window, the deal completes on its own.

**Why this priority**: The seller is paid only here. Without it, money stays in escrow forever.

**Independent Test**: Start with a "paid" deal of 3,000.00. Mark it shipped, then confirm delivery. Check the balances and the deal.

**Acceptance Scenarios**:

1. **Given** a paid deal, **When** the seller marks it shipped, **Then** the deal is "shipped" and records the shipping time; no money moves.
2. **Given** a shipped deal, **When** the buyer confirms delivery, **Then** the deal is "completed", and 3,000.00 moves from escrow to the seller's wallet.
3. **Given** a deal shipped on 10 March and no buyer confirmation or claim, **When** 24 March passes, **Then** the deal is "completed" and the seller is paid, and the deal history shows an automatic confirmation.
4. **Given** a deal in "awaiting payment", **When** the seller tries to mark it shipped, **Then** the change is rejected.

---

### User Story 4 - Cancellation, expiry, refund and abuse protection (Priority: P2)

An unpaid deal can be cancelled by the buyer or expire at the due date plus the grace period; the reserved units go back to the lot. A paid deal can be refunded from escrow. A buyer who opens too many unpaid deals, or lets them expire repeatedly, loses the right to reserve stock without paying.

**Why this priority**: Without these rules a buyer can block a seller's stock for free, and money in escrow has no way back to the buyer.

**Independent Test**: With one buyer, open 3 unpaid deals, try a 4th, let 2 expire, then try to reserve again. Check each result.

**Acceptance Scenarios**:

1. **Given** a deal in "awaiting payment" with 3 reserved units, **When** the buyer cancels it, **Then** the deal and the invoice are "cancelled", and the lot's stock grows by 3.
2. **Given** an invoice due on 6 March with a 1-day grace period, **When** 7 March ends unpaid, **Then** the deal is "expired", the invoice is "expired", and the reserved units go back to the lot.
3. **Given** a buyer with 3 deals in "awaiting payment", **When** the buyer tries a 4th purchase without paying at once, **Then** it is rejected. A 4th purchase that is paid at once from the wallet is allowed.
4. **Given** a buyer with 2 expired deals in the last 30 days, **When** the buyer tries a purchase without paying at once, **Then** it is rejected; a purchase paid at once is allowed. After 30 days without a new expiry, reserving is allowed again.
5. **Given** a paid deal that the seller cannot ship, **When** the seller cancels it, **Then** the deal is "refunded", the full amount moves from escrow back to the buyer's wallet, and the units go back to the lot.
6. **Given** a shipped deal, **When** the buyer raises a claim within the confirmation window, **Then** the deal is "disputed" and does not complete on its own.
7. **Given** a disputed deal, **When** the operator refunds it with a reason, **Then** the deal is "refunded" and the full amount moves from escrow to the buyer's wallet; the units do not go back to the lot.

---

### User Story 5 - Seller manages a lot and its photos (Priority: P2)

A seller company creates a lot with a title, a unit price and a stock quantity, adds photos, and publishes it. Later the seller can hide the lot and publish it again.

**Why this priority**: Buyers need lots to buy. The rules here are simpler than the money rules.

**Independent Test**: Create a lot with two photos, publish it, hide it. Check what a buyer can see and buy at each step.

**Acceptance Scenarios**:

1. **Given** a seller, **When** the seller creates a lot, **Then** the lot is hidden until the seller publishes it.
2. **Given** a published lot, **When** the seller hides it, **Then** buyers cannot see or buy it, and existing deals continue unchanged through their lifecycle.
3. **Given** a lot, **When** the seller adds a photo, **Then** the photo records the lot, the key of the stored file, the original file name, the file type, the file size, the image width and height, the display position and the upload time.
4. **Given** a lot with deals, **When** the seller wants to remove it, **Then** the seller can only hide it; the lot record stays, because deals refer to it.

---

### User Story 6 - Company and operator review the money history (Priority: P3)

A company reads its wallet history. The operator reads any wallet and the platform accounts. Every entry shows the time, the amount, the direction, the balance after it, the actor and the cause.

**Why this priority**: Money disputes are settled from this history. It reads data that the stories above already produce.

**Independent Test**: After a top-up, an invoice payment and a payout, read the buyer's, the seller's and the escrow history, and check that each explains its current balance.

**Acceptance Scenarios**:

1. **Given** any account, **When** its history is read, **Then** the sum of its entries equals its current balance.
2. **Given** any transfer, **When** its entries are read, **Then** the amounts taken out equal the amounts put in.
3. **Given** a payout entry on the seller's wallet, **When** its source is followed, **Then** it leads to exactly one deal; that deal leads to its invoice payment from the buyer's wallet with the same amount.

---

### Edge Cases

- Two buyers try to reserve the last unit of a lot at the same time: exactly one deal is created; the other is rejected; the stock never goes below zero.
- One buyer pays two invoices at the same time that together exceed the balance: only those the balance covers are paid; the balance never goes below zero.
- The bank transfer arrives on time, but the operator records it after the deal expired: the money stays in the buyer's wallet; the expired deal does not come back; the buyer can buy again. The grace period exists to make this rare.
- A top-up is larger than the invoice it names: the invoice is paid; the remainder stays in the buyer's wallet.
- A top-up names an invoice that is already paid, cancelled or expired: the money stays in the wallet; nothing is paid.
- A company tries to buy its own lot: rejected.
- A buyer requests 0 or a negative number of units: rejected.
- A lot with stock 0 stays published: buyers see it as sold out and cannot buy it.
- The seller hides a lot that has deals in progress: the deals continue; new purchases are rejected.
- The seller lowers a lot's stock below the units reserved by unpaid deals: impossible, because reserved units are already taken out of the stock.
- A top-up for 0 or a negative amount: rejected. A correction may lower a company balance, but never below zero.
- The operator credited the wrong company, and that company already spent part of the money: the operator takes back only the balance that is left (a negative correction up to the current balance) and credits the right company in full with a positive correction. The rest is recovered outside the platform. When the wrong company sends it back by bank transfer, the operator records a top-up to that company and then a negative correction of the same amount. Until then, the platform's real bank account holds less than the ledger says the companies own; the model does not record that gap.
- A company is both a seller and a buyer: it has one wallet; payouts from its sales and payments for its purchases use the same wallet.
- A photo record exists, but the stored file is missing (or the reverse): the photo record is the source of truth; cleanup of orphaned files is outside this feature.

## Requirements _(mandatory)_

### Functional Requirements

**Companies**

- **FR-001**: The model MUST represent a company as one record that can act as a seller, a buyer, or both.
- **FR-002**: The model MUST give every company exactly one wallet. A new wallet starts with balance 0.

**Lots**

- **FR-003**: The model MUST record for each lot its seller company, title, unit price (greater than 0), available stock (a whole number, 0 or more), visibility status and creation and last-change times.
- **FR-004**: A lot MUST have one of two visibility statuses: hidden or published. A new lot is hidden. The seller can switch between the statuses at any time.
- **FR-005**: Only published lots with available stock above 0 MUST be purchasable.
- **FR-006**: The seller MAY change the title, the price and the available stock of a lot. These changes MUST NOT change any existing deal or invoice.
- **FR-007**: A lot that any deal refers to MUST NOT be deleted.

**Lot photos**

- **FR-008**: The model MUST allow zero or more photos per lot. Each photo belongs to exactly one lot.
- **FR-009**: The model MUST record for each photo: the key of the stored file (unique across all photos), the original file name, the file type, the file size, the image width and height, the display position within the lot and the upload time.

**Deals**

- **FR-010**: The model MUST record each deal with: the buyer company, the seller company, the lot, the quantity (1 or more), the unit price at the moment of purchase, the total amount (quantity × unit price), the status and the purchase time.
- **FR-011**: A deal MUST follow the lifecycle in the "Deal lifecycle" section. No other status change is allowed.
- **FR-012**: Every status change of a deal MUST be recorded with the old status, the new status, the time, the actor reference (or "system" for automatic changes) and, for cancellations and refunds, the reason.
- **FR-013**: A purchase MUST reduce the lot's available stock by the deal quantity at once. A cancelled or expired deal, and a deal refunded before shipping, MUST return the quantity to the lot.
- **FR-014**: The model MUST reject a purchase when the lot is hidden, the available stock is lower than the quantity, the buyer is the seller, or the quantity is less than 1.
- **FR-015**: Each status change, with its stock change and money transfer, MUST be all-or-nothing.
- **FR-016**: Purchases and payments that run at the same time MUST NOT reserve more units than the stock or spend more than a balance.
- **FR-017**: One deal MUST cover one lot. Buying several lots is several deals.

**Invoices**

- **FR-018**: Every deal MUST have exactly one invoice, issued at purchase, with: a unique invoice number, the amount (equal to the deal total), the issue date, the due date (issue date plus the payment window), the status and the payment time.
- **FR-019**: An invoice MUST have one of these statuses: issued, paid, cancelled, expired. It changes together with its deal.
- **FR-020**: An invoice MUST be paid in full, in one payment, from the buyer's wallet. Partial payment is not allowed.
- **FR-021**: An unpaid invoice MUST expire when the grace period after its due date ends. Its deal expires with it.

**Abuse protection**

- **FR-022**: A buyer MUST NOT have more unpaid deals ("awaiting payment") at the same time than the platform limit. A purchase paid at once does not count toward the limit.
- **FR-023**: A buyer with at least the platform limit of expired deals within the look-back period MUST be prepay-only: such a buyer can only make purchases that are paid at once. The restriction ends when the look-back period no longer contains enough expired deals.
- **FR-024**: The payment window, the grace period, the unpaid deal limit, the expiry limit, the look-back period and the delivery confirmation window MUST be platform settings that the operator can change. A change applies to new deals only.

**Accounts and ledger**

- **FR-025**: The model MUST hold money in accounts. Each company wallet is an account. The platform has two accounts of its own: escrow (money paid for deals that are not completed or refunded) and incoming bank money (the counterpart of every top-up and correction).
- **FR-026**: Every money movement MUST be a transfer made of entries on two or more accounts, where the amounts taken out equal the amounts put in.
- **FR-027**: A ledger entry MUST record the account, the amount, the direction (in or out) and the balance of the account after the entry. A transfer MUST record its type, the time, the actor reference and its source record.
- **FR-028**: Transfer types MUST be: top-up (incoming bank money to company wallet), invoice payment (buyer wallet to escrow), payout (escrow to seller wallet), refund (escrow to buyer wallet) and correction (between incoming bank money and a company wallet, either direction).
- **FR-029**: Each transfer MUST point to exactly one source: a top-up, an invoice (for payments), a deal (for payouts and refunds) or a correction.
- **FR-030**: The ledger MUST be append-only. A transfer or an entry is never changed or deleted. A mistake is fixed with a correction that records the operator reference and the reason. A negative correction MUST NOT take a company wallet below 0; an amount the wallet cannot cover is recovered outside the platform.
- **FR-031**: For every account, the balance MUST equal the sum of its entries. A company wallet balance and the escrow balance MUST never go below 0.

**Top-ups**

- **FR-032**: The model MUST record each top-up with: the target company, the amount (greater than 0), the bank transfer reference, the transfer date from the bank notification, the invoice it names (optional), the operator reference and the time it was recorded.
- **FR-033**: The bank transfer reference MUST be unique across all top-ups, so one bank notification cannot be recorded twice.
- **FR-034**: When a top-up names an invoice that is "issued", belongs to the same buyer and is covered by the wallet balance after the top-up, the invoice MUST be paid in the same step.
- **FR-035**: The model MUST NOT contain withdrawals or payouts to bank accounts. Money leaves the platform outside this system.

**Money**

- **FR-036**: All amounts MUST be exact, with no rounding: stored in the smallest currency unit (cents). The platform uses one currency.

**Deliverable**

- **FR-037**: The data model MUST be documented as an entity-relationship diagram in two forms: a text diagram that is readable in the repository (Mermaid), and an editable picture (draw.io). Diagram labels are in English.
- **FR-038**: Both diagrams MUST live in this feature's folder. The current-state architecture documentation (`docs/architecture/` and the Architecture section of the README) MUST NOT change in this feature, because no entity exists in the system yet. The later feature that implements the entities MUST add the ERD to the current-state documentation, updated to match what was built. One exception: the README sentence that links to the planned-systems case ("Everything that is planned is in a separate case") MUST point to `docs/system-design/marketplace-v2/README.md`, with v1 kept as "previous version". It is a pointer to planned work, not a statement about the current system.
- **FR-039**: A new case version `docs/system-design/marketplace-v2/` MUST be created. Its README carries over the v1 case, replaces the v1 assumption that buyers pay sellers outside the platform with the wallet, invoice and escrow flow of this specification, shows the ERD and links to this specification. The ERD it shows MUST be identical to the one in this feature's folder. `docs/system-design/marketplace-v1/` MUST NOT change: it is the snapshot of the previous course step.

### Key Entities _(include if feature involves data)_

- **Company**: A legal entity on the marketplace. Acts as a seller, a buyer, or both. Owns exactly one wallet account and any number of lots.
- **Lot**: Units of one item that a seller offers. Has a title, a unit price, an available stock and a visibility status. Belongs to one seller company. Has photos. Deals refer to it.
- **Lot photo**: Metadata of one image of a lot and the key of the stored file. Belongs to one lot.
- **Deal**: One purchase: buyer, seller, lot, quantity, unit price at purchase, total, status. Has one invoice and a history of status changes.
- **Deal status change**: One step of a deal's lifecycle: old and new status, time, actor reference, reason.
- **Invoice**: The buyer's obligation to pay for one deal: number, amount, issue date, due date, status, payment time.
- **Account**: A place that holds money. Either a company wallet (one per company) or a platform account (escrow, incoming bank money). Its balance is the sum of its entries.
- **Ledger transfer**: One money movement: type, time, actor reference, source (top-up, invoice, deal or correction). Has two or more entries that balance to zero.
- **Ledger entry**: One account's side of a transfer: account, amount, direction, balance after. Never changes after it is written.
- **Top-up**: The operator's record of a bank notification: company, amount, bank reference, transfer date, optional invoice, operator reference. Produces one top-up transfer.
- **Correction**: The operator's fix of a wrong company balance: company, amount, direction, reason, operator reference. Produces one correction transfer.
- **Platform settings**: The limits and time windows of FR-024. Not a business entity; listed so the diagram can show where deals get their due dates and windows.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For 100% of accounts, the balance equals the sum of the account's entries, at any moment.
- **SC-002**: The sum of all account balances, including the platform accounts, is exactly 0 at any moment. Money is never created or destroyed inside the platform.
- **SC-003**: The escrow balance equals the sum of totals of all deals in "paid", "shipped" or "disputed", at any moment.
- **SC-004**: When 10 buyers try at the same time to reserve the last unit of a lot, exactly 1 deal is created, and the stock ends at 0.
- **SC-005**: 100% of seller payouts come from a deal that reached "completed", and 100% of completed deals have exactly one payout of the deal total.
- **SC-006**: 100% of purchases that would exceed the unpaid deal limit, or that come from a prepay-only buyer without immediate payment, are rejected.
- **SC-007**: For 100% of expired, cancelled and refunded-before-shipping deals, the reserved units are back in the lot's stock.
- **SC-008**: 100% of attempts to record the same bank transfer reference twice are rejected.
- **SC-009**: A reviewer can answer each question from the requirements — who bought what, from whom, how many units, at what price; whose wallet was topped up, when and by how much; what was debited and credited — from the diagram alone, in under 5 minutes, without reading this specification.

## Assumptions

- A company can be a seller and a buyer at the same time. One wallet serves both roles.
- The platform uses one currency. Several currencies would need one wallet per currency and are out of scope.
- The platform takes no commission on deals. A commission would add a platform revenue account and one more entry in the payout transfer; the account model allows it.
- Default platform settings: payment window 5 days, grace period 1 day, at most 3 unpaid deals per buyer, prepay-only after 2 expired deals in 30 days, delivery confirmation window 14 days. These are starting values, not business commitments.
- A refund always returns the full deal total. Partial refunds and partial deliveries are out of scope.
- A buyer claim during the confirmation window moves the deal to "disputed", which stops the automatic completion. The operator then refunds the deal or completes it. The claim content belongs to the later dispute feature; this model records only the status change and its reason.
- A wrong top-up that the receiving company already spent is a rare operator error. The platform covers the gap until the money is recovered outside the system; a debt or receivable account for it is out of scope.
- The operator reference and the actor reference are opaque identifiers. The security feature will define users and link the references to them.
- A lot has no categories, descriptions or equipment attributes yet. They can be added later without changing the relationships above.
- Photo files live in object storage. The model stores only the key and the metadata, never the file itself.
- The C4 context and container diagrams in `docs/architecture/` need no change: this feature adds no container, no external system and no running code.
- This feature follows the marketplace v1 case in `docs/system-design/marketplace-v1/`. The v1 case assumed that buyers pay sellers by bank transfer outside the platform. This feature replaces that assumption in a new case version, `docs/system-design/marketplace-v2/`: settlements happen inside the platform through wallets and escrow. Invoices, due dates and the deal statuses keep the v1 reminders, overdue handling, notifications and bonuses possible.
