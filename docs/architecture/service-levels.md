# Service levels

What we measure on the paths users depend on (SLI), the targets (SLO), what we promise in a contract (SLA), and the alerts on the targets. Business symptoms (deals dropped, money does not reconcile, top-ups stalled) are covered by the [business alerts](business-alerts.md) and the [business dashboard](business-dashboard.md).

## Contents

- [Terms](#terms)
- [SLIs](#slis)
- [SLOs](#slos)
- [SLA](#sla)
- [SLO alerts](#slo-alerts)
- [Not covered yet](#not-covered-yet)
- [Known gaps](#known-gaps)

## Terms

| Term | Meaning                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------- |
| SLI  | Service level indicator: the share of good events among all valid events                           |
| SLO  | Service level objective: the target for an SLI over a window, for example 99.9% over 28 days       |
| SLA  | Service level agreement: what we promise a customer in a contract, and what we pay when we miss it |

---

## SLIs

A buyer finds a lot in the feed, opens its card and creates a deal. One SLI covers each step:

| SLI              | Route                                           | Status  | Why                                                                                                 |
| ---------------- | ----------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| 1. Deal creation | `POST /deals`                                   | exists  | Money moves here. A failed deal is a lost sale.                                                     |
| 2. Lot card      | `GET /lots/:lotId`                              | planned | The buyer decides here. A failed card stops a deal that the deal SLI never sees.                    |
| 3. Lots feed     | feed and search routes, for example `GET /lots` | planned | Most buyers start here. Separate from the card: the feed reads OpenSearch, the card reads Postgres. |

Each SLI measures availability: `requests with status < 500 / all answered requests` on its routes. An SLI on a planned route starts when the route exists.

**Rules.**

- **A 4xx is good.** A rule or the client's input refused the request: `insufficient_stock`, `validation_failed`, `lot_not_found`, an empty search result. 4xx spikes are on [dashboard panel 4](business-dashboard.md#4-outcomes-by-error-code).
- **A request the client cancelled before the answer is not counted.** Nobody saw the result.
- **Source: the app.** The request counter of dashboard panel 4 (`route`, `status`, `code`), summed over replicas. No new metric is needed. The app sees only the requests that reach it: see [Known gaps](#known-gaps).
- **An unmapped database rule is bad.** A race that breaks a rule is mapped to a 4xx by `src/http/constraint-errors.ts`. A rule that is not mapped answers 500: that is a bug.

---

## SLOs

All SLOs use a **28-day rolling window**.

| SLI              | Target    | Error budget | Why this target                                                                                                     |
| ---------------- | --------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| 1. Deal creation | **99.9%** | 40 min       | The money path. At 99%, the budget is 6.7 hours: almost a working day of failed deals.                              |
| 2. Lot card      | **99.9%** | 40 min       | Reads the same Postgres as deals, so it cannot stay more reliable than deals for long.                              |
| 3. Lots feed     | **99.5%** | 3.4 hours    | One OpenSearch cluster, with risky reindexing and upgrades. A buyer retries a failed search; a failed deal is lost. |

**Why 28 days rolling.** Every window has exactly four of each weekday, so weekends do not move the SLI. A rolling window does not reset the budget on the 1st of the month. The SLA uses a calendar month, because contracts bill by month.

**What each extra nine costs.** Each nine costs about ten times more, and users notice less of it: their own network fails more often than 0.01%.

| Target | Budget in 28 days | What it takes                                                                                                                                           |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 99%    | 6.7 hours         | One server, manual deploys, fixes in working hours                                                                                                      |
| 99.9%  | 40 minutes        | On-call within 15 minutes, a fast rollback, Postgres with a standby replica                                                                             |
| 99.99% | 4 minutes         | Canary deploys with automatic rollback, Postgres failover in seconds, zero-downtime migrations. One incident spends the budget before a person can act. |

**Condition for 99.9% on deals.** Deals use only Postgres, but every `/ready` check is critical: when Postgres, Redis, S3 or OpenSearch is down, the pod leaves the load balancer. With each at 99.9%, deals reach about 99.6% (0.999⁴). The app does not see these failures, so the deal SLI still shows 100%. Fix: make `/ready` fail only on the dependencies the pod cannot serve without. Until then, 99.9% on deals is a goal the design cannot guarantee.

**Error budget policy.**

| When                                           | What happens                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| The budget of a path is spent                  | Feature releases on that path stop. Only reliability fixes ship until the SLI is back above the target. |
| One incident spends more than 20% of a budget  | A postmortem                                                                                            |
| The budget is mostly unspent for three windows | Review the target: it may be too low, or the SLI may miss failures                                      |

Review all targets after the first 28 days of real data.

---

## SLA

| Item   | Value                                                                       |
| ------ | --------------------------------------------------------------------------- |
| Who    | Companies with a contract, buyers and sellers                               |
| What   | Deal creation (`POST /deals`) is available                                  |
| Target | **99.5% per calendar month**: about 3.6 hours of downtime in a 30-day month |
| Status | Not signed until it is measured at the load balancer (see below)            |

**Why lower than the SLO (99.9%).** The SLO must break, and make the team act, long before the contract does. A missed SLA costs credits to every company. The number must hold under the customer's own measurement. A calendar month cannot spread one bad incident over a rolling window.

**How availability is measured.** The month is split into 5-minute intervals. An interval is down when more than 5% of `POST /deals` requests answer with a 5xx. An interval with no requests is up. Availability = up intervals / all intervals. It is measured at the load balancer: a customer would dispute a number from the app, which misses the requests that never reached it.

**Not downtime:** maintenance announced 48 hours ahead (at most 4 hours per month), 4xx answers, the customer's own network or integration, the bank and other external parties.

**Service credits**, as a share of the company's platform fee for the month. The data model has no fee yet: the base is decided with the pricing.

| Monthly availability | Credit |
| -------------------- | ------ |
| below 99.5%          | 10%    |
| below 99.0%          | 25%    |
| below 95.0%          | 50%    |

A company claims the credit within 30 days after the month. The credit is the only compensation for downtime.

**Not in the SLA:** latency (the client's network adds its own delay), the lot card and the feed (too early: add after a few months of data), top-ups and receipts (they depend on the bank and the email provider), correct money (a liability, not an availability percentage).

---

## SLO alerts

### Burn rate

The error budget is an allowance of failures. At 99.9% and 1,000,000 deals in 28 days, 1,000 deals may fail.

- **Budget spent:** the share of the allowance already used. 20 failed deals is 2%.
- **Burn rate:** how fast the budget is spent, compared with the pace that spends it in exactly 28 days. Burn rate = current error rate / allowed error rate.

| Burn rate | Error rate at 99.9% | The budget lasts |
| --------- | ------------------- | ---------------- |
| 1         | 0.1%                | 28 days          |
| 13.4      | 1.34%               | about 2 days     |
| 1000      | 100%, full outage   | 40 minutes       |

Budget spent = burn rate × duration / 28 days. Burn rate 13.4 for one hour spends 13.4 × 1 h / 672 h = 2%.

### Rules

Multi-window, multi-burn-rate alerts from [Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) (SRE Workbook), recalculated from 30 to 28 days.

| Rule   | Budget spent | Long window | Short window | Burn rate | Action |
| ------ | ------------ | ----------- | ------------ | --------- | ------ |
| Fast   | 2%           | 1 hour      | 5 minutes    | 13.4      | page   |
| Medium | 5%           | 6 hours     | 30 minutes   | 5.6       | page   |
| Slow   | 10%          | 3 days      | 6 hours      | 0.93      | ticket |

An alert fires only when both windows are above the burn rate. The long window proves the problem is big. The short window proves it is still going on, so the alert resolves minutes after the fix. The fast rule catches an outage in 1–2 minutes, the medium rule a problem that lasts hours, the slow rule a leak too small to page for.

Thresholds as a share of 5xx:

| SLI              | SLO   | Fast  | Medium | Slow   |
| ---------------- | ----- | ----- | ------ | ------ |
| 1. Deal creation | 99.9% | 1.34% | 0.56%  | 0.093% |
| 2. Lot card      | 99.9% | 1.34% | 0.56%  | 0.093% |
| 3. Lots feed     | 99.5% | 6.7%  | 2.8%   | 0.47%  |

**Low traffic.** At night, deals fall to about 80 per hour, and 2 failures are 2.5%. A page also needs at least **10 failed requests** in the long window. The slow rule needs no guard.

**Who.** A page goes to the on-call engineer at any hour, for all three SLIs: a broken feed stops every new deal too. A ticket is handled in business hours.

**No duplicate pages.** A wave of 5xx on deals fires the fast SLO alert in about 2 minutes, and [Deals dropped](business-alerts.md#1-deals-dropped) 15–25 minutes later. Deals dropped is silenced while the deal SLO alert fires. It still pages when requests do not arrive at all, which the SLO alert cannot see. The [watchdog](business-alerts.md#watchdog-no-data) pages when the request counter stops: a dead counter looks like a perfect SLI.

### First steps

1. A deploy in the last 30 minutes? Roll back first, investigate after.
2. Check the error logs by `code` and `/ready` by dependency ([dashboard](business-dashboard.md), row 3).
3. Lots feed: check the health of the OpenSearch cluster.
4. Cause not found in 30 minutes: escalate.

For a slow-rule ticket, find the `code` that spends the budget and fix it in the normal work queue.

---

## Not covered yet

| Candidate                                                           | Why not now                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Deal latency: successful deals under 1 s                            | Next candidate. Needs a histogram bucket at 1 s, the threshold of dashboard row 3.                    |
| Lot card and feed latency (300 ms, 500 ms)                          | Added with the routes                                                                                 |
| Top-ups availability                                                | The bank retries, so a 5xx delays money but does not lose it. Covered by the alert "Top-ups stalled". |
| **Async path:** index freshness, lot changes searchable within 60 s | Needs the indexer to OpenSearch, which comes with the feed. Required before the SLOs are final.       |
| **Async path:** receipt email sent within 5 min of payment          | Needs receipts and an outbox, which are not planned yet                                               |

Not SLIs at all: money reconciles (an invariant: one mismatch is an incident, already a [business alert](business-alerts.md#2-money-does-not-reconcile)), business refusals (a rule that fires is not a failure), `/ready`, CPU and database health (causes, not symptoms), price changes (rare, done by operators).

## Known gaps

The SLIs are measured in the app, so they miss or misjudge failures in front of it:

- A crashed pod, or a pod out of `/ready`, gets no requests and reports no errors. For deals, "Deals dropped" catches it. For the lot card and the feed, nothing does yet.
- When the load balancer times out with 504, the app may still finish and count the request as good.

| Measured at          | Pod crashed or out of `/ready` | Load balancer timeout (504) | DNS, network, load balancer down |
| -------------------- | ------------------------------ | --------------------------- | -------------------------------- |
| The app (now)        | not seen                       | counted as good             | not seen                         |
| The load balancer    | seen                           | seen                        | not seen                         |
| A probe from outside | seen                           | seen                        | seen                             |

**The fix**, when the monitoring stack is chosen:

1. Read the SLIs from the load balancer: its request metrics or access logs. It stays the main source, because it counts real traffic.
2. Add an outside probe on the lot card and the feed, every minute. It backs up the SLIs and is the only way to see DNS or a load balancer that is down. A probe on `POST /deals` creates real deals, so it needs a test company first.
