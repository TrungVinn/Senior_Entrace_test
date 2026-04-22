# Database Architecture Deep Dive

## 1. Querying a Numeric Column Without an Index: ClickHouse vs PostgreSQL/MySQL

### Setup

```sql
SELECT SUM(volume) FROM trades WHERE volume > 1000;
-- `volume` has no index
```

---

### PostgreSQL / MySQL — Row-oriented: I/O Disaster

**Physical layout:**

Data is stored row by row. A single disk block contains all columns for N consecutive rows:

```
Disk block:
[ id=1 | symbol="BTC" | volume=500  | price=60000 | created_at=... ]
[ id=2 | symbol="ETH" | volume=1500 | price=3000  | created_at=... ]
[ id=3 | symbol="BNB" | volume=200  | price=400   | created_at=... ]
...
```

**Sequential scan without an index:**

1. Engine reads every block from disk into RAM
2. For each row, extracts `volume` — but already had to pull `id`, `symbol`, `price`, `created_at` into RAM as well
3. Evaluates `volume > 1000`, accumulates `SUM`
4. Repeats until the entire table is scanned

**Consequences:**

| Problem | Detail |
|---------|--------|
| Inflated I/O | Reading 10 columns to use 1 — wastes 90% of disk bandwidth |
| Cache pollution | Unused column data fills the Buffer Pool, evicting actually useful pages |
| Single-threaded | Default execution is sequential, under-utilises multi-core CPUs |
| Result | 100M rows → minutes to hours, or timeout |

---

### ClickHouse — Column-oriented: Controlled Brute-force

**Physical layout:**

Each column lives in its own file:

```
volume.bin:    [ 500, 1500, 200, 3000, 800, ... ]   ← only this file is read
symbol.bin:    [ "BTC", "ETH", "BNB", ... ]          ← skipped entirely
price.bin:     [ 60000, 3000, 400, ... ]              ← skipped entirely
```

**Execution path:**

1. Reads **only** `volume.bin` from disk — all other columns are untouched
2. Numeric values of the same type compress extremely well (typically 5–10×), so actual disk I/O is tiny
3. Loads value arrays into CPU cache; uses **SIMD** instructions to filter and accumulate thousands of values per clock cycle
4. **Automatically parallelises** across all available CPU cores

**Real-world benchmark:**

| Database | 1 billion rows — `SUM(volume) WHERE volume > X` | RAM required |
|----------|-------------------------------------------------|--------------|
| PostgreSQL | 5–30 minutes (sequential scan) | Entire table pushed through buffer |
| MySQL | Similar to PostgreSQL | Similar |
| ClickHouse | **1–5 seconds** | Only the `volume` column |

> **Key insight:** No index on a numeric column is not a problem for ClickHouse analytics queries — columnar storage + vectorised execution act as a natural "index" for aggregate scans.

---

## 2. Why ClickHouse Over Other Databases?

### Comparison Matrix

| Criterion | ClickHouse | Cassandra / ScyllaDB | PostgreSQL / TimescaleDB |
|-----------|-----------|----------------------|--------------------------|
| **Primary workload** | OLAP — analytics, aggregation | OLTP — high-throughput point reads/writes | OLTP + moderate time-series |
| **Storage model** | Columnar | Wide-column (row-based per partition) | Row-based |
| **Horizontal scale** | Manual sharding / Keeper | Native — virtually unlimited | Limited, requires extensions |
| **Aggregate queries** | ⭐⭐⭐⭐⭐ extremely fast | ❌ not feasible | ⭐⭐⭐ fine, slows at TB+ |
| **Point read / write** | ⭐⭐ possible, not a strength | ⭐⭐⭐⭐⭐ millisecond latency | ⭐⭐⭐⭐ good |
| **ACID transactions** | ❌ none | ❌ none (eventual consistency) | ✅ full |
| **Complex JOINs** | ⭐⭐ supported but limited | ❌ none | ⭐⭐⭐⭐⭐ |
| **Update / Delete** | Very expensive (mutations) | Very expensive (tombstones) | Normal |
| **Data volume sweet spot** | TB → PB | TB → PB | GB → a few TB |

---

### ClickHouse vs Cassandra / ScyllaDB

