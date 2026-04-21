# Architecture Trade-offs & Design Decisions

## 1. Why Redis Streams over Kafka?

### Decision: Redis Streams as message broker

| Criteria | Redis Streams | Confluent Kafka | RabbitMQ |
|----------|--------------|-----------------|----------|
| **Setup complexity** | Low (single service) | High (ZooKeeper/KRaft + brokers) | Medium |
| **Operational cost** | Free tier 30MB; ~$5/mo small | $0.11/CKU-hour (~$80/mo min) | ~$15/mo (CloudAMQP) |
| **Consumer groups** | Native (XREADGROUP) | Native | Competing consumers pattern |
| **Ordering** | Per-stream guaranteed | Per-partition guaranteed | Per-queue (with limits) |
| **Persistence** | AOF/RDB + MAXLEN trim | Log-based, configurable retention | Ack-based |
| **Throughput** | ~500K msg/s (single node) | ~1M+ msg/s (clustered) | ~50K msg/s |
| **Backpressure** | MAXLEN auto-trim | Partition-based, consumer lag | Queue depth |
| **Spark connector** | None (use foreachBatch) | Native structured streaming | None |
| **Monitoring** | Redis INFO, RedisInsight | Confluent Cloud UI, JMX | Management UI |

### Why Redis wins for this use case:
1. **Scale fit**: Binance kline data for 5-10 symbols at 1m interval = ~10 msg/sec. Redis handles this trivially.
2. **Operational simplicity**: One service for both message broker + cache (if needed later).
3. **Cost**: Free tier is sufficient for development; $5-10/mo for production vs $80+/mo for Confluent Cloud.
4. **Consumer groups**: Redis Streams consumer groups provide the same semantics as Kafka consumer groups (ACK, pending messages, consumer failover).
5. **Already in stack**: The template already includes Redis as a dependency.

### When to upgrade to Kafka:
- >100 symbols or tick-level (trade) data (>10K msg/s sustained)
- Multi-consumer fanout to 5+ independent consumers
- Need for exactly-once semantics with transactional producers
- Regulatory requirement for long-term message retention (>7 days)

---

## 2. Why Micro-batch (foreachBatch) over Direct WebSocket to Spark?

### Decision: Rate source + foreachBatch pattern

**Option A (Chosen): WebSocket → Redis → Spark foreachBatch**
```
Binance WS → Producer → Redis Streams → Spark (rate source + foreachBatch) → ClickHouse
```

**Option B (Rejected): WebSocket directly to Spark custom receiver**
```
Binance WS → Spark Custom Receiver → Spark Processing → ClickHouse
```

### Comparison:

| Aspect | Redis + foreachBatch | Direct WS to Spark |
|--------|---------------------|-------------------|
| **Decoupling** | Producer and processor are independent | Tightly coupled |
| **Buffer** | Redis buffers during Spark restarts | Messages lost during restarts |
| **Failure recovery** | Consumer group tracks position | Must re-establish WS connection |
| **Scaling** | Multiple producers, multiple consumers | One receiver per stream |
| **Complexity** | Moderate (extra Redis hop) | High (custom Spark Source API) |
| **Latency** | +10-50ms (Redis round-trip) | Minimal |
| **Checkpointing** | Spark checkpoints + Redis ACK | Spark checkpoints only |
| **Testability** | Can test each component in isolation | Must test end-to-end |

### Why foreachBatch over native Spark source:
1. **No native Redis Streams connector**: Unlike Kafka, there's no official Spark Structured Streaming source for Redis Streams.
2. **Reliability**: If Spark restarts, Redis retains unACK'd messages in the consumer group's PEL (Pending Entries List).
3. **Separation of concerns**: Producer can run on a lightweight container; processor runs on Databricks with Spark.
4. **Rate source as clock**: The Spark "rate" source serves purely as a micro-batch trigger. Actual data reads happen in foreachBatch from Redis, giving full control over batching logic.

---

## 3. ClickHouse ReplacingMergeTree for Idempotency

