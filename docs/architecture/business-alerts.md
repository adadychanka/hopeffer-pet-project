# Business alerts

Three alerts on the metrics of the [business dashboard](business-dashboard.md). Each one wakes a person, so each one has an impact on customers or money, a clear first action, and few false alarms.

These alerts watch business symptoms. Failed requests on single user paths are covered by the SLO alerts in [service levels](service-levels.md#slo-alerts).

## Contents

- [Summary](#summary)
- [How the alerts were chosen](#how-the-alerts-were-chosen)
- [Fixed threshold or baseline](#fixed-threshold-or-baseline)
- [Roles and severity](#roles-and-severity)
- [1. Deals dropped](#1-deals-dropped)
- [2. Money does not reconcile](#2-money-does-not-reconcile)
- [3. Top-ups stalled](#3-top-ups-stalled)
- [Watchdog: no data](#watchdog-no-data)
- [Candidates not chosen](#candidates-not-chosen)
- [Known gaps](#known-gaps)

## Summary

| Alert                    | Condition                                | Window                  | Severity                                | Who                              | First action                                          |
| ------------------------ | ---------------------------------------- | ----------------------- | --------------------------------------- | -------------------------------- | ----------------------------------------------------- |
| Deals dropped            | below 50% of the baseline; baseline ≥ 20 | 15 min, held for 10 min | page                                    | on-call engineer                 | check 5xx, `/ready` and the last deploy; roll back    |
| Money does not reconcile | any reconciliation check ≠ 0             | one run                 | page, highest                           | on-call engineer, payments owner | freeze deploys, find the account, never fix by hand   |
| Top-ups stalled          | below 50% of the baseline; baseline ≥ 10 | 1 hour                  | page in business hours, ticket at night | on-call engineer, support        | last bank notification, our answers, contact the bank |

## How the alerts were chosen

An alert qualifies only when it passes all four tests:

1. **Impact.** Customers or money are affected now. "CPU at 90%" while deals go through is not an alert.
2. **Action.** The person paged knows the first thing to do. Without an action, it is a dashboard panel, not an alert.
3. **No duplicates.** If two alerts always fire together, only one stays.
4. **Few false alarms.** A week of false pages at night teaches people to ignore pages.

Alerts watch **symptoms** ("no deals"), not causes ("Redis is slow"). A symptom catches causes nobody thought of in advance. Causes belong on the service dashboards, where the on-call engineer goes after the page.

## Fixed threshold or baseline

| Kind of metric               | Threshold               | Why                                                                                                                     |
| ---------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Flows: deals, top-ups        | a share of the baseline | Traffic has a daily and a weekly cycle. A fixed number is either noisy at night or silent during the day.               |
| Invariants: money reconciles | fixed, 0                | An invariant has no season and no normal deviation. Comparing it with the past would hide a bug that was already there. |

**The baseline** is the same window a week ago: the same weekday at the same time.

Why a week ago:

- A week, not a day: Monday is compared with Monday, so the weekly cycle cancels out.
- The alerts compare with the same line the [dashboard](business-dashboard.md) shows. A panel turns red exactly when its alert fires, so the on-call engineer never sees a red panel without an alert, or an alert on a green panel.
- It needs only one week of history.

The cost: a week ago may itself be unusual.

- **Last week was a holiday or an incident**, with low traffic. Today's normal traffic looks like growth, and a real drop to last week's level stays silent.
- **This week has a holiday** that last week did not. Traffic drops, and the alert fires for no reason.

Both cases are known in advance or visible on the dashboard. The holiday calendar silences the alerts on holidays and on the week after them.

**Guard against low traffic.** A share of a small number is noise: one missing deal out of three is "−33%". Each flow alert is off while the baseline is below its minimum.

## Roles and severity

| Role             | Responsibility                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------- |
| On-call engineer | Receives every page. Diagnoses, rolls back, escalates.                                        |
| Payments owner   | Owns the ledger and the money flows. Decides on corrections and on stopping money operations. |
| Support          | Tells customers about delays before they write in.                                            |

| Severity | Meaning                                                     |
| -------- | ----------------------------------------------------------- |
| Page     | Wakes a person at any hour. Needs action within 15 minutes. |
| Ticket   | Goes to the queue. Handled in business hours.               |

Every alert links to its section of this document, so the first steps are one click away from the notification.

---

## 1. Deals dropped

| Field     | Value                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| Metric    | Deals created, both `pay_mode` values together ([dashboard panel 1](business-dashboard.md#1-deals-created)) |
| Condition | Deals in the last 15 minutes are below **50% of the baseline**                                              |
| Baseline  | The same 15 minutes a week ago                                                                              |
| Guard     | Off while the baseline is below **20 deals**                                                                |
| Window    | 15 minutes. The condition must hold for **10 minutes** before the alert fires.                              |
| Resolves  | Deals are back above 70% of the baseline for 15 minutes                                                     |
| Severity  | Page                                                                                                        |
| Who       | On-call engineer                                                                                            |

**Why this alert.** It is the main symptom of the business. It catches almost any failure: our bug, a database that is down, a broken client integration, a network problem in front of the app.

**Why these numbers.**

- **15 minutes:** a 5-minute window is too noisy at normal traffic.
- **Held for 10 minutes:** one quiet window is not an incident. The alert fires 15–25 minutes after the drop starts.
- **50% to fire, 70% to resolve:** the gap stops the alert from flapping when the value hovers around one threshold.
- **Only drops:** a spike (a client in a retry loop, a bot) is visible on the dashboard but does not wake anyone.

**First steps.**

1. Open the [business dashboard](business-dashboard.md), rows 2 and 3. Do 5xx grow? Is a dependency down on `/ready`?
2. Was there a deploy in the last 30 minutes? If yes, roll back first and investigate after.
3. If every panel is green and deals are still missing, the cause is outside the app:
   - a client integration: a spike of `validation_failed` or `forbidden_role` from one large buyer;
   - DNS, the load balancer or the network in front of the app.
4. If the cause is not found in 30 minutes, escalate.

**Known false alarms.** A holiday today, or a holiday or an incident at the same time last week. Silence the alert for known holidays and the week after them.

**Silenced while the deal SLO alert fires.** A wave of 5xx on deals fires the [SLO alert](service-levels.md#slo-alerts) in about 2 minutes, long before this alert. One incident gets one page.

## 2. Money does not reconcile

| Field     | Value                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| Metric    | The number of failed reconciliation checks ([dashboard panel 6](business-dashboard.md#6-money-reconciles)) |
| Condition | Any check is **not 0**                                                                                     |
| Baseline  | None: a fixed threshold                                                                                    |
| Guard     | None: an invariant does not depend on traffic                                                              |
| Window    | One run, every 5–15 minutes                                                                                |
| Resolves  | Never by itself. The payments owner closes it after the correction.                                        |
| Severity  | Page, the highest                                                                                          |
| Who       | On-call engineer and payments owner                                                                        |

**Why this alert.** It is the only signal that the business works _wrongly_ while every other metric is green. A balance that does not match the ledger means someone has money they should not, or lost money they should have.

**Why one run is enough.** All three checks run in one database transaction with `REPEATABLE READ`, so they read one consistent snapshot. A deal that is being paid at that moment cannot cause a false mismatch. Waiting for a second run would only delay the page.

**Related ticket.** If the checks have not run for 30 minutes, a ticket goes to the on-call engineer. Without it, this alert stays silent while broken.

**First steps.**

1. **Freeze deploys.** A new release can make the mismatch worse or hide its cause.
2. Find which check failed, which account or transfer differs, and when the difference first appeared: the first `ledger_entries` row after which the balances stop matching.
3. **Never fix the data by hand.** The ledger is append-only: the database rejects updates and deletes. A mistake is fixed with a correction (`corrections` and its transfer) after the cause is understood.
4. The payments owner decides whether to stop money operations until the cause is fixed. See [Known gaps](#known-gaps).

## 3. Top-ups stalled

| Field     | Value                                                                   |
| --------- | ----------------------------------------------------------------------- |
| Metric    | Top-ups recorded ([dashboard panel 3](business-dashboard.md#3-top-ups)) |
| Condition | Top-ups in the last hour are below **50% of the baseline**              |
| Baseline  | The same hour a week ago                                                |
| Guard     | Off while the baseline is below **10 top-ups**                          |
| Window    | 1 hour                                                                  |
| Resolves  | Top-ups are back above 70% of the baseline for 1 hour                   |
| Severity  | Page in business hours; a ticket at night and on weekends               |
| Who       | On-call engineer; support is told when the cause is on the bank's side  |

**Why this alert.** A top-up is a notification from the bank, so this alert watches the bank channel. The deals alert does not catch it: deals paid at once keep going for an hour on the money already in wallets. Pay-later deals are paid only by top-ups, so when the channel stops, their invoices expire, and buyers end up under `prepay_only`.

**Why these numbers.**

- **1 hour:** top-ups are rarer than deals, and banks often send them in batches.
- **Baseline a week ago:** banks work on their own schedule, with few transfers at night and on weekends. The same hour a week ago follows that schedule.
- **No page at night:** the bank does not answer at night either. The ticket is handled first thing in the morning.

**First steps.**

1. Find when the last notification from the bank arrived.
2. Check our answers to `POST /top-ups` (dashboard panel 4):
   - 5xx or refusals: the problem is ours. Continue as for a failing endpoint.
   - no requests at all: the problem is on the bank's side.
3. On the bank's side: check the bank's status page and contact the bank.
4. Tell support: buyers have paid, but the money is not credited yet.

**Known false alarms.** Bank holidays. The alert needs a calendar of bank holidays that silences it, or it fires on the 1st of January.

---

## Watchdog: no data

Every alert above stays silent when its metric stops arriving. A silent alert looks the same as a healthy business.

| Condition                                                | Severity | Who              |
| -------------------------------------------------------- | -------- | ---------------- |
| A metric of the dashboard has no new data for 15 minutes | page     | on-call engineer |

This is not a business alert. It checks the monitoring itself: the app, the periodic database query or the read replica.

## Candidates not chosen

| Candidate                   | Why not                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Share of 5xx above 2%       | Covered by the SLO burn-rate alerts, which are more precise. Here it would be a duplicate.                             |
| Payments dropped            | Duplicates other alerts: deals paid at once drop with deals, pay-later payments drop with top-ups.                     |
| Overdue but not processed   | A good alert, but the background job that completes and expires deals by time does not exist yet. Add it with the job. |
| Spikes of business refusals | Useful for a diagnosis, but there is no single first action. It stays on the dashboard (panel 4).                      |

## Known gaps

- **No switch to stop money operations.** When money does not reconcile, the payments owner can only freeze deploys. Stopping top-ups and payments needs a switch that does not exist yet.
- **No holiday calendar.** Both flow alerts need one to stay quiet on public and bank holidays.
- **The baseline needs one week of history.** During the first week after launch, the flow alerts are off.