**Cassandra / ScyllaDB excels at:**
- Write-heavy workloads: millions of events per second
- Multi-datacenter active-active replication
- Point lookups by Partition Key: `SELECT * FROM trades WHERE user_id = ?`
- Absolute high availability — no single point of failure

**What Cassandra cannot do:**

```sql
-- This query will time out or simply fail on Cassandra
SELECT symbol, SUM(volume), AVG(price)
FROM trades
WHERE timestamp > now() - INTERVAL '7 days'
GROUP BY symbol
ORDER BY SUM(volume) DESC;
```

Analytics on Cassandra requires pulling data out to Spark/Flink for external processing.

**Choose ClickHouse** for dashboards, reports, and aggregations spanning months of data.  
**Choose Cassandra/ScyllaDB** for high-throughput transactional writes, key-based lookups, multi-region deployments.

---

### ClickHouse vs PostgreSQL / TimescaleDB

**TimescaleDB** is PostgreSQL with a time-series extension:
- Automatically partitions data into **time-based chunks** → dropping old data is nearly instant
- Adds **columnar compression** for older chunks (significant disk savings)
- Retains full ACID, JOINs, and the entire Postgres ecosystem

**TimescaleDB's limits at large scale:**
- Still a row-based engine at its core — aggregate scans across months/years are slower than ClickHouse
- Columnar compression only applies to already-compressed (older) chunks; incoming data remains row-based
- At TB+ scale with dozens of concurrent analytics queries, ClickHouse wins clearly

**Choose TimescaleDB** when you already run Postgres, need ACID + JOINs, and data stays below ~2 TB.  
**Choose ClickHouse** when the sole goal is fast ingest and sub-second analytics at scale.

---

## 3. Pros & Cons of Each Database

### ClickHouse

**Pros:**
- **Extreme aggregate speed** — scan billions of rows with SUM/AVG/GROUP BY in seconds via columnar storage + SIMD vectorisation
- **Outstanding compression** — numerics of the same type stored contiguously; LZ4/ZSTD achieves 5–10× compression, slashing disk I/O
- **No index needed for fast analytics** — full column scan is still faster than a row DB with an index for aggregate workloads
- **Automatic Materialized Views** — incremental pre-aggregation on insert, no external job needed
- **Automatic sparse index** — `ORDER BY` key creates a natural granule-skipping index
- **Horizontal scale** — Distributed/ReplicatedMergeTree shards and replicates across nodes
- **Familiar SQL** — close to ANSI SQL; low learning curve

**Cons:**
- **No ACID transactions** — no rollback, no isolation levels
- **Update/Delete is very expensive** — `ALTER TABLE ... UPDATE/DELETE` (mutations) run asynchronously in the background
- **Append-only mindset required** — designed for insert-only; any "update" is overhead
- **Deduplication is not immediate** — `ReplacingMergeTree` deduplicates during background merges, which can take hours or days to complete fully
- **JOIN is limited** — the left table must fit in RAM of the receiving node; large-to-large JOINs are very slow
- **Slow point lookups** — querying a single row by a random ID is not a strength
- **Hard to fix bad schema ingestion** — correcting mis-ingested data requires mutations or drop+rebuild

---

### PostgreSQL

**Pros:**
- **Full ACID** — transactions, rollback, isolation levels (Read Committed, Repeatable Read, Serializable)
- **Strong JOINs** — Hash Join, Nested Loop, Merge Join; query planner optimises well
- **Largest ecosystem** — extensions (PostGIS, pgvector, TimescaleDB, Citus), tooling (pgAdmin, pgBadger, pg_stat_statements)
- **Flexible schema** — JSONB for semi-structured data, arrays, hstore
- **MVCC** — reads do not block writes; writes do not block reads
- **Battle-tested** — 35+ years of development; obscure corner-case bugs are rare
- **Fast point lookups** — B-Tree index + buffer pool gives micro-second single-row access

**Cons:**
- **Row-based storage** — analytics queries read full rows even when only one column is needed
- **Primarily vertical scaling** — horizontal scale requires complex extensions (Citus, Patroni)
- **B-Tree degrades when index exceeds RAM** — random disk I/O kills upsert throughput at large scale
- **VACUUM overhead** — MVCC dead tuples accumulate and must be cleaned up; write-heavy tables need careful autovacuum tuning
- **Write amplification** — WAL + heap + all indexes must be updated on every write
- **Not great for pure time-series** — manual partitioning, no built-in auto-chunk-drop like TimescaleDB

