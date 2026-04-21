# AI Tool Usage & Attribution

## 1. Tools Used

| Tool | Version | Purpose |
|------|---------|---------|
| Claude Code (CLI) | Claude Opus 4.6 | Primary development assistant — architecture design, code generation, testing, debugging |

## 2. Attribution

### AI-Generated Code (with human review & guidance)

| Component | Files | AI Contribution |
|-----------|-------|-----------------|
| **Stream Producer** | `jobs/src/stream/producer.py` | Full implementation — async WebSocket consumer, Redis Streams publisher, reconnect logic |
| **Stream Processor** | `jobs/src/stream/processor.py`, `processor_standalone.py`, `processor_notebook.py` | Full implementation — Spark foreachBatch pattern, standalone Pandas processor, Databricks notebook |
| **Feature Generation** | `jobs/src/common/features.py` | Full implementation — SMA, RSI, volatility, VWAP in both PySpark and Pandas |
| **AI Signal Scoring** | `jobs/src/ai/signal_scoring.py` | Full implementation — RSI + SMA crossover + volume composite scoring |
| **AI Anomaly Detection** | `jobs/src/ai/anomaly_detection.py` | Full implementation — Z-score method + Isolation Forest (sklearn) |
| **AI Regime Classification** | `jobs/src/ai/regime_classification.py` | Full implementation — volatility percentile-based regime detection |
| **Backend API** | `backend/internal/v1/`, `backend/internal/v2/` | Full rewrite — replaced GORM with raw SQL (database/sql + clickhouse-go), added market + AI endpoints |
| **ClickHouse Schema** | `sql/clickhouse_schema.sql`, `sql/clickhouse_ai_schema.sql` | Full implementation — ReplacingMergeTree tables, materialized views, aggregations |
| **Frontend API Layer** | `src/app/lib/api.ts`, `src/app/hooks/usePolling.ts` | Full implementation — typed fetch wrapper, auto-refresh hook |
| **Frontend Updates** | `Watchlist.tsx`, `TradingChart.tsx`, `IntelligencePanel.tsx` | Modified to fetch live data from backend API |
| **Docker & DevOps** | `docker-compose.yml`, Dockerfiles | Full implementation — multi-service orchestration |
| **Documentation** | `SETUP_GUIDE.md`, `TRADE_OFFS.md`, `AI.md`, `README.md` | Full generation with human-specified requirements |

### Human-Authored / Template Code

| Component | Source |
|-----------|--------|
| Backend template structure | Repository template (`cmd/main.go`, `internal/` layout, `api/response.go`, `middlewares/`) |
| Frontend UI components | Repository template (App.tsx, MarketOverview, MarketTable, OrderBook, NewsPanel, Screener, Shadcn UI library) |
| Jobs template | Repository template (`config/settings.py`, `utils/logger.py`, `utils/database.py`, `market_data_fetcher.py`) |

## 3. Setup & Instructions

### Using Claude Code to reproduce this project:

```bash
# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Clone the template
git clone https://github.com/vn-fin/xnoquant.git
cd xnoquant/fullstackAI

# Start Claude Code
claude

# Give the prompt:
# "Implement the full stream pipeline with Redis Streams replacing Kafka,
#  then build the backend API, AI engineering, and frontend connection
#  according to REQUIREMENTS.md"
```

## 4. Prompt Engineering Examples

### Example 1: Architecture Decision — Redis vs Kafka
**Prompt:** "Implement stream pipeline from the requirements. Replace Kafka with Redis Streams."

**AI Response:** Designed the full architecture with justification:
- Redis Streams chosen for scale fit (~10 msg/s), cost ($5/mo vs $80/mo Kafka), and operational simplicity
- Consumer groups for at-least-once delivery
- foreachBatch pattern for Spark integration (no native Redis-Spark connector)
- ReplacingMergeTree for idempotent ClickHouse writes

### Example 2: AI Engineering — Multi-model Approach
**Prompt:** "Implement AI post-processing: anomaly detection, regime classification, signal scoring"

**AI Response:** Designed three complementary models:
- **Signal Scoring**: Weighted composite of RSI (oversold/overbought), SMA crossover (trend), and volume anomaly (momentum) — interpretable, no black box
- **Anomaly Detection**: Dual approach — statistical Z-score for speed + Isolation Forest for multivariate patterns
- **Regime Classification**: Volatility percentile thresholds with confidence scoring based on distance from regime boundaries

### Example 3: Backend Rewrite — ORM to Raw SQL
**Prompt:** "Backend uses GORM which violates the no-ORM requirement. Rewrite with raw SQL."

**AI Response:** Replaced GORM with `database/sql` + `clickhouse-go/v2` driver:
- Direct SQL queries to ClickHouse (`market_latest_price FINAL`, `market_klines_stream FINAL`)
- Proper nullable handling with `*float64` for optional feature columns
- Mock data fallback when ClickHouse is not connected (graceful degradation)
