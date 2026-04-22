# XNO Quant — Market Data System

End-to-end market data system: real-time ingestion, feature engineering, AI post-processing, and visualization.

## Architecture

```
                                                    ┌─────────────────┐
                                                    │   Frontend      │
                                                    │   React + Vite  │
                                                    │   :5173         │
                                                    └───────┬─────────┘
                                                            │ /api proxy
                                                    ┌───────▼─────────┐
                                                    │   Go Backend    │
                                                    │   Fiber :8080   │
                                                    └───────┬─────────┘
                                                            │ raw SQL
                              ┌──────────────────────────────▼──────────────────┐
Binance WS ──► Producer ──► Kafka (Aiven) ──► Processor ──► ClickHouse Cloud   │
  (kline 1m)   (Python)      (SSL/TLS)        (Pandas)      │ market_klines    │
               aiokafka       :11355                        │ market_ai_signals│
                              confluent-kafka   AI Runner ──► │ market_anomalies │
                              kafka-ui :8090   (Python)      │ market_regimes   │
                                                            └──────────────────┘
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Data Source | Binance WebSocket | Real-time kline (1m) for 5 crypto pairs |
| Message Broker | Kafka (Aiven managed) | SSL/TLS, consumer groups, at-least-once delivery |
| Stream Processor | Python + Pandas | Micro-batch: Kafka → features → ClickHouse |
| OLAP Database | ClickHouse Cloud | ReplacingMergeTree, materialized views |
| AI Engineering | Python + scikit-learn | Signal scoring, anomaly detection, regime classification |
| Backend API | Go + Fiber v3 | Raw SQL (no ORM), serves ClickHouse data |
| Frontend | React + Vite + Tailwind | Lightweight-charts, Radix UI, real-time polling |
| DevOps | Docker + docker-compose | One-command local startup |

## Quick Start

### Option 1: Local development (with cloud databases)

```bash
# 1. Clone and configure
cd fullstackAI
cp .env.example .env
# Edit .env with your Kafka (Aiven) + ClickHouse Cloud credentials + cert paths

# 2. Start all services
docker-compose -f docker-compose.yml -f docker-compose.cloud.yml up -d

# 3. Frontend dev server
npm install
npm run dev
# → http://localhost:5173
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

### V1 — Market Data (ClickHouse)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/market/overview` | Latest price + SMA + RSI per symbol |
| GET | `/api/v1/market/klines?symbol=BTCUSDT&limit=200` | Kline data with features |
| GET | `/api/v1/market/symbols` | Available symbols |
| GET | `/api/v1/ai/signals` | AI signal scores (BUY/SELL/NEUTRAL) |
| GET | `/api/v1/ai/anomalies` | Detected anomalies |
| GET | `/api/v1/ai/regime` | Market regime classification |

### V2 — Portfolio

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/portfolio/summary` | Portfolio summary |
| GET | `/api/v2/portfolio/positions` | Position list |

## Data Flow Walkthrough

```
1. Binance WS sends kline_1m for BTCUSDT
   → {"s":"BTCUSDT","k":{"o":"75500","h":"75600","l":"75400","c":"75550","v":"123.4"}}

2. Producer parses → aiokafka produces to Kafka topic "binance_market_data" (Aiven, SSL)
   → key=symbol, value=JSON record

3. Processor consumes via confluent-kafka (consumer group "market_processor")
   → Batch consume up to 500 msgs per cycle
   → Converts to DataFrame, deduplicates by (symbol, kline_start)
   → Computes: SMA(7,25,99), RSI(14), volatility(20), VWAP, returns
   → INSERT into ClickHouse market_klines_stream
   → Commit offset to Kafka

4. AI Runner (every 60s):
   → Signal Scoring: RSI < 30 → BUY component, SMA bullish → BUY → composite score
   → Anomaly Detection: Z-score on price/volume, Isolation Forest
   → Regime Classification: volatility percentile → low/medium/high

5. Backend API:
   → GET /api/v1/market/overview → SELECT FROM market_latest_price FINAL
# Senior_Entrace_test
   → GET /api/v1/ai/signals → SELECT FROM market_ai_signals FINAL

6. Frontend:
   → Watchlist polls /api/v1/market/overview every 2s (live prices)
   → TradingChart fetches /api/v1/market/klines every 3s (real OHLC candlesticks)
   → IntelligencePanel fetches /api/v1/ai/signals every 10s (BUY/SELL signals)
```

## Environment Variables

See [`.env.example`](.env.example) for all configuration options.

Key variables:
- `KAFKA_BOOTSTRAP_SERVERS` — Aiven Kafka host:port (e.g., `kafka-xxx.aivencloud.com:11355`)
- `KAFKA_SSL_CA`, `KAFKA_SSL_CERT`, `KAFKA_SSL_KEY` — Aiven SSL certificate file paths
- `KAFKA_TOPIC`, `KAFKA_CONSUMER_GROUP` — topic and consumer group names
- `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` — ClickHouse Cloud
- `BINANCE_SYMBOLS` — Comma-separated symbol pairs (e.g., `btcusdt,ethusdt`)

> **Note:** Place Aiven SSL certs (`ca.pem`, `service.cert`, `service.key`) in `jobs/` — they are gitignored.

## Local Services

| Service | URL | Notes |
|---------|-----|-------|
| Frontend | http://localhost:5173 | Vite dev server |
| Backend API | http://localhost:8080 | Go Fiber |
| Kafka UI | http://localhost:8090 | provectuslabs/kafka-ui — monitor topics & lag |

## Documentation

- [`TRADE_OFFS.md`](TRADE_OFFS.md) — Architecture decisions: Kafka vs Redis, micro-batch rationale, monitoring strategy
- [`CLICKHOUSE_DEEP_DIVE_EN.md`](CLICKHOUSE_DEEP_DIVE_EN.md) — ClickHouse deep-dive: columnar storage, dedup, Redis vs Kafka vs NATS
- [`SETUP_GUIDE.md`](SETUP_GUIDE.md) — Step-by-step cloud setup (Kafka Aiven, ClickHouse)
- [`AI.md`](AI.md) — AI tool usage, attribution, prompt engineering examples