---

### TimescaleDB (PostgreSQL + time-series extension)

**Pros:**
- **Automatic chunk-based partitioning** — data is split by time; dropping old chunks = dropping a file, instant with no scan
- **Columnar compression for old chunks** — closed chunks are column-compressed, saving 90%+ disk
- **Continuous Aggregates** — materialized views that refresh incrementally on new data
- **Data retention policies** — `add_retention_policy(interval => '90 days')` auto-drops old data
- **Retains all of Postgres** — full ACID, JOINs, extensions, and tooling still work
- **Time-series hyperfunctions** — `time_bucket`, `first`, `last`, `histogram` feel natural

**Cons:**
- **Still row-based for fresh data** — the active (open) chunk is not yet compressed; recent-data queries are still row scans
- **Slower than ClickHouse at large scale** — at TB+ with many concurrent analytics queries, Postgres planner + row format falls behind
- **Extension version coupling** — TimescaleDB version must match the PostgreSQL major version; upgrades are more involved than vanilla Postgres
- **Continuous Aggregate lag** — refresh is not instantaneous; not fully real-time
- **Multi-node requires Enterprise license or Citus** — horizontal scale is not trivial

---

### Cassandra / ScyllaDB

**Pros:**
- **Best write throughput** — writes land in MemTable (RAM) immediately with no disk read; millions of writes/second
- **Linear horizontal scale** — add a node, add capacity; no single master bottleneck
- **Multi-datacenter active-active** — simultaneous writes across DCs with automatic replication
- **Tunable consistency** — choose `QUORUM`, `ONE`, or `LOCAL_QUORUM` per query to trade latency vs consistency
- **Natural LWW deduplication** — upsert needs no read; duplicates eliminated during compaction
- **No single point of failure** — all nodes are equal (peer-to-peer); one node dying does not take down the cluster
- **ScyllaDB** — C++ rewrite of Cassandra; significantly lower latency and better CPU efficiency

**Cons:**
- **No analytics** — GROUP BY, SUM, aggregate scans across the whole table: not possible or extremely slow
- **No JOINs** — data model must be fully denormalised; often requires multiple tables for the same data
- **Tombstone amplification** — DELETEs leave tombstones instead of removing data immediately; too many tombstones slow reads and waste memory
- **Rigid query-driven schema design** — must know query patterns before designing tables; changing them often means redesigning the schema
- **Eventual consistency** — data may be stale when reading with low consistency levels
- **No real transactions** — Lightweight Transactions (LWT) provide partial ACID but are very slow (Paxos round-trip)
- **Compaction overhead** — background merges consume CPU/disk I/O and can spike latency during peak hours

---

### MySQL

**Pros:**
- **Simple and ubiquitous** — lowest learning curve, most documentation, most DBAs know it
- **InnoDB ACID** — transactions, foreign keys, row-level locking
- **Easy replication** — master-slave and GTID-based replication is straightforward to set up
- **Lightweight** — runs on modest hardware; fine for small applications
- **Web ecosystem** — PHP/Laravel, WordPress, Drupal integrate naturally

**Cons:**
- **Fully row-based** — full table scan is as bad as PostgreSQL; no columnar option
- **Weaker query planner than Postgres** — frequently chooses sub-optimal execution plans for complex queries
- **Poor semi-structured data support** — JSON support is far behind PostgreSQL's JSONB
- **Hard to scale horizontally** — manual sharding or Vitess (complex)
- **Oracle-owned** — licensing and roadmap are not community-driven like PostgreSQL
- **No extension system** — cannot add capabilities the way Postgres extensions can

---

### Summary Table

| Database | Best for | Avoid when |
|----------|----------|------------|
| **ClickHouse** | Analytics, aggregate queries, large-scale time-series | Transactions required, frequent updates, point lookups |
| **PostgreSQL** | General-purpose OLTP, complex JOINs, ACID mandatory | TB+ pure analytics, extremely high write throughput |
| **TimescaleDB** | Time-series + SQL/JOINs still needed, data up to ~2 TB | Larger scale, team lacks Postgres experience |
| **Cassandra / ScyllaDB** | Write-heavy, multi-region, absolute high availability | Analytics, JOINs, transactions |
| **MySQL** | Small-to-medium web apps, MySQL-familiar teams | Analytics, large scale, complex queries |

