# Audit log: components for scenario ×10

Diagram: [containers-x10.drawio.svg](containers-x10.drawio.svg). Questions and the interviewer's answers: [clarifying-input.md](clarifying-input.md).

## Scenario ×10

| Number                  | Value                                       |
| ----------------------- | ------------------------------------------- |
| Events                  | 10M per day, ~1 KB each, ~10 GB per day     |
| Write rate              | ~116 events/s average, ~1,160 events/s peak |
| Hot data (last 30 days) | ~300 GB, 450–600 GB with indexes            |
| Archive (5 years)       | ~18 TB raw, ~2–3.5 TB as compressed Parquet |
| Search                  | 30 days: under 2 s. Older: minutes are fine |

Prices are approximate AWS on-demand list prices for us-east-1, per month. Check them in the AWS Pricing Calculator before you use them.

## Components

| Component                                         | Why                                                                                                                                                | Price per month                                                         | Hits its limit when                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Outbox table in each domain database              | The audit event is written in the same transaction as the business change. If the change commits, the event exists.                                | ~$0: extra rows that live for seconds                                   | The domain database itself is near its write limit. Each action adds one more row.                  |
| Outbox relay (Node.js worker)                     | Moves events out of the domain databases in batches. Retries until the ingestion API confirms.                                                     | ~$40: 2 small Fargate tasks                                             | Relay lag passes 1 minute. Fix: more workers with `SELECT … FOR UPDATE SKIP LOCKED`.                |
| Audit ingestion (NestJS)                          | One place that checks the event schema, removes secrets and encrypts personal data. Stateless.                                                     | ~$70: 2 Fargate tasks, 1 vCPU each                                      | Never first. It scales out. The audit DB behind it is the limit.                                    |
| Audit DB (RDS PostgreSQL, Multi-AZ, db.r6g.large) | Hot 30 days. The team already runs PostgreSQL. Transactions make deduplication by `event_id` exact. Roles and triggers make the table append-only. | ~$500: instance ~$330, gp3 storage ~700 GB ~$160                        | Batch inserts reach ~10k rows/s, so writes are not the first limit. See "What hits first".          |
| Audit DB read replica (db.r6g.xlarge)             | Searches do not compete with ingestion. More memory for the indexes of recent days.                                                                | ~$410: instance ~$330, storage ~$80                                     | Replication lag passes 1 minute at peak, or p95 search passes 2 s.                                  |
| Archiver and verifier (scheduled ECS task)        | Hourly hash digest. Daily export of one day to Parquet, check, then `DROP` of the partition.                                                       | ~$5                                                                     | Never at ×10: one day is ~10 GB and exports in minutes.                                             |
| Audit archive (S3 Standard-IA, Object Lock)       | Cheapest durable storage. Compliance mode blocks deletes and changes for 5 years, even for the root account.                                       | ~$25–45 after 5 years (2–3.5 TB at $0.0125/GB)                          | No practical limit.                                                                                 |
| Archive search (Athena + Glue Data Catalog)       | SQL over Parquet without a server to run. Pay per data read. Partition projection by date, so no partition registration.                           | ~$25: ~1,000 queries × ~5 GB at $5/TB. Glue Catalog is in the free tier | Queries without a tight date range read terabytes. Account quota of about 20–25 concurrent queries. |
| Audit Query API (NestJS)                          | Applies role scope and field masking. Routes the last 30 days to the replica and older periods to Athena.                                          | ~$70: 2 Fargate tasks                                                   | Never first. It scales out.                                                                         |
| KMS                                               | Keys for personal data in events (see "Personal data").                                                                                            | ~$5                                                                     | No limit at ×10 when data keys are cached.                                                          |

Total: about **$1,150 per month**, plus the existing identity provider and helpdesk.

### Why not CDC from the domain tables

Debezium on the domain tables sees row changes, but not who acted, in which role, or why. Hundreds of tables would also need hundreds of mappings. Each service emits an explicit audit event instead, with the actor and the reason.

## How an event is not lost

1. The service writes the business change and the audit event to the outbox in one transaction. There is no state where the action succeeded and the event does not exist.
2. The relay sends batches to ingestion and marks rows as sent only after a confirmation. A crash means a resend, not a loss.
3. Ingestion inserts with `ON CONFLICT (event_id) DO NOTHING`, so a resend does not create a duplicate.
4. The audit DB runs Multi-AZ: a synchronous standby keeps confirmed events when one zone fails.

The cost:

- one more row in every business transaction;
- the event appears in search with a delay of seconds, up to 1 minute (the business accepts this);
- every service must write audit events through the shared outbox library.

If ingestion or the audit DB is down, actions still work. Events wait in the outbox and arrive later.

## Why a record cannot be changed

| Layer      | Protection                                                                                                                                                                                                      | How a change is detected                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit DB   | Ingestion connects with a role that has only `INSERT`. A trigger rejects `UPDATE` and `DELETE` for every role. Only the archiver role can drop a partition, and only one that is already exported and verified. | Hourly, the verifier stores a hash digest of the last hour's events in S3. The daily export recomputes the hashes. A mismatch raises an alert. |
| S3 archive | Object Lock in compliance mode, retention 5 years. Nobody can delete or overwrite an object before that, including the root account. A lifecycle rule deletes objects after 5 years.                            | CloudTrail data events log every access to the bucket.                                                                                         |

