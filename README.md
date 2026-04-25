# XNO Quant — Market Data System

End-to-end crypto market data system: real-time ingestion, feature engineering, AI post-processing, and an interactive dashboard for both technical and non-technical users.

## Architecture

```
                                                    ┌──────────────────────────┐
                                                    │ Frontend                 │
                                                    │ React + Vite :5173       │
                                                    │ Charts, Intelligence,    │
                                                    │ What-if Simulator        │
                                                    └────────────┬─────────────┘
                                                                 │ /api proxy
                                                    ┌────────────▼─────────────┐
                                                    │ Go Backend               │
                                                    │ Fiber :8080, raw SQL     │
                                                    └────────────┬─────────────┘
                                                                 │ ClickHouse SQL
                               ┌─────────────────────────────────▼──────────────┐
Binance WS ──► Producer ──► Kafka (Aiven) ──► Processor ──► ClickHouse Cloud   │
  kline_1m      aiokafka       SSL/TLS         Pandas        market_klines     │
                                              micro-batch     market_latest     │
                                              AI Runner ───► market_ai_signals │
                                                             market_anomalies   │
                                                             market_regimes     │
                               └────────────────────────────────────────────────┘
```

The main data path is Binance WebSocket → Kafka → Python processor → ClickHouse → Go API → React dashboard. The Simulator tab additionally uses Binance REST from the browser to fetch historical candles for user-selected intervals.

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Data Source | Binance WebSocket + REST | Real-time 1m stream and simulator historical candles |
| Message Broker | Kafka on Aiven | SSL/TLS, consumer groups, at-least-once delivery |
| Stream Processor | Python + Pandas | Micro-batch Kafka → features → ClickHouse |
| OLAP Database | ClickHouse Cloud | ReplacingMergeTree, materialized views, time-series analytics |
| AI Engineering | Python + scikit-learn | Signal scoring, anomaly detection, regime classification |
| Backend API | Go + Fiber v3 | Raw SQL via `database/sql` + `clickhouse-go/v2` |
| Frontend | React + Vite + Tailwind | Lightweight Charts, Recharts, resizable dashboard panels |
| DevOps | Docker + docker-compose | Service packaging and local orchestration |

## Product Surface

- **Crypto X**: live watchlist and candlestick chart fed by the backend.
- **Intelligence**: market pulse, signal center, regime matrix, anomaly timeline, Market Story, and optional Gemini LLM signal panel.
- **Simulator**: "What If I Bought" experience using Binance REST candles. Users choose symbol, investment amount, candle interval, candles ago, and entry price mode (`open`, `high`, `low`, `close`, `average`) to see current value, PnL, best/worst moments, and a portfolio-value chart.
- **VN Equities / Overview**: UI shell and placeholder panels for future expansion; current real pipeline is crypto-focused.

## Quick Start

### Option 1: Local development with cloud Kafka and ClickHouse

```bash
cd fullstackAI
cp .env.example .env
# Edit .env with Aiven Kafka, ClickHouse Cloud, and optional Gemini key.

docker-compose up -d

npm install
npm run dev
# http://localhost:5173
```

Place Aiven SSL files in `jobs/` before starting Docker:

```text
jobs/ca.pem
jobs/service.cert
jobs/service.key
```

### Option 2: Run services individually

```bash
# Terminal 1 — Producer (Binance → Kafka)
cd jobs/src && python -m stream.producer

# Terminal 2 — Processor (Kafka → ClickHouse)
cd jobs/src && python -m stream.processor_standalone

# Terminal 3 — AI Jobs
cd jobs/src && python -m ai.runner

# Terminal 4 — Backend API
cd backend && go run ./cmd/main.go

# Terminal 5 — Frontend
npm run dev
```

## API Endpoints

### V1 — Market Data + AI Outputs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/ping` | v1 health check |
| GET | `/api/v1/market/overview` | Latest price, volume, SMA7, RSI14 per symbol |
| GET | `/api/v1/market/klines?symbol=BTCUSDT&limit=200` | OHLCV candles with feature columns |
| GET | `/api/v1/market/symbols` | Available symbols |
| GET | `/api/v1/ai/signals` | Signal scores (`BUY`, `SELL`, `NEUTRAL`) |
| GET | `/api/v1/ai/anomalies` | Detected anomalies |
| GET | `/api/v1/ai/regime` | Market regime classification |

### V2 — Portfolio Scaffold

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/ping` | v2 health check |
| GET | `/api/v2/portfolio/summary` | Mock portfolio summary |
| GET | `/api/v2/portfolio/positions` | Mock position list |

## Data Flow Walkthrough

```
1. Binance WS emits kline_1m messages for configured symbols.

2. Producer parses each kline and sends JSON to Kafka topic "binance_market_data"
   with the symbol as message key.

3. Processor consumes with confluent-kafka:
   - Reads up to STREAM_BATCH_SIZE messages per cycle
   - Deduplicates by (symbol, kline_start)
   - Computes SMA, RSI, returns, volatility, VWAP
   - Inserts into ClickHouse market_klines_stream
   - Commits Kafka offset after successful write

4. ClickHouse materialized view keeps market_latest_price updated.

5. AI Runner periodically writes:
   - market_ai_signals
   - market_anomalies
   - market_regimes

6. Backend serves ClickHouse data through /api/v1.

7. Frontend polls:
   - Watchlist: /api/v1/market/overview
   - TradingChart: /api/v1/market/klines
   - IntelligencePanel: /api/v1/ai/*
   - Simulator: Binance REST klines directly from the browser
```

## Environment Variables

See [`.env.example`](.env.example) for the full list.

Key variables:

- `KAFKA_BOOTSTRAP_SERVERS` — Aiven Kafka host:port.
- `KAFKA_TOPIC`, `KAFKA_CONSUMER_GROUP`, `KAFKA_AUTO_OFFSET_RESET` — Kafka runtime config.
- `KAFKA_SSL_CA`, `KAFKA_SSL_CERT`, `KAFKA_SSL_KEY` — certificate paths used by local non-Docker runs; Docker maps these from `jobs/`.
- `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_NATIVE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_SECURE`.
- `BINANCE_SYMBOLS`, `BINANCE_INTERVAL`.
- `VITE_GEMINI_API_KEY` — optional; enables the browser-side Gemini panel in the Intelligence tab. Leave blank to use the rest of the dashboard without LLM calls.

## Local Services

| Service | URL | Notes |
|---------|-----|-------|
| Frontend | http://localhost:5173 | Vite dev server |
| Backend API | http://localhost:8080 | Go Fiber |
| Kafka UI | http://localhost:8090 | Kafka topic and consumer lag monitor |

## Validation

```bash
npm run build
cd backend && go test ./...
cd ../jobs && python -m compileall -q src
```

## Documentation

- [`SETUP_GUIDE.md`](SETUP_GUIDE.md) — Aiven Kafka, ClickHouse Cloud, Docker, and local startup.
- [`TRADE_OFFS.md`](TRADE_OFFS.md) — Architecture decisions and known limitations.
- [`CLICKHOUSE_DEEP_DIVE_EN.md`](CLICKHOUSE_DEEP_DIVE_EN.md) — ClickHouse deep dive.
- [`AI.md`](AI.md) — AI tool usage and attribution.
