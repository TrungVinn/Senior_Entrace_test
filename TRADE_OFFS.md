# Architecture Trade-offs & Design Decisions

## 1. Why Kafka on Aiven over Redis Streams?

### Decision: managed Kafka as the message broker

| Criteria | Kafka on Aiven | Redis Streams | RabbitMQ |
|----------|----------------|---------------|----------|
| Setup | Managed service, SSL certs from Aiven | Simple single service | Managed or self-hosted |
| Consumer groups | Native, mature | Native, lighter-weight | Competing consumers |
| Replay / retention | Strong log retention model | Limited by memory / trimming | Queue-oriented |
| Monitoring | Kafka UI, Aiven metrics, consumer lag | RedisInsight, stream length | Management UI |
| Scale path | Partitions and multiple consumers | Good for small streams | Good work queue |
| Cost / ops | Higher than Redis, lower ops burden than self-hosted Kafka | Lowest cost | Moderate |

Kafka is heavier than Redis Streams, but it gives the submission a clearer production story: durable log, consumer lag, replayability, SSL/TLS-managed broker, and easier fanout if more downstream consumers are added later.

### Why Kafka fits this project

1. **At-least-once stream processing**: producer publishes keyed messages; processor commits offsets only after ClickHouse insert.
2. **Replayability**: recent topic history can be replayed to rebuild ClickHouse rows or test feature changes.
3. **Operational visibility**: Kafka UI exposes topic throughput and consumer lag, which is easy to explain in a demo.
4. **Upgrade path**: more symbols, extra consumers, and additional AI jobs can be added without changing the producer contract.

### Why Redis Streams was rejected

Redis Streams would be cheaper and simpler for 5 symbols at 1m candles, but it is less compelling for message retention and replay in a market data system demo. The current code uses Kafka in `stream/producer.py`, `stream/processor_standalone.py`, Docker, and `.env.example`.

---

## 2. Why Micro-batch Processor over Direct Writes?

### Decision: producer and processor are decoupled

```
Binance WS → Producer → Kafka → Processor → ClickHouse
```

Alternative:

```
Binance WS → Producer → ClickHouse
```

| Aspect | Kafka + Processor | Direct Writes |
|--------|-------------------|---------------|
| Failure recovery | Kafka retains messages until consumed | Producer must handle all retry logic |
| Backpressure | Consumer lag is visible | Backpressure hits WebSocket process |
| Feature generation | Centralized in processor | Mixed into producer |
| Reprocessing | Replay topic offsets | Needs separate historical path |
| Complexity | More moving parts | Simpler but less resilient |

The processor is the correct place to normalize records, deduplicate, compute features, write to ClickHouse, and commit offsets.

---

## 3. ClickHouse ReplacingMergeTree for Idempotency

### Why ReplacingMergeTree?

- Rows are keyed by `(symbol, timestamp)`.
- `ingestion_time` acts as the version column.
- Reprocessing the same candle writes a newer replacement row.
- Backend uses `FINAL` where deduplicated reads matter.

### Alternatives considered

| Alternative | Why not |
|-------------|---------|
| PostgreSQL UPSERT | Simpler, but weaker for analytical time-series scans |
| TimescaleDB | Good time-series ergonomics but less efficient for columnar OLAP |
| CollapsingMergeTree | More complex than needed for append-mostly candle data |

---

## 4. Batch vs Stream Features

Both batch-style and stream-style paths share `jobs/src/common/features.py`.

| Aspect | Stream Pipeline | Batch / Backfill Path |
|--------|-----------------|-----------------------|
| Source | Binance WebSocket through Kafka | Binance REST / historical fetch |
| Frequency | Continuous micro-batches | Scheduled or manual |
| Strength | Live dashboard | Full historical context |
| Limitation | Rolling windows only see current batch in current implementation | Slower, not real-time |

Known limitation: current Pandas stream processing computes rolling windows inside the current micro-batch. For production accuracy, the processor should join recent historical candles from ClickHouse, keep per-symbol state, or run periodic backfills to repair features.

---

## 5. AI Post-processing Strategy

The AI layer is intentionally interpretable:

- **Signal scoring**: RSI, SMA crossover, and volume components produce `BUY`, `SELL`, or `NEUTRAL`.
- **Anomaly detection**: Z-score plus Isolation Forest catches unusual price/volume behavior.
- **Regime classification**: volatility percentiles classify low/medium/high volatility environments.

These outputs are persisted in ClickHouse, exposed by the Go API, and displayed in the Intelligence tab.

Known limitation: current AI jobs use global `LIMIT` queries. For production, select a fixed recent window per symbol, for example with a ClickHouse `row_number() OVER (PARTITION BY symbol ORDER BY timestamp DESC)` pattern.

---

## 6. Frontend Product Decisions

### Intelligence tab

The Intelligence tab is designed for both technical and non-technical users:

- Market Pulse summarizes signal mix, anomaly count, symbol coverage, and AI freshness.
- Signal Center exposes scores and component breakdowns.
- Market Story translates market conditions into plain language.
- Anomaly Timeline and Regime Matrix keep technical details visible.
- Gemini panel is optional and experimental; it is browser-side and should be moved server-side before public deployment.

### Simulator tab

The Simulator tab deliberately avoids AI. It answers a concrete user question: "If I bought this coin N candles ago, what would it be worth now?"

It uses Binance public REST directly because it needs flexible intervals (`1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`) that are broader than the backend's current stored 1m stream. This improves demo value without complicating the backend.

---

## 7. Monitoring Strategy

### Kafka

- Topic message rate.
- Consumer group lag for `market_processor`.
- Consumer restart/error rate.

Kafka UI runs at:

```text
http://localhost:8090
```

### ClickHouse

```sql
SELECT
  symbol,
  max(timestamp) AS latest_kline,
  dateDiff('second', max(timestamp), now()) AS lag_seconds
FROM market_klines_stream FINAL
GROUP BY symbol;

SELECT
  table,
  formatReadableSize(sum(bytes_on_disk)) AS size,
  sum(rows) AS rows
FROM system.parts
WHERE database = 'default'
  AND active
GROUP BY table;
```

### Backend / Frontend

- `/health` reports backend status and ClickHouse connection state.
- Intelligence tab marks AI output as stale if latest signal timestamp is older than 5 minutes.

---

## 8. Known Limitations & Future Improvements

1. **Rolling feature accuracy**: join recent historical rows or keep rolling state per symbol.
2. **AI query sampling**: change global `LIMIT` queries to per-symbol windows.
3. **Gemini key exposure**: move LLM calls behind Go backend for public deployments.
4. **Placeholder tabs**: VN Equities, Overview, Order Book, Market Overview, and NewsPanel are UI shells; the current production data path is crypto.
5. **Type checking**: Vite build passes, but the repo does not currently include `typescript` or a `tsc --noEmit` script.
6. **Simulator source split**: Simulator uses Binance REST directly, while charts use backend ClickHouse data. This is intentional for interval flexibility but should be documented in demos.
