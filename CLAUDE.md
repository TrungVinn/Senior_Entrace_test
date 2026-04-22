# Project Context — fullstackAI

## What this is
An AI developer entrance test submission. Goal: end-to-end market data system from ingestion to a user-facing app. Graded spec is in `REQUIREMENTS.md` — treat it as the source of truth, never rewrite it.

## Stack (final — do not re-debate)
| Layer | Choice | Rejected alternatives |
|-------|--------|-----------------------|
| Data source | Binance WebSocket (kline + trade stream) | TradingView, Yahoo Finance |
| Message broker | Redis Streams (XADD/XREADGROUP) | Kafka, RabbitMQ |
| Stream processor | Pandas micro-batch (standalone) + Spark foreachBatch (Databricks) | Direct WS→Spark receiver |
| Analytics DB | ClickHouse `ReplacingMergeTree` | PostgreSQL, TimescaleDB, Cassandra |
| Backend | Go + Fiber, raw SQL (`database/sql` + `clickhouse-go/v2`) | GORM, Ent (banned by spec) |
| AI layer | Python: signal scoring + anomaly detection + regime classification | n/a |
| Frontend | React + Shadcn UI + Recharts | n/a |
| DevOps | Docker + docker-compose | n/a |

## Hard constraints from spec
- **No ORM** — raw SQL only (`database/sql`, `sqlx`, `pgx`, or `clickhouse-go`)
- **Backend must follow template style** — `cmd/main.go`, `internal/config`, `internal/db`, `internal/middlewares`, `internal/v1/...`, `internal/v2/...`, `internal/api`
- **Template code is off-limits** — do not touch original template files (UI components, backend scaffold, jobs utils). See `AI.md` for the boundary
- `REQUIREMENTS.md` is the grading brief — never edit it

## Directory map
```
fullstackAI/
├── backend/             # Go Fiber API
│   ├── cmd/main.go      # entrypoint
│   └── internal/
│       ├── v1/          # market data endpoints (handlers/repos/routes)
│       ├── v2/          # AI signal endpoints
│       ├── config/      # env bootstrap
│       ├── db/          # ClickHouse + Redis init
│       ├── middlewares/ # auth, logging, rate-limit
│       ├── api/         # shared HTTP response helpers
│       └── models/      # shared structs
├── jobs/                # Python data pipeline
│   └── src/
│       ├── stream/      # producer.py (WS→Redis), processor.py (Redis→ClickHouse)
│       ├── ai/          # signal_scoring.py, anomaly_detection.py, regime_classification.py
│       ├── common/      # features.py (SMA, RSI, VWAP, volatility) — shared by batch+stream
│       └── utils/       # logger.py, database.py (template, do not rewrite)
├── src/                 # React frontend
│   ├── app/
│   │   ├── lib/api.ts       # typed fetch wrapper
│   │   └── hooks/usePolling.ts
│   └── imports/         # UI components (mostly template)
├── sql/
│   ├── clickhouse_schema.sql       # market_klines_stream, market_latest_price
│   └── clickhouse_ai_schema.sql    # ai_signals, ai_anomalies, ai_regimes
├── docker-compose.yml   # local full-stack
├── docker-compose.cloud.yml
├── REQUIREMENTS.md      # grading spec — read-only
├── TRADE_OFFS.md        # architecture decisions (Redis vs Kafka, etc.)
├── CLICKHOUSE_DEEP_DIVE.md     # Vietnamese deep-dive notes (local reading)
├── CLICKHOUSE_DEEP_DIVE_EN.md  # English version (for GitHub)
└── AI.md                # AI attribution log
```

## Key architectural decisions (already made)
1. **Redis Streams not Kafka** — ~10 msg/s from Binance is well within Redis capacity; zero extra infra; Redis already in stack. Upgrade path to Kafka documented in `TRADE_OFFS.md`.
2. **ClickHouse ReplacingMergeTree** — `ORDER BY (symbol, timestamp)` + `version = ingestion_time`. Dedup via background merge; queries use `FINAL` or `argMax`. Columnar storage means aggregate scans on `volume`/`price` are fast even without index.
3. **foreachBatch not native Spark source** — no official Redis Streams Spark connector; Redis buffers unACK'd messages in PEL during Spark restarts.
4. **No ORM** — `database/sql` + `clickhouse-go/v2` with direct SQL strings. Nullable columns use `*float64`.
5. **AI is post-processing, not real-time ML** — three lightweight models: composite signal score (RSI+SMA+volume), Z-score+IsolationForest anomaly, volatility-percentile regime.

## ClickHouse schema (key tables)
```sql
-- Primary time-series table
market_klines_stream   ORDER BY (symbol, timestamp)   ENGINE ReplacingMergeTree(ingestion_time)
market_latest_price    ORDER BY (symbol)               ENGINE ReplacingMergeTree(ingestion_time)

-- AI output tables
ai_signals    ORDER BY (symbol, timestamp)
ai_anomalies  ORDER BY (symbol, timestamp)
ai_regimes    ORDER BY (symbol, timestamp)
```

## Backend API structure
- `GET /api/v1/market/symbols`        — list available symbols
- `GET /api/v1/market/latest`         — latest prices for all symbols
- `GET /api/v1/market/klines/:symbol` — OHLCV klines with features
- `GET /api/v2/ai/signals/:symbol`    — AI signal scores
- `GET /api/v2/ai/anomalies/:symbol`  — anomaly flags
- `GET /api/v2/ai/regimes/:symbol`    — market regime classification

## What's complete
- [x] Stream producer (Binance WS → Redis Streams)
- [x] Stream processor (Redis → ClickHouse, Pandas + Spark variants)
- [x] Batch pipeline + feature generation
- [x] AI: signal scoring, anomaly detection, regime classification
- [x] Backend API v1 (market) + v2 (AI) with raw SQL
- [x] Frontend: live data from backend, charts, AI panel
- [x] ClickHouse schema (both market + AI tables)
- [x] Docker + docker-compose (local + cloud)
- [x] Documentation: README, TRADE_OFFS, AI.md, SETUP_GUIDE

## Reference files
- Architecture trade-offs: `TRADE_OFFS.md`
- DB deep-dive (VN): `CLICKHOUSE_DEEP_DIVE.md`
- DB deep-dive (EN): `CLICKHOUSE_DEEP_DIVE_EN.md`
- Grading spec: `REQUIREMENTS.md`
- AI attribution: `AI.md`
