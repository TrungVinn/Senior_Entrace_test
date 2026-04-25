# Stream Pipeline — Setup Guide

This guide matches the current implementation: Binance WebSocket → Kafka on Aiven → Python processor → ClickHouse Cloud → Go backend → React dashboard.

## Architecture Overview

```
Binance WebSocket ──→ Python Producer ──→ Kafka (Aiven) ──→ Python Processor ──→ ClickHouse Cloud
                      aiokafka            SSL/TLS           Pandas micro-batch   ReplacingMergeTree
```

The frontend Simulator tab separately calls Binance REST from the browser for historical candles and does not depend on ClickHouse.

---

## A. Aiven Kafka

### 1. Create Kafka Service

- Create an Aiven account.
- Create a Kafka service in a region close to your processor/ClickHouse service.
- Note the bootstrap server from the Aiven console, for example:

```text
KAFKA_BOOTSTRAP_SERVERS=kafka-xxxxx.aivencloud.com:11355
```

### 2. Download SSL Certificates

Download these files from Aiven and place them in `jobs/`:

```text
jobs/ca.pem
jobs/service.cert
jobs/service.key
```

They are ignored by git.

### 3. Create / Confirm Topic

The default topic is:

```text
binance_market_data
```

You can create it in the Aiven console or let the service auto-create it if your Aiven configuration allows auto topic creation.

Recommended settings for this project:

| Setting | Suggested Value |
|---------|-----------------|
| Partitions | 3 |
| Replication | Aiven default |
| Retention | 1-7 days for development |
| Cleanup policy | delete |

---

## B. ClickHouse Cloud

### 1. Create Service

- Create a ClickHouse Cloud service.
- Use the same or nearby region as Kafka.
- Record:

```text
CLICKHOUSE_HOST=xxxxxxxx.region.provider.clickhouse.cloud
CLICKHOUSE_PORT=8443
CLICKHOUSE_NATIVE_PORT=9440
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=your_password_here
CLICKHOUSE_DATABASE=default
CLICKHOUSE_SECURE=true
```

`CLICKHOUSE_PORT=8443` is used by Python `clickhouse-connect`; `CLICKHOUSE_NATIVE_PORT=9440` is used by Go `clickhouse-go/v2`.

### 2. Create Schema

Run both SQL files:

```bash
clickhouse-client \
  --host {{CLICKHOUSE_HOST}} \
  --port 9440 \
  --secure \
  --user {{CLICKHOUSE_USER}} \
  --password {{CLICKHOUSE_PASSWORD}} \
  --database {{CLICKHOUSE_DATABASE}} \
  < sql/clickhouse_schema.sql

clickhouse-client \
  --host {{CLICKHOUSE_HOST}} \
  --port 9440 \
  --secure \
  --user {{CLICKHOUSE_USER}} \
  --password {{CLICKHOUSE_PASSWORD}} \
  --database {{CLICKHOUSE_DATABASE}} \
  < sql/clickhouse_ai_schema.sql
```

Or paste the SQL into the ClickHouse Cloud web console.

Expected tables:

```sql
SHOW TABLES;
-- market_klines_stream
-- market_latest_price
-- market_ohlcv_1h
-- market_ai_signals
-- market_anomalies
-- market_regimes
```

---

## C. Environment Configuration

```bash
cd fullstackAI
cp .env.example .env
```

Fill in:

```env
KAFKA_BOOTSTRAP_SERVERS=...
KAFKA_TOPIC=binance_market_data
KAFKA_CONSUMER_GROUP=market_processor
KAFKA_AUTO_OFFSET_RESET=earliest

CLICKHOUSE_HOST=...
CLICKHOUSE_PORT=8443
CLICKHOUSE_NATIVE_PORT=9440
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=...
CLICKHOUSE_DATABASE=default
CLICKHOUSE_SECURE=true

BINANCE_SYMBOLS=btcusdt,ethusdt,bnbusdt,solusdt,xrpusdt
BINANCE_INTERVAL=1m

# Optional: only for the frontend Gemini panel
VITE_GEMINI_API_KEY=
```

For Docker, `docker-compose.yml` maps the certificate files to `/app/certs/*`. For local Python runs from `jobs/src`, set the certificate variables to reachable local paths, for example:

```env
KAFKA_SSL_CA=../ca.pem
KAFKA_SSL_CERT=../service.cert
KAFKA_SSL_KEY=../service.key
```

---

## D. Docker Startup

```bash
cd fullstackAI
docker-compose up -d
```

