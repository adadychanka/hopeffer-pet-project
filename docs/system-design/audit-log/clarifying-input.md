## Questions to business

The answers below are how an interviewer would answer for a mid-size production system in the cloud. The numbers are round to keep the math simple.

---

**1. How many years must the data be kept? Does a law or a contract set the period?**

All events are kept for 5 years. After that, the records are deleted.

**2. What search latency is acceptable? Which periods do people search most often?**

- Almost all searches cover the last 30 days. The answer is needed in under 2 seconds.
- Searches over older records are rare. Waiting minutes is fine.

**3. What data exactly is needed for audits and disputes? What disputes happen, and what must be proven?**

A typical dispute: "my listing was taken down unfairly" or "I did not turn off the service". We must prove who did the action, when, on which object, what it was before and after, and why.

**4. Do different roles see different things in the log? For example, the platform admin sees all fields, the moderator only some, and support even fewer.**

Yes.

- **Platform admin** sees everything.
- **Organization admin** sees only the events of their organization.
- **Moderator** sees only moderation events.
- **Support** sees only the events of the user from the ticket.
- **The user** sees the reason for a ban or a listing takedown, but not who did it.

**5. What is worse: losing a record, or cancelling or delaying the action itself when the log is unavailable?**

A record must never be lost. User actions must not be cancelled either. A record may appear in the log up to 1 minute late.

**6. How many actions per day are there now? When is the peak, for example sales, and how many times higher is it than a normal day?**

- 1 million events per day, about 1 KB each. That is about 1 GB per day.
- At the peak (sales), the load is 10 times the average.

**7. What platform growth do you expect?**

×10 in one year, ×100 in 3 years.

**8. The data must be kept for years, but by law a user can ask to delete their personal data. How do we reconcile this? I propose to pseudonymize the data from the start instead of deleting it on request.**

Keeping the log for 5 years is allowed. But on the user's request, their personal data (name, email, IP) must be deleted. The fact of the action and the user ID may stay. Pseudonymizing from the start is acceptable.

**9. Does the platform admin have access to all logs? Is that a legal weak point with regard to the data of different organizations?**

Yes, the platform admin has access to the whole log. Nobody can change or delete a record, including the platform admin.

---

### Added by the interviewer

- **Cloud:** AWS.
- **Team:** 4–5 backend developers. The solution must be simple to maintain.
- **Budget:** small. Cheap storage matters more than instant search over old data.

## Volume

```text
Avg RPS  = 1M / 24 / 60 / 60 = 11.57 RPS
Peak RPS = 11.57 * 10        = 115.7 RPS

Storage (5 years) = 1 GB * 365 * 5 = 1825 GB = 1.8 TB
  x10             = 1.8 TB * 10    = 18 TB
  x100            = 1.8 TB * 100   = 180 TB

Hot storage (30 days) = 1 GB * 30 = 30 GB
  x10                 = 300 GB
  x100                = 3000 GB = 3 TB
```

PostgreSQL handles this average and peak. At ×10 it still does, with less headroom. At ×100 it does not: we need queues, batch writes or a different store. Writes become a problem only after ×10.

Old data can go to cold storage because it is rarely accessed, and compression reduces its size: S3 in Parquet, partitioned by date, searched with Athena.

Today the hot data can live in PostgreSQL, in a separate database. Indexes give fast access and filtering. After ×10, I would start to consider OpenSearch or other options.

**Moving data from hot to cold storage.** The log table in PostgreSQL is partitioned by date (`PARTITION BY RANGE (occurred_at)`), one partition per day. `pg_partman` creates new partitions in advance. Every day a job exports the partition older than 30 days to S3, then runs `DETACH PARTITION` and `DROP TABLE`. The drop takes a fraction of a second, with no `DELETE` of millions of rows and no table bloat. A query for one week reads only 7 partitions.

**Signals to move to OpenSearch** (rough values; confirm with a load test). Move when any of them fires:

- p95 of hot search is above 2 seconds, although the indexes exist;
- at the write peak, database CPU is above 70%, or the peak approaches 1,000–2,000 inserts per second;
- the hot data with indexes no longer fits in the database memory (from a few hundred GB);
- the business needs full-text search or any combination of filters.

## Scenarios

|                         | Today                  | ×10 (in 1 year)    | ×100 (in 3 years) |
| ----------------------- | ---------------------- | ------------------ | ----------------- |
| Events per day          | 1M                     | 10M                | 100M              |
| Write peak              | ~116/s                 | ~1,160/s           | ~11,600/s         |
| Hot 30 days             | 30 GB                  | 300 GB             | 3 TB              |
| Total for 5 years (raw) | 1.8 TB                 | 18 TB              | 180 TB            |
| Hot storage             | PostgreSQL             | PostgreSQL, larger | OpenSearch        |
| Cold storage            | S3 + Athena            | S3 + Athena        | S3 + Athena       |
| Write path              | Insert into PostgreSQL | Batch inserts      | Through Kafka     |

### Today

- A separate PostgreSQL database with daily partitions. Cold data in S3 as Parquet, searched with Athena.
- Every number has a large margin: 30 GB and 116 inserts per second are little for PostgreSQL.
- **Threshold to move to ×10:** hot data above ~100 GB, or p95 search approaching 2 seconds.

### ×10

- The same design, with no new systems. The team is small, so we grow inside PostgreSQL first.
- A larger instance, with memory for the indexes of recent days. A query with a period reads only that period's partitions.
- Search goes to a read replica, so it does not slow down writes.
- Events are written in batches (for example, once per second or 500 events at a time), not one insert per event. The ~1,160/s peak becomes a few transactions per second.
- Only as many indexes as there are filters in the UI: user, object, organization, action type, each together with the date.
- **Threshold to move to ×100:** any signal from the list above fires (p95 above 2 seconds, CPU above 70% at peak, indexes do not fit in memory). Memory will most likely fire first: 300 GB of hot data with indexes is 450–600 GB.

### ×100

- 11,600 inserts per second and 3 TB of hot data are no longer a job for one PostgreSQL database.
- The outbox relay publishes events to Kafka (MSK) instead of the database. Kafka absorbs the peak and keeps events for a few days, until the consumers process them.
- Two independent consumers read Kafka:
  - one writes to OpenSearch: one index per day, ILM deletes an index after 30 days;
  - one writes to S3 as Parquet (for example, Kafka Connect S3 sink). S3 becomes the main copy of the log; OpenSearch is only an index for fast search.
- If OpenSearch loses data, the index is rebuilt from S3 or from Kafka.
- How an event reliably reaches the relay is described in "How an event is not lost" in [components.md](components.md).
- **Threshold beyond ×100:** archive search in Athena becomes expensive (a query over all 5 years reads hundreds of GB), or the business needs analytics over the archive. Then add partitions by organization in S3, or move to a columnar database such as ClickHouse.