A database superuser can still change a row in the hot 30 days before the next hourly digest. The digest catches it later. Hash chains between events would close this gap, but they force one writer and slow ingestion.

## Event fields

| Group    | Fields                                                                               |
| -------- | ------------------------------------------------------------------------------------ |
| Identity | `event_id` (UUIDv7), `schema_version`                                                |
| Time     | `occurred_at` (server UTC), `received_at`                                            |
| Actor    | `actor_id`, `actor_role`, `actor_org_id`, `on_behalf_of` (support acting for a user) |
| Action   | `action` (for example `listing.taken_down`), `result` (`success` or `denied`)        |
| Object   | `object_type`, `object_id`, `object_org_id`                                          |
| Change   | `before` and `after` of the changed fields only                                      |
| Reason   | `reason_code`, `rule_id`, `comment`, `ticket_id`                                     |
| Context  | `source` (web, API, admin console), `request_id`, `ip` and `user_agent` (encrypted)  |

Never written, as the OWASP Logging Cheat Sheet advises: passwords, tokens, session IDs, card data, full request bodies.

## Who sees what

| Role               | Events                                                               | Fields                                                                 |
| ------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Platform admin     | All                                                                  | All                                                                    |
| Organization admin | Events where `actor_org_id` or `object_org_id` is their organization | A staff actor shows as a role ("Platform moderator"), without the name |
| Moderator          | `moderation.*` and listing history                                   | No IP and no user agent                                                |
| Support agent      | Events of the user from an open ticket, while the ticket is open     | IP and email masked                                                    |
| Seller or buyer    | Ban and takedown outcomes for their own account and objects          | Date, reason, rule, how to appeal. No actor                            |

The Audit Query API adds these filters on the server. The client cannot remove them.

## Personal data

Events keep `actor_id`. Name, email and IP are encrypted with a data key per person. The keys live in a small table in the audit DB, encrypted with a KMS key. On a deletion request, the person's key is deleted. Their personal data becomes unreadable in the hot DB and in the locked S3 archive, and the facts of the actions stay.

## Two storage options

|                          | A. PostgreSQL + S3/Athena (chosen)                                       | B. OpenSearch + S3/Athena                                                                    |
| ------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Hot storage              | RDS primary Multi-AZ + read replica                                      | 3 data nodes r6g.large.search + 3 dedicated master nodes, gp3 with 1 replica                 |
| Price per month          | ~$910 for hot storage, ~$1,150 in total                                  | ~$770 for hot storage, ~$1,000 in total                                                      |
| Filters                  | B-tree indexes for each filter in the UI. A new filter needs a new index | Any combination of fields, full-text search                                                  |
| Writes and deduplication | Transaction, exact `ON CONFLICT`                                         | Bulk API. `event_id` as document id gives deduplication, but there are no transactions       |
| Immutability             | Roles and triggers in the database                                       | No append-only guarantee in the engine. S3 must be the source of truth from the first second |
| Team cost                | Known technology, already in production                                  | One more cluster to run, upgrade and size                                                    |

A is chosen. B is a little cheaper on infrastructure, but it needs a durable copy before indexing and a new technology for a team of 4–5. At ×10 PostgreSQL still meets the 2-second target. B becomes the hot store at ×100, behind Kafka (see `## Scenarios` in [clarifying-input.md](clarifying-input.md)).

## How search and filters work

**Hot, last 30 days (replica).**

- The table is partitioned by day. Every query requires a date range, so PostgreSQL reads only those partitions.
- Indexes on each partition, all ending with `occurred_at`: `(actor_id, occurred_at)`, `(object_type, object_id, occurred_at)`, `(actor_org_id, occurred_at)`, `(object_org_id, occurred_at)`, `(action, occurred_at)`.
- Role scope is one more condition in `WHERE`, for example `object_org_id = $org`.
- Keyset pagination by `(occurred_at, event_id)`, never `OFFSET`.

**Archive, older than 30 days (Athena).**

- Files in `s3://audit-archive/year=/month=/day=/`. Within a day, rows are sorted by `object_org_id` and `actor_id`, so Parquet row-group statistics skip most of a file.
- A query must have a date range. The API rejects ranges over 1 year without a platform admin role.
- The query runs asynchronously: the UI shows "archive search started" and the result in seconds to minutes.

## What hits first at ×10

**Search on the read replica.** 300 GB of hot data plus indexes is 450–600 GB, and the replica has 32 GB of memory. A broad search, such as a large organization over 30 days, reads indexes from disk, and p95 rises above 2 seconds.

Fixes before a new technology:

1. Larger replica instance (more memory).
2. Shorter default period in the UI (7 days).
3. A second replica.

When these stop helping, move hot search to OpenSearch (scenario ×100).

Second limit: **Athena cost**, if users run archive searches without a tight date range.

Writes are not a limit at ×10: ~1,160 events/s in batches is a few transactions per second.