---

## 4. Deduplication — Core Differences

### Cassandra / ScyllaDB — Dedup on Write (Last Write Wins)

**Mechanism:**

Cassandra has no separate `INSERT` vs `UPDATE` — every write is an **UPSERT**:

```
Write path:
  1. Receive new record → write to MemTable (RAM) with a timestamp
  2. Flush to SSTable (disk) when MemTable fills
  3. Background compaction: merge SSTables; on duplicate key → keep the highest timestamp (LWW)
```

**Why it's excellent for dedup:**
- No disk read is needed to check for an existing record → **writes are never blocked by reads**
- Pure write throughput: millions of ops/second
- Duplicates are silently eliminated during compaction — zero application logic needed

```python
# Cassandra: write unconditionally — the system handles dedup
session.execute(
    "INSERT INTO trades (id, volume, price) VALUES (?, ?, ?)",
    [trade_id, volume, price]
)
# If trade_id already exists → automatically overwritten by LWW
```

---

### PostgreSQL — B-Tree Dedup: Fast at Medium Size, Breaks at Large Size

**Mechanism:**

```sql
INSERT INTO trades (id, volume, price)
VALUES (1, 500, 60000)
ON CONFLICT (id) DO UPDATE SET volume = EXCLUDED.volume;
```

**Physical process:**

1. Postgres traverses the B-Tree index on `id` to find a conflicting row
2. **B-Tree fits in RAM?** → Lookup is in-memory, disk I/O is negligible
3. **B-Tree exceeds RAM?** → Must fetch B-Tree pages from disk

**Why it breaks at large scale:**

```
Medium DB (index < RAM):
  INSERT → B-Tree lookup in RAM → check → write → done
  Disk I/O: near zero for the check phase

Large DB (index >> RAM):
  INSERT with random ID → B-Tree lookup → required page not in RAM
  → fetch random page from disk (Random I/O, ~100× slower than Sequential I/O)
  → insert throughput drops from ~100k/s to a few thousand/s
```

**Practical breaking point:** Once the B-Tree index exceeds ~50–70% of available RAM, upsert performance degrades sharply due to random disk I/O.

---

### ClickHouse — Eventual Dedup (ReplacingMergeTree)

**Mechanism:**

ClickHouse is an **append-only** engine — it cannot check for existing rows at write time (there is no read in the write path).

```sql
CREATE TABLE trades (
    id       String,
    volume   Float64,
    price    Float64,
    version  UInt64   -- typically a Unix timestamp
) ENGINE = ReplacingMergeTree(version)
ORDER BY id;
```

**Write path:**

```
INSERT → written immediately into a new Part (no duplicate check)
Background: ClickHouse periodically merges Parts → only during merge are duplicates removed (keeps highest version)
```

**The problem:**

```sql
-- A query immediately after INSERT may return duplicates because merge has not yet run
SELECT * FROM trades;  -- id=1 may appear twice

-- Solution 1: FINAL keyword (slow — forces dedup at query time)
SELECT * FROM trades FINAL;

-- Solution 2: use aggregation instead of raw scan
SELECT id, argMax(volume, version), argMax(price, version)
FROM trades
GROUP BY id;
```

**Trade-offs:**

| Approach | Write speed | Read speed | Correctness |
|----------|------------|------------|-------------|
| `FINAL` keyword | ⭐⭐⭐⭐⭐ | ⭐⭐ slow | ✅ exact |
| `argMax` aggregate | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ✅ exact |
| No dedup | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ❌ duplicates present |

---

### Dedup Decision Table

| Requirement | Best fit | Reason |
|-------------|----------|--------|
| Immediate, exact dedup + fast writes | **Cassandra / ScyllaDB** | LWW upsert needs no read |
| Exact dedup + ACID + medium data size | **PostgreSQL** | B-Tree index lives in RAM |
| Exact dedup + large data + transactions | **PostgreSQL + partitioning / TimescaleDB** | Chunk-based keeps individual indexes small |
| Eventual dedup is acceptable, analytics is priority | **ClickHouse ReplacingMergeTree** | Background merge + `FINAL` / `argMax` when needed |
| PostgreSQL B-Tree thrashing random I/O | Migrate to **ClickHouse** or **Cassandra** | Index exceeds RAM → random disk I/O kills throughput |