### Why ReplacingMergeTree?
- **Deduplication on merge**: Rows with the same `ORDER BY` key `(symbol, timestamp)` are deduplicated during background merges.
- **`ingestion_time` as version**: The latest `ingestion_time` wins, so re-processing a batch is safe.
- **Query with `FINAL`**: `SELECT * FROM market_klines_stream FINAL` returns deduplicated results.

### Alternative considered: CollapsingMergeTree
- More complex (requires sign column)
- Better for mutable data with updates/deletes
- Overkill for append-mostly kline data

### Alternative considered: PostgreSQL with UPSERT
- Simpler writes (ON CONFLICT DO UPDATE)
- But: much slower for analytical queries (no columnar storage)
- ClickHouse is 10-100x faster for aggregation queries on time-series data

---

## 4. Monitoring Strategy

### Redis Monitoring
```bash
# Stream length (should stay bounded by MAXLEN)
redis-cli XLEN binance_market_data

# Consumer group lag (pending messages not yet ACK'd)
redis-cli XINFO GROUPS binance_market_data

# Detailed consumer info
redis-cli XINFO CONSUMERS binance_market_data market_processor

# Memory usage
redis-cli INFO memory
```

### Spark UI (Databricks)
- **Streaming tab**: Shows micro-batch progress, processing time, input rate
- **Key metrics**:
  - `inputRowsPerSecond` — should match producer rate
  - `processedRowsPerSecond` — should be >= input rate
  - `batchDuration` — should be < trigger interval (10s)

### ClickHouse System Tables
```sql
-- Query performance
SELECT query, elapsed, read_rows, read_bytes
FROM system.query_log
WHERE type = 'QueryFinish'
  AND query LIKE '%market_klines_stream%'
ORDER BY event_time DESC
LIMIT 20;

-- Table size
SELECT
    table,
    formatReadableSize(sum(bytes_on_disk)) AS size,
    sum(rows) AS rows,
    count() AS parts
FROM system.parts
WHERE database = 'default'
  AND table LIKE 'market%'
  AND active
GROUP BY table;

-- Stream lag (data freshness)
SELECT
    symbol,
    max(timestamp) AS latest_kline,
    dateDiff('second', max(timestamp), now()) AS lag_seconds
FROM market_klines_stream FINAL
GROUP BY symbol;
```

### Alerting Recommendations
| Metric | Threshold | Action |
|--------|-----------|--------|
| Redis stream length | > 50K (50% of MAXLEN) | Check if processor is consuming |
| Consumer group pending | > 1000 | Processor may be slow or down |
| Spark batch duration | > 10s (trigger interval) | Scale up cluster or reduce batch size |
| ClickHouse lag | > 60s | Check Spark processor status |
| Producer WebSocket reconnects | > 5/hour | Check network / Binance API status |

---

## 5. Batch vs Stream Pipeline Integration

Both pipelines share:
- **Same feature logic**: `common/features.py` (SMA, RSI, volatility, returns, VWAP)
- **Same ClickHouse schema**: Both write to tables with the same column layout
- **Same config pattern**: `config/settings.py` with env vars

| Aspect | Batch Pipeline | Stream Pipeline |
|--------|---------------|-----------------|
| **Source** | Binance REST API (historical) | Binance WebSocket (real-time) |
| **Frequency** | Scheduled (hourly/daily) | Continuous (10s micro-batch) |
| **Data range** | Full history backfill | Latest klines only |
| **Feature accuracy** | Full window context | Limited by batch size |
| **Use case** | Backfill, reprocessing, ML training | Real-time dashboard, alerts |

---

## 6. Known Limitations & Future Improvements

1. **Feature accuracy in streaming**: Window functions (SMA-99, RSI-14) in micro-batches only see the current batch. For production accuracy, consider joining with recent historical data from ClickHouse before computing features.

2. **Single consumer**: Current design uses one Spark consumer. For higher throughput, add more consumers to the group with different `consumer_name` values.

3. **Redis Cloud memory**: Free tier is 30MB. At ~1KB/message and MAXLEN=100K, this uses ~100MB. For production, size Redis appropriately.

4. **No exactly-once**: Redis Streams provides at-least-once delivery. ClickHouse's ReplacingMergeTree handles duplicates, but `FINAL` queries have a performance cost. Run `OPTIMIZE TABLE ... FINAL` periodically in production.
