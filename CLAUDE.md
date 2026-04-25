# Project Context — fullstackAI

## What this is
An AI developer entrance test submission. Goal: end-to-end market data system from ingestion to a user-facing app. Graded spec is in `REQUIREMENTS.md`; treat that file as read-only source material.

## Stack
| Layer | Choice | Rejected alternatives |
|-------|--------|-----------------------|
| Data source | Binance WebSocket for realtime klines; Binance REST for Simulator historical candles | TradingView, Yahoo Finance |
| Message broker | Kafka on Aiven with SSL/TLS (`aiokafka` producer, `confluent-kafka` consumer) | Redis Streams, RabbitMQ |
| Stream processor | Pandas micro-batch standalone processor; Spark/Databricks variant retained as optional reference | Direct WebSocket receiver inside Spark |
| Analytics DB | ClickHouse `ReplacingMergeTree` | PostgreSQL, TimescaleDB, Cassandra |
| Backend | Go + Fiber, raw SQL (`database/sql` + `clickhouse-go/v2`) | GORM, Ent (banned by spec) |
| AI layer | Python: signal scoring, anomaly detection, regime classification | Black-box model-only approach |
| Frontend | React + Vite + Tailwind, Lightweight Charts, Recharts, resizable panels | Static dashboard |
| DevOps | Docker + docker-compose | Manual multi-terminal only |

## Hard constraints from spec
- **No ORM** — raw SQL only (`database/sql`, `sqlx`, `pgx`, or `clickhouse-go`).
- **Backend must follow template style** — `cmd/main.go`, `internal/config`, `internal/db`, `internal/middlewares`, `internal/v1/...`, `internal/v2/...`, `internal/api`.
- **Template code exists** — avoid broad rewrites of generated Shadcn/UI components and scaffold files unless a feature requires it.
- `REQUIREMENTS.md` is the grading brief — do not edit it.

## Directory map
```
fullstackAI/
├── backend/
│   ├── cmd/main.go
│   └── internal/
│       ├── v1/          # market + AI endpoints backed by ClickHouse
│       ├── v2/          # portfolio mock scaffold
│       ├── config/      # env bootstrap
│       ├── db/          # ClickHouse init
│       ├── middlewares/
│       ├── api/
│       └── models/
├── jobs/
│   └── src/
│       ├── stream/      # producer.py (Binance WS→Kafka), processor_standalone.py (Kafka→ClickHouse)
│       ├── ai/          # signal_scoring.py, anomaly_detection.py, regime_classification.py
│       ├── common/      # features.py (SMA, RSI, VWAP, volatility)
│       └── utils/
├── src/
│   └── app/
│       ├── App.tsx
│       ├── lib/api.ts
│       ├── hooks/usePolling.ts
│       └── components/
│           ├── TradingChart.tsx
│           ├── Watchlist.tsx
│           ├── IntelligencePanel.tsx
│           └── Simulator.tsx
├── sql/
│   ├── clickhouse_schema.sql
│   └── clickhouse_ai_schema.sql
├── docker-compose.yml
├── docker-compose.cloud.yml
├── README.md
├── SETUP_GUIDE.md
├── TRADE_OFFS.md
├── AI.md
└── REQUIREMENTS.md
```

## Key architectural decisions
1. **Kafka on Aiven over Redis Streams** — managed broker, SSL/TLS, consumer groups, Kafka UI monitoring, and a clearer upgrade path for more symbols or additional consumers.
2. **ClickHouse ReplacingMergeTree** — `ORDER BY (symbol, timestamp)` plus `ingestion_time` version supports idempotent reprocessing; backend queries use `FINAL` for deduplicated reads.
3. **Micro-batch processor** — standalone Pandas processor is the practical default; Spark/Databricks files remain as optional/reference implementation.
4. **No ORM** — backend uses `database/sql` and direct SQL strings against ClickHouse.
5. **AI as interpretable post-processing** — signal scoring, anomaly detection, and regime classification are stored back into ClickHouse and consumed by the dashboard.
6. **Non-technical product affordances** — Market Story translates technical signals into plain English, and Simulator answers "what if I bought then?" using historical candles.

## ClickHouse schema
```sql
market_klines_stream   ORDER BY (symbol, timestamp)   ENGINE ReplacingMergeTree(ingestion_time)
market_latest_price    ORDER BY (symbol)               ENGINE ReplacingMergeTree(ingestion_time)
market_ohlcv_1h        AggregatingMergeTree            hourly aggregate view

market_ai_signals      ORDER BY (symbol, timestamp)
market_anomalies       ORDER BY (symbol, timestamp, type)
market_regimes         ORDER BY (symbol, timestamp)
```

## Backend API structure
- `GET /api/v1/ping`
- `GET /api/v1/market/symbols`
- `GET /api/v1/market/overview`
- `GET /api/v1/market/klines?symbol=BTCUSDT&limit=200`
- `GET /api/v1/ai/signals`
- `GET /api/v1/ai/anomalies`
- `GET /api/v1/ai/regime`
- `GET /api/v2/portfolio/summary` and `/positions` are mock portfolio scaffold endpoints.

## Frontend tabs
- `EQUITIES` — VN equities visual shell with static watchlist and placeholder panels.
- `CRYPTO` — live crypto watchlist + backend candlestick chart.
- `NEWS` / Intelligence — market pulse, signal center, Market Story, anomaly timeline, regime/detail panel, optional Gemini LLM signal card.
- `SIMULATOR` — what-if buy simulator using Binance REST candles and Recharts portfolio-value visualization.
- `OVERVIEW` — placeholder screener shell.

## Environment notes
- Required cloud runtime variables are documented in `.env.example`.
- Aiven certificates are expected in `jobs/` and are gitignored.
- `VITE_GEMINI_API_KEY` is optional and only powers the frontend Gemini panel. The rest of the dashboard does not need it.

## Known limitations to keep visible
- Current Pandas stream feature windows are computed per micro-batch; production-grade rolling windows should join recent historical candles or maintain state.
- AI jobs currently query recent rows with global `LIMIT`; production-grade sampling should limit per symbol.
- Browser-side Gemini exposes a Vite public key by design. For public deployment, move Gemini calls behind a backend endpoint with rate limiting.

## Reference files
- Architecture trade-offs: `TRADE_OFFS.md`
- Setup guide: `SETUP_GUIDE.md`
- Grading spec: `REQUIREMENTS.md`
- AI attribution: `AI.md`