Check logs:

```bash
docker-compose logs -f producer
docker-compose logs -f processor
docker-compose logs -f ai-jobs
docker-compose logs -f backend
```

Expected signals:

- Producer logs `WebSocket connected` and periodic published-message counts.
- Processor logs subscribed Kafka topic and processed batches.
- AI jobs log cycles for signal scoring, anomaly detection, and regime classification.
- Backend listens on `0.0.0.0:8080`.

---

## E. Local Non-Docker Startup

Install Python dependencies:

```bash
cd fullstackAI/jobs
pip install -r requirements.txt
```

Run services:

```bash
cd fullstackAI/jobs/src
python -m stream.producer
python -m stream.processor_standalone
python -m ai.runner
```

In another terminal:

```bash
cd fullstackAI/backend
go run ./cmd/main.go
```

In another terminal:

```bash
cd fullstackAI
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

---

## F. Verification

### Kafka

Use Kafka UI:

```text
http://localhost:8090
```

Confirm:

- Topic `binance_market_data` receives messages.
- Consumer group `market_processor` is active.
- Lag is low or decreasing.

### ClickHouse

```sql
SELECT count() FROM market_klines_stream FINAL;

SELECT
  symbol,
  max(timestamp) AS latest_kline,
  dateDiff('second', max(timestamp), now()) AS lag_seconds
FROM market_klines_stream FINAL
GROUP BY symbol;

SELECT * FROM market_latest_price FINAL ORDER BY symbol;
SELECT * FROM market_ai_signals FINAL ORDER BY timestamp DESC LIMIT 10;
```

### Backend

```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/v1/market/overview
curl "http://localhost:8080/api/v1/market/klines?symbol=BTCUSDT&limit=20"
curl http://localhost:8080/api/v1/ai/signals
```

### Frontend Build

```bash
npm run build
```

---

## G. Environment Variables Reference

| Variable | Service | Default | Description |
|----------|---------|---------|-------------|
| `KAFKA_BOOTSTRAP_SERVERS` | Producer, Processor, Kafka UI | required | Aiven Kafka host:port |
| `KAFKA_TOPIC` | Producer, Processor | `binance_market_data` | Topic for kline messages |
| `KAFKA_CONSUMER_GROUP` | Processor | `market_processor` | Consumer group name |
| `KAFKA_AUTO_OFFSET_RESET` | Processor | `earliest` | Offset reset policy |
| `KAFKA_SSL_CA` | Producer, Processor | `/app/certs/ca.pem` | CA certificate path |
| `KAFKA_SSL_CERT` | Producer, Processor | `/app/certs/service.cert` | Client certificate path |
| `KAFKA_SSL_KEY` | Producer, Processor | `/app/certs/service.key` | Client key path |
| `CLICKHOUSE_HOST` | Processor, AI runner, Backend | empty | ClickHouse host |
| `CLICKHOUSE_PORT` | Processor, AI runner | `8443` | HTTPS port for Python |
| `CLICKHOUSE_NATIVE_PORT` | Backend | `9440` | Native TCP port for Go |
| `CLICKHOUSE_USER` | Processor, AI runner, Backend | `default` | ClickHouse user |
| `CLICKHOUSE_PASSWORD` | Processor, AI runner, Backend | empty | ClickHouse password |
| `CLICKHOUSE_DATABASE` | Processor, AI runner, Backend | `default` | ClickHouse database |
| `CLICKHOUSE_SECURE` | Processor, AI runner, Backend | `true` | Enable TLS |
| `BINANCE_SYMBOLS` | Producer | `btcusdt,ethusdt` | Comma-separated stream symbols |
| `BINANCE_INTERVAL` | Producer | `1m` | WebSocket kline interval |
| `STREAM_BATCH_SIZE` | Processor | `500` | Kafka messages per batch |
| `STREAM_POLL_TIMEOUT_S` | Processor | `5.0` | Kafka consume timeout |
| `VITE_GEMINI_API_KEY` | Frontend | empty | Optional browser-side Gemini panel |
| `LOG_LEVEL` | Python services | `INFO` | Logging level |

---

## H. Notes

- The core dashboard works without `VITE_GEMINI_API_KEY`; only the Gemini panel will show an API error if used without a key.
- The Simulator tab uses Binance public REST directly, so it can show historical what-if scenarios even before ClickHouse has long history.
- For public deployments, move Gemini calls behind the Go backend so the API key is not exposed in the browser bundle.
