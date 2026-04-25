# AI Tool Usage & Attribution

## 1. Tools Used

| Tool | Purpose |
|------|---------|
| Claude Code | Primary development assistant for architecture, pipeline code, backend, frontend UI, docs, and iterative fixes |
| Codex | Secondary review/documentation assistant for code review, doc synchronization, and quality checks |

## 2. Attribution

### AI-generated or AI-assisted code with human review

| Component | Files | Contribution |
|-----------|-------|--------------|
| Stream Producer | `jobs/src/stream/producer.py` | Binance WebSocket consumer, Aiven Kafka producer, SSL setup, reconnect loop |
| Stream Processor | `jobs/src/stream/processor_standalone.py`, `processor.py`, `processor_notebook.py` | Kafka/Pandas processor plus Spark/Databricks variants |
| Feature Generation | `jobs/src/common/features.py` | SMA, RSI, returns, volatility, VWAP in Pandas and PySpark style |
| AI Signal Scoring | `jobs/src/ai/signal_scoring.py` | RSI + SMA + volume composite score |
| AI Anomaly Detection | `jobs/src/ai/anomaly_detection.py` | Z-score and Isolation Forest anomaly detection |
| AI Regime Classification | `jobs/src/ai/regime_classification.py` | Volatility-percentile regime classification |
| Backend API | `backend/internal/v1/`, `backend/internal/v2/`, `backend/internal/db/` | Raw SQL ClickHouse backend, market endpoints, AI endpoints, mock portfolio scaffold |
| ClickHouse Schema | `sql/clickhouse_schema.sql`, `sql/clickhouse_ai_schema.sql` | Stream tables, latest-price table, hourly aggregate, AI output tables |
| Frontend API Layer | `src/app/lib/api.ts`, `src/app/hooks/usePolling.ts` | Typed API wrapper and polling hook |
| Frontend Dashboard | `src/app/App.tsx`, `Watchlist.tsx`, `TradingChart.tsx`, `IntelligencePanel.tsx`, `Simulator.tsx` | Live chart/watchlist, Intelligence tab, Market Story, Gemini panel, What-if Simulator |
| Docker & DevOps | `docker-compose.yml`, `jobs/Dockerfile.*`, `backend/Dockerfile` | Multi-service local orchestration |
| Documentation | `README.md`, `SETUP_GUIDE.md`, `TRADE_OFFS.md`, `CLAUDE.md`, `AI.md` | Setup, architecture, trade-offs, and attribution |

### Human-authored / template foundation

| Component | Source |
|-----------|--------|
| Entrance-test brief | `REQUIREMENTS.md` |
| Backend scaffold style | Repository template with `cmd/main.go`, `internal/...`, response helpers, middleware pattern |
| UI component library | Template Shadcn/Radix components under `src/app/components/ui/` |
| Initial project configuration | Existing Vite, package, Docker, and jobs scaffold |

## 3. Current Architecture Summary

The submitted implementation uses Kafka on Aiven rather than Redis Streams:

```text
Binance WebSocket → Python Producer → Kafka (Aiven SSL) → Python Processor → ClickHouse Cloud
```

The frontend consumes backend APIs for live dashboard data:

```text
/api/v1/market/overview
/api/v1/market/klines?symbol=BTCUSDT&limit=200
/api/v1/ai/signals
/api/v1/ai/anomalies
/api/v1/ai/regime
```

The Simulator tab uses Binance public REST directly for flexible historical candle intervals.

## 4. Prompt Engineering Examples

### Example 1: Broker decision and pipeline implementation

**Prompt style:** "Implement the stream pipeline from Binance WebSocket through a managed broker into ClickHouse. Keep the backend raw SQL and make it demo-friendly."

**Result:** Kafka/Aiven pipeline with `aiokafka` producer, `confluent-kafka` processor, ClickHouse inserts, and Dockerized services.

### Example 2: Interpretable AI engineering

**Prompt style:** "Add AI post-processing that is explainable and consumed by backend/frontend."

**Result:** Three lightweight jobs:

- Signal scoring from RSI, SMA crossover, and volume.
- Anomaly detection using rolling Z-score and Isolation Forest.
- Regime classification using volatility percentiles.

### Example 3: Non-technical frontend features

**Prompt style:** "Make one part of the dashboard easier for non-technical users."

**Result:** Market Story converts regime/signal/anomaly data into plain-language status, while Simulator lets a user test "what if I bought N candles ago?" without understanding technical indicators.

## 5. Transparency Notes

- All AI-generated code was reviewed and adjusted against the repository structure and grading requirements.
- Known technical limitations are documented in `TRADE_OFFS.md` and `CLAUDE.md`.
- The Gemini panel in `IntelligencePanel.tsx` is optional and currently browser-side. For a public deployment, route that call through the Go backend to avoid exposing a public Vite API key.
