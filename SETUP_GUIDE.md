# Stream Pipeline — Setup Guide

## Architecture Overview

```
Binance WebSocket ──→ Python Producer ──→ Redis Streams ──→ Python Processor ──→ ClickHouse Cloud
                      (async, reconnect)   (consumer groups)  (Pandas, 10s batch)   (ReplacingMergeTree)
```

---

## A. Redis Cloud

### 1. Create Redis Cloud Account
- Go to [redis.io/cloud](https://redis.io/cloud) → Sign up (free tier available)
- Create a **Fixed** subscription (free 30MB) or **Flexible** for production

### 2. Create Database
- Region: choose closest to your processor/ClickHouse region
- Enable **Redis Streams** (enabled by default on Redis 5+)
- Memory: 30MB (free) or 256MB+ for production
- Enable **TLS/SSL** (mandatory for cloud)

### 3. Get Connection Details
After database is created, note down:
```
REDIS_HOST=redis-xxxxx.crce194.ap-seast-1-1.ec2.cloud.redislabs.com
REDIS_PORT=13992
REDIS_PASSWORD=your_password_here
REDIS_SSL=true
```

### 4. Verify Connection
```bash
redis-cli -h {{REDIS_HOST}} -p {{REDIS_PORT}} -a {{REDIS_PASSWORD}} --tls PING
# Should return: PONG
```

### 5. No Topic Creation Needed
Redis Streams are created automatically on first `XADD`.
The producer creates the stream `binance_market_data` automatically.

---

## B. ClickHouse Cloud

### 1. Create Service
- Go to [clickhouse.cloud](https://clickhouse.cloud/) → Sign up (free trial)
- Create a service:
  - Cloud provider: AWS / GCP / Azure
  - Region: same as Redis Cloud
  - Tier: Development (free trial) or Production

### 2. Get Connection Details
```
CLICKHOUSE_HOST=xxxxxxxx.us-east-1.aws.clickhouse.cloud
CLICKHOUSE_PORT=8443          # HTTPS port — used by Python services (processor, AI runner)
CLICKHOUSE_NATIVE_PORT=9440   # Native TCP port — used by Go backend
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=your_password_here
CLICKHOUSE_DATABASE=default
```

### 3. Create Schema
Run **both** SQL scripts against your ClickHouse Cloud — stream tables first, then AI output tables:
```bash
# Option 1: clickhouse-client
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

# Option 2: ClickHouse Cloud web console
# Paste contents of sql/clickhouse_schema.sql, execute.
# Then paste contents of sql/clickhouse_ai_schema.sql, execute.
```

`clickhouse_schema.sql` creates: `market_klines_stream`, `market_latest_price`, `market_ohlcv_1h` + 2 materialized views.
`clickhouse_ai_schema.sql` creates: `market_ai_signals`, `market_anomalies`, `market_regimes` (consumed by the AI runner and backend).

### 4. Verify Tables
```sql
SHOW TABLES;
-- Expected: market_klines_stream, market_latest_price, market_ohlcv_1h,
--           market_ai_signals, market_anomalies, market_regimes

DESCRIBE market_klines_stream;
```

### 5. Grant Permissions (if using separate user)
```sql
CREATE USER IF NOT EXISTS stream_writer IDENTIFIED BY '{{PASSWORD}}';
GRANT INSERT ON default.market_klines_stream TO stream_writer;
GRANT INSERT ON default.market_latest_price TO stream_writer;
GRANT INSERT ON default.market_ohlcv_1h TO stream_writer;
GRANT INSERT ON default.market_ai_signals TO stream_writer;
GRANT INSERT ON default.market_anomalies TO stream_writer;
GRANT INSERT ON default.market_regimes TO stream_writer;
GRANT SELECT ON default.* TO stream_writer;
```

---

## C. Producer Deployment

### Option 1: Docker (Local / VM)
```bash
cd fullstackAI

# Copy and edit environment
cp .env.example .env
# Edit .env with your Redis Cloud credentials

# Run with docker-compose
docker-compose up -d producer

# Check logs
docker-compose logs -f producer
```

### Option 2: Cloud Run (GCP)
```bash
cd fullstackAI/jobs

# Build & push
gcloud builds submit --tag gcr.io/PROJECT_ID/binance-producer

# Deploy
gcloud run deploy binance-producer \
  --image gcr.io/PROJECT_ID/binance-producer \
  --set-env-vars "REDIS_HOST={{REDIS_HOST}},REDIS_PORT={{REDIS_PORT}},REDIS_PASSWORD={{REDIS_PASSWORD}},REDIS_SSL=true" \
  --min-instances=1 \
  --max-instances=1 \
  --cpu=1 \
  --memory=256Mi \
  --no-allow-unauthenticated
```

### Option 3: Docker on VM (AWS EC2 / Azure VM)
```bash
# SSH into VM
ssh user@vm-ip

# Clone repo
git clone <repo-url>
cd fullstackAI

# Configure
cp .env.example .env
vim .env  # add credentials

# Run
docker-compose up -d producer

# Monitor
docker-compose logs -f producer
```

---

## D. Full Pipeline Startup (Local Development)

```bash
cd fullstackAI

# 1. Start Redis + Producer + Processor + AI jobs + Backend
docker-compose up -d

# 2. Verify producer is running
docker-compose logs -f producer
# Should see: "WebSocket connected" and periodic "Published N msgs" logs

# 3. Verify Redis Stream has data
docker-compose exec redis redis-cli XLEN binance_market_data
# Should return a number > 0

# 4. Check stream contents
docker-compose exec redis redis-cli XRANGE binance_market_data - + COUNT 3

# 5. Open RedisInsight (optional)
# http://localhost:5540

# 6. Verify processor is consuming
docker-compose logs -f processor
# Should see: "Batch committed: N rows" logs

# 7. Verify ClickHouse data
# (Use ClickHouse Cloud console or clickhouse-client)
# SELECT count() FROM market_klines_stream;
```

Run standalone (outside Docker):
```bash
cd jobs/src
python -m stream.producer              # Terminal 1
python -m stream.processor_standalone  # Terminal 2
python -m ai.runner                    # Terminal 3
```

---

## E. Environment Variables Reference

| Variable | Service | Default | Description |
|----------|---------|---------|-------------|
| `REDIS_HOST` | Producer, Processor | localhost | Redis server hostname |
| `REDIS_PORT` | Producer, Processor | 6379 | Redis server port |
| `REDIS_PASSWORD` | Producer, Processor | (empty) | Redis password |
| `REDIS_SSL` | Producer, Processor | false | Enable TLS |
| `REDIS_STREAM_KEY` | Producer, Processor | binance_market_data | Stream name |
| `REDIS_CONSUMER_GROUP` | Processor | market_processor | Consumer group name |
| `REDIS_MAXLEN` | Producer | 100000 | Max stream length (auto trim) |
| `CLICKHOUSE_HOST` | Processor, AI runner, Backend | localhost | ClickHouse hostname |
| `CLICKHOUSE_PORT` | Processor, AI runner | 8443 | HTTPS port (Python `clickhouse-connect`) |
| `CLICKHOUSE_NATIVE_PORT` | Backend | 9440 | Native TCP port (Go `clickhouse-go`) |
| `CLICKHOUSE_USER` | Processor | default | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | Processor | (empty) | ClickHouse password |
| `CLICKHOUSE_DATABASE` | Processor | default | ClickHouse database |
| `BINANCE_SYMBOLS` | Producer | btcusdt,ethusdt | Comma-separated symbols |
| `BINANCE_INTERVAL` | Producer | 1m | Kline interval |
| `STREAM_BATCH_SIZE` | Processor | 500 | Messages per micro-batch |
| `STREAM_PROCESSING_INTERVAL` | Processor | 10 seconds | Micro-batch interval |
| `LOG_LEVEL` | All | INFO | Logging level |