---

## 5. Redis Streams vs Apache Kafka

Both act as message brokers for streaming pipelines, but they are built on fundamentally different architectures with very different operational trade-offs.

---

### Architecture Overview

**Redis Streams**

Redis Streams is an append-only log data structure built **inside Redis** (an in-memory data store). Messages live in memory by default; persistence is best-effort via RDB/AOF snapshots.

```
Producer → XADD mystream * field value
Consumer → XREAD COUNT 100 STREAMS mystream 0
           XREADGROUP GROUP workers consumer1 COUNT 100 STREAMS mystream >
```

Key concepts:
- **Stream** = named append-only log inside a Redis key
- **Consumer Group** = tracks which messages each consumer has processed (like Kafka consumer groups)
- **Message ID** = `<millisecondTimestamp>-<sequenceNumber>` — built-in ordering

**Apache Kafka**

Kafka is a **dedicated distributed log system** built from the ground up for durable, high-throughput, fault-tolerant event streaming. Messages are written to disk in immutable, sequentially-appended log segments.

```
Producer → KafkaProducer.send(topic, key, value)
Consumer → KafkaConsumer.poll() with committed offsets per partition
```

Key concepts:
- **Topic** = named log split into N **Partitions**
- **Partition** = ordered, immutable, append-only log on disk
- **Offset** = each message's position in a partition — consumers track their own offset
- **Consumer Group** = each partition is assigned to exactly one consumer per group

---

### Deep Comparison

| Criterion | Redis Streams | Apache Kafka |
|-----------|--------------|-------------|
| **Primary storage** | In-memory (optional disk via AOF/RDB) | Disk-first (always persisted) |
| **Throughput** | ~500k–1M msg/s (small messages, single node) | ~1–10M+ msg/s (with partitioning) |
| **Latency** | Sub-millisecond (memory) | 1–10ms (disk fsync + network) |
| **Durability** | Best-effort — data lost on crash without AOF | Guaranteed — survives broker restarts |
| **Retention** | Limited by RAM + `MAXLEN` trim | Days, weeks, or indefinite (disk-bound) |
| **Replay** | Yes, by consumer group offset or message ID | Yes, by partition offset |
| **Ordering** | Global per stream | Per partition only |
| **Horizontal scale** | Limited — Redis Cluster shards keys, not streams natively | Native — add partitions and brokers |
| **Consumer groups** | Built-in (XREADGROUP) | Built-in (core feature) |
| **Ops complexity** | Low — already in your Redis stack | High — ZooKeeper/KRaft, Kafka cluster, monitoring |
| **Cost** | Cheap if Redis is already deployed | Separate cluster: VMs + storage + ops time |
| **Ecosystem** | Minimal | Rich — Kafka Connect, Kafka Streams, ksqlDB, Schema Registry |

---

### Redis Streams — Unique Strengths

1. **Zero additional infrastructure** — if you already run Redis, you get a message broker for free
2. **Sub-millisecond latency** — data stays in RAM; no disk flush in the hot path
3. **Simple operational model** — one tool, one config, one monitoring surface
4. **Automatic trimming** — `XADD mystream MAXLEN ~ 100000 * ...` keeps memory bounded without a separate retention policy job
5. **Tight integration** with Redis data structures — can atomically read a stream and update a hash/sorted-set in one `MULTI/EXEC` block

**Ideal for:**
- Low-to-medium throughput pipelines (up to a few hundred thousand msg/s)
- Latency-sensitive paths where sub-ms matters
- Projects that already use Redis and want to avoid a second broker
- Short-lived events where replay beyond a few hours is not required

**Weaknesses:**
- Memory is expensive — large backlogs cost RAM, not cheap disk
- No partition-level parallelism: a single stream is a single log; scaling means splitting streams manually in application code
- Durability is weaker — `AOF fsync=always` closes the gap but adds latency; `fsync=everysec` risks ~1 second of data loss on crash
- No built-in schema registry, no connector ecosystem

