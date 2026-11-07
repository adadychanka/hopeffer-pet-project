# Business dashboard: is the marketplace working right now?

The top-level dashboard. The on-call engineer opens it first when "something is wrong". It answers one question: **is the business working right now?** It does not explain why something broke. It shows where to look next.

This is a sketch: panels, their layout and what counts as normal on each. Exact queries, colours and pixel layout are decided when the monitoring stack is chosen. Alerts are a separate document.

## Contents

- [Where the data comes from](#where-the-data-comes-from)
- [Layout](#layout)
- [Rules for every panel](#rules-for-every-panel)
- Row 1. Is the business alive?
  - [1. Deals created](#1-deals-created)
  - [2. Payments and GMV](#2-payments-and-gmv)
  - [3. Top-ups](#3-top-ups)
- Row 2. Where does it hurt?
  - [4. Outcomes by error code](#4-outcomes-by-error-code)
  - [5. Overdue but not processed](#5-overdue-but-not-processed)
  - [6. Money reconciles](#6-money-reconciles)
- [Row 3. Why?](#row-3-why)

## Where the data comes from

| What                       | Source                                       | Why                                                                        |
| -------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| Flows: how many per minute | the app: a counter, incremented after commit | real time, no load on the database, labels are free                        |
| Refusals and their reasons | the app                                      | the database never sees a request it rejected                              |
| Money: amounts             | the database                                 | the database is the source of truth, and one table covers both ways to pay |
| States and invariants      | the database                                 | only the database sees what did _not_ happen                               |

Database metrics come from a periodic query on a read replica, every 1–15 minutes. Each app replica keeps its own counters: the dashboard sums them over all replicas, and a counter that resets on restart must not show as a drop.

## Layout

Three rows, read top to bottom. Each row answers one question. If row 1 is green, the on-call engineer is done in 10 seconds.

```
┌─ Row 1. Is the business alive? ──────────────────────────────────────────────┐
│ 1. Deals created          │ 2. Payments and GMV       │ 3. Top-ups           │
│    now / later, vs 1w ago │    count vs 1w ago, GMV   │    count vs 1w ago   │
├─ Row 2. Where does it hurt? ─────────────────────────────────────────────────┤
│ 4. Outcomes by error code (3 groups)  │ 5. Overdue,       │ 6. Money         │
│    ours / client integration / rule   │    not processed  │    reconciles    │
├─ Row 3. Why? ────────────────────────────────────────────────────────────────┤
│ /ready by dependency  │ p95 latency of POST /deals, /top-ups │ App version   │
└──────────────────────────────────────────────────────────────────────────────┘
  Deploy annotations on every time series panel.
```

## Rules for every panel

- **One time range** for all panels (default: last 6 hours), so a drop on one panel is easy to find on its neighbours.
- **Deploy annotations** on every time series: most incidents start with a deploy.
- **Comparison with the same window a week ago** for flows. Traffic has a daily and a weekly cycle, so a fixed number is either noisy at night or silent during the day. A week, not a day: Monday is compared with Monday.
- **Low traffic is grey, not red.** When the same window a week ago had fewer events than the panel's minimum, the panel shows the value without a colour. One missing deal at 4 a.m. is not an incident.
- **"No data" looks different from "0".** An empty panel means metric collection is broken (the app, the periodic database query or the replica), not the business. It shows as a yellow "no data" badge.
- **Every panel links to the next place to look**: a service dashboard or a log query.

## How to read a card

| Field       | Meaning                                                |
| ----------- | ------------------------------------------------------ |
| Question    | What the panel answers, in one sentence                |
| Data        | The metric or query, and its source                    |
| View        | Stat with sparkline, line, stacked area, traffic light |
| Comparison  | A line from a week ago, a fixed threshold, or nothing  |
| Normal      | When the panel is green, yellow or red                 |
| Window      | The aggregation step of one point                      |
| Low traffic | The minimum below which the panel goes grey            |
| Next        | Where to go when the panel is not green                |

---

## Row 1. Is the business alive?

### 1. Deals created

```
┌─ Deals created ───────────────────────────── 6 h, step 5 min ─┐
│  42 / 5 min   ▼ −8% vs 1w ago                       [green]   │
│  ───── now (two colours: pay now / pay later)                 │
│  - - - same time a week ago                                   │
│  ░░░░░ corridor ±30%                                          │
└───────────────────────────────────────────────────────────────┘
```

| Field       | Value                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Question    | Are buyers buying right now?                                                                                                                |
| Data        | A counter of created deals with a `pay_mode` label, summed over all replicas per 5 minutes. App, incremented after the transaction commits. |
| View        | Stat with the current value and the change vs a week ago; line below, one colour per `pay_mode`                                             |
| Comparison  | The same window a week ago, and a ±30% corridor around it                                                                                   |
| Normal      | **Green**: inside the corridor. **Yellow**: 30–50% below, or more than 2× above. **Red**: more than 50% below.                              |
| Window      | 5 minutes. One minute is too noisy.                                                                                                         |
| Low traffic | Grey when the same window a week ago had fewer than 20 deals                                                                                |
| Next        | Service dashboard of `POST /deals` (rate, errors, duration); panel 4 for refusals                                                           |

**Why split by** `pay_mode`**.** The two ways to buy break differently. `pay_mode="now"` depends on wallet balances (`insufficient_balance`). `pay_mode="later"` depends on the limits `unpaid_deal_limit_reached` and `prepay_only`.

**Pitfalls.**

- A retry with the same `idempotency_key` returns the existing deal. It must not increment the counter.
- Increment after commit, never before: a rolled-back transaction is not a deal.
- More than 2× above normal is also suspicious: a client in a retry loop, a bot, or a broken idempotency check.

### 2. Payments and GMV

```
┌─ Payments ───────────────────── 6 h, step 15 min ─┐ ┌─ GMV ─────────── 24 h, step 1 h ─┐
│  118 / 15 min   ▲ +4% vs 1w ago        [green]    │ │  ▇ ▅ ▆ ▇ █ ▆  bars per hour      │
│  ───── now   - - - 1w ago   ░░ ±30%               │ │  - - - 1w ago                    │
└───────────────────────────────────────────────────┘ └──────────────────────────────────┘
```

| Field       | Value                                                                                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Question    | Is money coming in for deals?                                                                                                                                                                             |
| Data        | Invoices that became `paid`, counted and summed by `invoices.paid_at`. Database, every minute. Sketch: `SELECT count(*), sum(amount_minor) FROM invoices WHERE paid_at >= now() - interval '15 minutes'`. |
| View        | Payments: stat and line. GMV: bars per hour in a separate panel.                                                                                                                                          |
| Comparison  | Both with the same window a week ago                                                                                                                                                                      |
| Normal      | **Payments**: green inside ±30%, yellow 30–50% below, red more than 50% below. **GMV**: no colour, it is for context.                                                                                     |
| Window      | Payments: 15 minutes (fewer events than deals). GMV: 1 hour.                                                                                                                                              |
| Low traffic | Grey when the same window a week ago had fewer than 10 payments                                                                                                                                           |
| Next        | Panel 3 (no top-ups means no payments for pay-later deals); panel 4 for `insufficient_balance`                                                                                                            |

**Why the database and not a counter.** An invoice is paid in two places: `POST /deals` with `payNow: true`, and `POST /top-ups` with an `invoiceId`. The `invoices` table sees both. A counter would have to be kept in sync in both code paths. Cross-check: the number of `ledger_transfers` with `type = 'invoice_payment'` in the same window must be the same.

**Why GMV has no colour.** One large deal moves GMV far outside any corridor. The number of payments is the stable signal; GMV shows the size of the business.

**Not here: conversion to payment.** A pay-later deal is paid by bank transfer within `payment_window_days`, which takes days. The share of invoices paid before `expires_at` belongs on a daily product dashboard, not here.

**Needs:** an index that covers `paid_at`, or the query scans the whole table every minute.

### 3. Top-ups

```
┌─ Top-ups ─────────────────────── 6 h, step 30 min ─┐
│  57 / 30 min   ▼ −3% vs 1w ago            [green]  │
│  ───── now   - - - 1w ago   ░░ ±30%                │
│  duplicates from the bank: 2%                      │
└────────────────────────────────────────────────────┘
```

| Field       | Value                                                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Question    | Is money entering the platform from the bank?                                                                                                                                                                                             |
| Data        | Count: a counter of recorded top-ups, summed over all replicas per 30 minutes, app. Amount: sum of `top_ups` recorded in the window, database. Duplicates: share of `bank_reference_already_recorded` among `POST /top-ups` answers, app. |
| View        | Stat and line; the duplicate share as a small number under it                                                                                                                                                                             |
| Comparison  | Same window a week ago, ±30%                                                                                                                                                                                                              |
| Normal      | **Count**: green inside ±30%, yellow 30–50% below, red more than 50% below. **Duplicates**: green below 10%, yellow above.                                                                                                                |
| Window      | 30 minutes: top-ups are rarer than deals                                                                                                                                                                                                  |
| Low traffic | Grey when the same window a week ago had fewer than 10 top-ups                                                                                                                                                                            |
| Next        | The bank integration: its logs and its status page                                                                                                                                                                                        |

**Why it matters.** A top-up is a notification from the bank. A drop usually means the bank channel is broken, not our code. It is a leading metric: with no money in wallets, payments (panel 2) drop an hour later.

**Duplicates.** A few are normal: the bank retries. A spike means the bank is stuck resending the same notifications.

---

## Row 2. Where does it hurt?

### 4. Outcomes by error code

```
┌─ Outcomes of POST /deals, /top-ups, /price-changes ─────── 6 h, step 5 min ─┐
│ Ours (5xx)            0.1%   [green]  ▁▁▁▁▁▁▁▁▁▁▁▁                          │
│ Client integration    0.8%   [green]  ▁▁▂▁▁▁▁▁▁▂▁▁   - - - 1w ago          │
│ Business rule         6.0%   [green]  stacked by code: insufficient_balance,│
│                                       insufficient_stock, prepay_only, …    │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Field       | Value                                                                                                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Question    | Do operations fail, and whose fault is it?                                                                                                                                                                                             |
| Data        | A counter of requests with the labels `route`, `status` and `code`, app. `ProblemDetailsFilter` sets `code` from `ERROR_TABLE`; a success has `code="ok"`. `route` is the template (`/lots/:lotId/price-changes`), never the raw path. |
| View        | Three rows, one per group, each a share of all requests. The business rule row is a stacked area by `code`.                                                                                                                            |
| Comparison  | Ours: a fixed threshold. Client integration and business rule: a week ago.                                                                                                                                                             |
| Normal      | See the table below                                                                                                                                                                                                                    |
| Window      | 5 minutes                                                                                                                                                                                                                              |
| Low traffic | Grey when the window has fewer than 50 requests                                                                                                                                                                                        |
| Next        | Ours: error logs by `code`, the last deploy. Client integration: logs by actor. Business rule: the panel of the matching feature.                                                                                                      |

| Group              | Codes                                                                                                                                                                                                                             | Whose problem         | Normal                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Ours               | `internal_error`, every 5xx                                                                                                                                                                                                       | ours                  | **Green** < 0.5%, **yellow** 0.5–2%, **red** > 2%                                                               |
| Client integration | `validation_failed`, `forbidden_role`, `idempotency_key_reused`, `payload_too_large`                                                                                                                                              | the client or its SDK | Low and steady. **Yellow**: more than 2× a week ago. A jump right after our deploy means we broke the contract. |
| Business rule      | `insufficient_balance`, `insufficient_stock`, `unpaid_deal_limit_reached`, `prepay_only`, `own_lot`, `amount_too_large`, `price_unchanged`, `bank_reference_already_recorded`, the `*_not_found` and `wallet_not_activated` codes | nobody: a rule fired  | Each code's share within ±50% of a week ago. **Yellow** outside it.                                             |

**Why business refusals are on this dashboard.** A jump in `insufficient_stock` at normal traffic is probably a stock-accounting bug, even with no 5xx. A jump in `prepay_only` means many deals expired recently: buyers stopped paying, or invoices expire too early.

**Why** `code` **is a safe label.** The set of codes is fixed by `ERROR_TABLE`, so the number of series stays small. Never label by lot, company or deal id.

### 5. Overdue but not processed

```
┌─ Overdue, not processed ─────── now ─┐
│  Deals past confirmation   0 [green] │
│  Invoices past expiry      0 [green] │
└──────────────────────────────────────┘
```

| Field       | Value                                                                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Question    | Does the background job that moves deals and invoices by time still run?                                                                                                                      |
| Data        | Database, every 5 minutes. Deals: `status = 'shipped' AND confirmation_due_at < now() - interval '15 minutes'`. Invoices: `status = 'issued' AND expires_at < now() - interval '15 minutes'`. |
| View        | Two numbers, traffic light                                                                                                                                                                    |
| Comparison  | Fixed: 0                                                                                                                                                                                      |
| Normal      | **Green**: 0. **Red**: 1 or more.                                                                                                                                                             |
| Window      | The current state. The 15-minute margin covers the job's interval.                                                                                                                            |
| Low traffic | Not applicable: an invariant does not depend on traffic                                                                                                                                       |
| Next        | The job's logs and its last successful run                                                                                                                                                    |

**Why it matters.** When the job dies, the API still answers 200, but sellers' money stays in escrow and the stock of unpaid deals never returns to the catalog. Only the database sees this: the job that stopped writes no metrics.

**Status.** The background job does not exist yet. Until it does, the panel shows "n/a".

### 6. Money reconciles

```
┌─ Money reconciles ──── last check 3 min ago ─┐
│  Balances match the ledger     0  [green]    │
│  Escrow matches open deals     0  [green]    │
│  All balances sum to zero      0  [green]    │
└──────────────────────────────────────────────┘
```

| Field       | Value                                                                                  |
| ----------- | -------------------------------------------------------------------------------------- |
| Question    | Is the money correct?                                                                  |
| Data        | `ledger_mismatches{check}`, the number of failed checks. Database, every 5–15 minutes. |
| View        | Three numbers, traffic light, and the time of the last check                           |
| Comparison  | Fixed: 0                                                                               |
| Normal      | **Green**: 0. **Red**: anything else. **Yellow**: no check for 30 minutes.             |
| Window      | The last check                                                                         |
| Low traffic | Not applicable                                                                         |
| Next        | The reconciliation query by hand, to find the account or the transfer                  |

The checks:

| Check                     | What it compares                                                                                                            | Cost                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Balances match the ledger | `accounts.balance_minor` with `balance_after_minor` of the account's last `ledger_entries` row                              | Cheap. The full sum of all entries grows with the table: run it once a day instead. |
| Escrow matches open deals | The escrow balance with the sum of `total_minor` of deals in `paid`, `shipped` and `disputed`: the money the platform holds | One aggregate over deals by status                                                  |
| All balances sum to zero  | The sum of `balance_minor` over all accounts. Bank clearing is negative and balances the rest.                              | Cheap: one row per account                                                          |

**Not checked here:** "every transfer sums to 0". The deferred trigger `ledger_transfers_balanced` already enforces it at commit. The queries can start from `test/operations/reconciliation.e2e-spec.ts`.

**Why it matters.** It is the only panel that shows the business working _wrongly_ while every other panel is green.

---

## Row 3. Why?

These panels are not business metrics. They point to the cause and to the service dashboard to open next.

| Panel                  | Data                                                                | View                                    | Normal                                                                               |
| ---------------------- | ------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| `/ready` by dependency | The result of each readiness check: Postgres, Redis, S3, OpenSearch | Status history, one line per dependency | All up. One down makes `/ready` answer 503.                                          |
| p95 latency            | p95 from the latency histogram of `POST /deals` and `POST /top-ups` | Line, the same window a week ago dashed | `POST /deals` below 1 s. A rise without a rise in traffic is a lock or a slow query. |
| App version            | The `version` field of the logs (`APP_VERSION`), per replica        | Table                                   | One version, except during a deploy                                                  |

---