---

### Apache Kafka — Unique Strengths

1. **Disk-based durability** — data survives crashes, broker restarts, and controlled rolling upgrades
2. **Infinite retention** — store events for 30 days or forever; consumers can replay months of history
3. **Partition-level parallelism** — 100 partitions = 100 consumers reading simultaneously with no coordination overhead
4. **Exactly-once semantics** — idempotent producers + transactional consumers guarantee no duplicates and no data loss
5. **Rich ecosystem** — Kafka Connect (100+ source/sink connectors), Kafka Streams (stateful stream processing), ksqlDB (SQL on streams), Schema Registry (Avro/Protobuf schemas)
6. **Replayability** — a new downstream service can consume the entire event history from offset 0

**Ideal for:**
- High-throughput pipelines: millions of events/second
- Event sourcing or audit logs that must be durable and replayable
- Fan-out: one topic consumed by multiple independent services
- Pipelines where exactly-once delivery is a hard requirement
- Long-term event retention (compliance, ML training datasets)

**Weaknesses:**
- **Operational complexity** — managing a Kafka cluster (brokers, replication factor, partition count, consumer lag monitoring) is a full-time concern
- **Higher latency floor** — disk-based fsync adds milliseconds; not suitable for sub-ms requirements
- **Over-engineered for small workloads** — standing up a 3-broker Kafka cluster for 10k msg/s is wasteful
- **Cost** — dedicated VMs + EBS/SSD storage + ops tooling adds up quickly

---

### NATS / NATS JetStream — What It Is and Why It Matters

**What NATS is:**

NATS is an **ultra-lightweight** message broker written in Go, designed for extreme low latency and operational simplicity. It has two fundamentally different modes:

```
NATS Core (pure pub-sub):
  Publisher → Subject "trades.BTC" → Subscriber receives immediately
  Fire-and-forget: no storage, no replay, subscriber offline = message lost

NATS JetStream (persistent streaming):
  Publisher → Stream "TRADES" → Consumer group → ACK → stored on disk
  Supports replay, consumer groups, at-least-once delivery
```

**Physical architecture:**
- NATS server is a single Go binary (~20 MB), zero external dependencies
- Cluster: 3–5 nodes using Raft consensus — self-electing, no ZooKeeper required
- JetStream stores messages in files on disk, organised by stream + subject
- Each message has a sequence number; consumers track their own offset

**NATS JetStream vs Redis Streams vs Kafka:**

| Criterion | NATS JetStream | Redis Streams | Apache Kafka |
|-----------|---------------|--------------|-------------|
| **Latency** | < 1ms (near Redis) | Sub-ms | 1–10ms |
| **Throughput** | ~3–10M msg/s | ~500k–1M msg/s | ~1–10M+ msg/s |
| **Durability** | Disk-based (Raft) | Best-effort (AOF) | Disk-based (ISR) |
| **Ops complexity** | Very low — single binary | Low | High (ZooKeeper/KRaft) |
| **Horizontal scale** | Good (Raft cluster) | Limited | Native — best |
| **Replay** | Yes (sequence offset) | Yes (message ID) | Yes (partition offset) |
| **Ordering** | Per subject | Per stream | Per partition |
| **Exactly-once** | No | No | Yes (transactional) |
| **Ecosystem** | Small but growing | Minimal | Largest |
| **Wildcard subscriptions** | ⭐⭐⭐⭐⭐ extremely powerful | ❌ none | ❌ none |
| **Request-Reply** | Native built-in | No | No |
| **Binary size** | ~20MB | Depends on Redis | 100MB+ |

---

**NATS — Unique Strengths:**

1. **Powerful wildcard routing** — subscribe to `trades.>` to receive all subjects starting with `trades.`; `trades.*` matches one level; no other broker has native subject-level pattern matching like this
2. **Request-Reply built-in** — client sends a request and waits for a reply; building sync/async microservices feels natural
3. **Operationally trivial** — one binary, no dependencies, Raft-based self-electing cluster; up and running in seconds
4. **Latency close to Redis** — JetStream buffers in memory before flushing to disk; sub-millisecond is achievable
5. **Multi-tenancy** — native Account isolation; multiple teams can safely share one NATS cluster
6. **Leaf Nodes** — lightweight nodes at the edge or in remote locations connect back to a central NATS cluster with transparent message bridging

**NATS — Weaknesses:**

- **Much smaller ecosystem than Kafka** — no connector ecosystem, no ksqlDB, no Schema Registry
- **No exactly-once** — JetStream is at-least-once only; dedup must be handled at the application or database layer
- **Weaker partition-level scale than Kafka** — Kafka's partition model is more flexible for extreme horizontal scale
- **NATS Core drops messages when subscriber is offline** — without JetStream there is no buffer
- **Less battle-tested at hyperscale** — Kafka has a track record at Netflix/LinkedIn/Uber; NATS JetStream is younger
- **Smaller monitoring ecosystem** — no rich dashboards like Confluent Control Center or Cruise Control for Kafka

**NATS is the right choice when:**
- Microservices need both pub-sub and request-reply on the same broker
- You want Kafka-like durability with far simpler operations (JetStream)
- IoT / edge computing: small nodes at the edge, leaf nodes bridging to a central cluster
- Sub-millisecond latency is required but Redis Streams durability is insufficient
- Complex subject-based routing patterns: `sensor.region1.device42.temperature`

---

### Decision Guide: Redis Streams vs Kafka vs NATS

```
Exactly-once delivery is a hard requirement (no compromise)?
  └─ Yes → Kafka (transactional producers — the only one of the three with this)

Volume > 10M msg/s or need extreme partition-level horizontal scale?
  └─ Yes → Kafka

Multiple independent consumers need to replay full history (audit log, ML training)?
  └─ Yes → Kafka (long-term retention, any consumer can start from offset 0)

Need request-reply + pub-sub + wildcard routing on the same broker?
  └─ Yes → NATS (native request-reply, subject patterns: `sensor.*.temp`)

Want Kafka-like durability but much simpler ops, exactly-once not required?
  └─ Yes → NATS JetStream (single binary, Raft cluster, < 1ms latency)

IoT / edge / microservices with many complex subject hierarchies?
  └─ Yes → NATS (leaf nodes, wildcard `trades.>`, native multi-tenancy)

Already running Redis + small backlog + latency-sensitive + don't want a second broker?
  └─ Yes → Redis Streams (zero extra infra, sub-ms, atomic with MULTI/EXEC)

Simple stack, small team, moderate scale, want clear durability?
  └─ NATS JetStream

Simple stack, small team, Redis already deployed, replay not critical?
  └─ Redis Streams
```

---

### Why fullstackAI Uses Redis Streams (Not Kafka)

The project ingests Binance trade events and routes them to ClickHouse for analytics:

| Factor | Redis Streams verdict |
|--------|-----------------------|
| Already in the stack | ✅ Redis is used for caching and rate-limiting anyway |
| Message volume | Binance WebSocket: ~5–50k msg/s per symbol — well within Redis Streams capacity |
| Latency | Sub-ms from Binance consumer to ClickHouse writer is desirable for live charts |
| Retention requirement | Events are persisted in ClickHouse; the stream is a transit buffer, not a source of truth |
| Replay | ClickHouse is the replay source; broker replay is not needed |
| Operational cost | Running a 3-node Kafka cluster for this scale is unnecessary overhead |

**Kafka would be the right choice** if: the system needed to fan-out trade events to 5+ independent downstream services, required exactly-once delivery at the broker level, or retention in the broker itself (not ClickHouse) was a compliance requirement.

---

## 6. fullstackAI Stack Summary

| Layer | Choice | Why |
|-------|--------|-----|
| **Market data source** | Binance WebSocket | Real-time trade events |
| **Message broker** | Redis Streams | Already in stack, sub-ms latency, adequate throughput |
| **Analytics store** | ClickHouse | Columnar scan, no-index numeric queries in seconds, TB-scale |
| **Processing** | Pandas (batch) / Go Fiber (API) | Lightweight, no Spark/Flink overhead needed |
| **Frontend** | React | Standard dashboard UI |

**Ruled out:** Kafka (over-engineered for this scale), Spark (batch overhead for a streaming ingest), Cassandra/ScyllaDB (no analytics), PostgreSQL/TimescaleDB (row-based, slower at TB+ analytics scale), Airflow (scheduling overhead not needed).
