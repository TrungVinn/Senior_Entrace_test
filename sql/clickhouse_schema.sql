-- =============================================================================
-- ClickHouse Cloud — Stream Pipeline Schema
-- =============================================================================
-- Table for real-time kline data with computed features.
-- Uses ReplacingMergeTree for idempotent writes:
--   Duplicate inserts with the same (symbol, timestamp) are automatically
--   deduplicated during merge. Use FINAL in queries for consistent reads.
--
-- Run against your ClickHouse Cloud instance:
--   clickhouse-client --host {{CLICKHOUSE_HOST}} --port 9440 --secure \
--     --user {{CLICKHOUSE_USER}} --password {{CLICKHOUSE_PASSWORD}} \
--     --database {{CLICKHOUSE_DATABASE}} < clickhouse_schema.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Raw + feature table for stream pipeline
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_klines_stream
(
    -- Primary data
    symbol          String,
    timestamp       DateTime64(3),        -- kline start time (ms precision)
    open            Float64,
    high            Float64,
    low             Float64,
    close           Float64,
    volume          Float64,
    quote_volume    Float64,
    num_trades      UInt32,
    is_closed       Bool,
    interval        String,

    -- Computed features (from Spark processor)
    sma_7           Nullable(Float64),
    sma_25          Nullable(Float64),
    sma_99          Nullable(Float64),
    rsi_14          Nullable(Float64),
    log_return      Nullable(Float64),
    pct_change      Nullable(Float64),
    volatility_20   Nullable(Float64),
    vwap            Nullable(Float64),

    -- Metadata
    ingestion_time  DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(ingestion_time)
ORDER BY (symbol, timestamp)
PARTITION BY toYYYYMM(timestamp)
TTL toDateTime(timestamp) + INTERVAL 365 DAY
SETTINGS index_granularity = 8192;


-- ---------------------------------------------------------------------------
-- 2. Materialized view: latest price per symbol (for fast dashboard queries)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_latest_price
(
    symbol          String,
    timestamp       DateTime64(3),
    close           Float64,
    volume          Float64,
    sma_7           Nullable(Float64),
    rsi_14          Nullable(Float64),
    ingestion_time  DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(ingestion_time)
ORDER BY (symbol);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_latest_price
TO market_latest_price AS
SELECT
    symbol,
    timestamp,
    close,
    volume,
    sma_7,
    rsi_14
FROM market_klines_stream;


-- ---------------------------------------------------------------------------
-- 3. Aggregated 1-hour OHLCV (for charts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_ohlcv_1h
(
    symbol          String,
    hour            DateTime,
    open            AggregateFunction(argMin, Float64, DateTime64(3)),
    high            AggregateFunction(max, Float64),
    low             AggregateFunction(min, Float64),
    close           AggregateFunction(argMax, Float64, DateTime64(3)),
    volume          AggregateFunction(sum, Float64),
    trade_count     AggregateFunction(sum, UInt32)
)
ENGINE = AggregatingMergeTree()
ORDER BY (symbol, hour)
PARTITION BY toYYYYMM(hour);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_ohlcv_1h
TO market_ohlcv_1h AS
SELECT
    symbol,
    toStartOfHour(timestamp) AS hour,
    argMinState(open, timestamp) AS open,
    maxState(high) AS high,
    minState(low) AS low,
    argMaxState(close, timestamp) AS close,
    sumState(volume) AS volume,
    sumState(num_trades) AS trade_count
FROM market_klines_stream
GROUP BY symbol, hour;


-- ---------------------------------------------------------------------------
-- 4. Useful queries (for reference)
-- ---------------------------------------------------------------------------

-- Latest price per symbol (deduplicated):
-- SELECT * FROM market_latest_price FINAL;

-- OHLCV 1h chart data:
-- SELECT
--     symbol, hour,
--     argMinMerge(open) AS open,
--     maxMerge(high) AS high,
--     minMerge(low) AS low,
--     argMaxMerge(close) AS close,
--     sumMerge(volume) AS volume,
--     sumMerge(trade_count) AS trade_count
-- FROM market_ohlcv_1h
-- WHERE symbol = 'BTCUSDT'
--   AND hour >= now() - INTERVAL 7 DAY
-- GROUP BY symbol, hour
-- ORDER BY hour;

-- Stream lag monitoring:
-- SELECT
--     symbol,
--     max(timestamp) AS latest_kline,
--     max(ingestion_time) AS latest_ingestion,
--     dateDiff('second', max(timestamp), now()) AS lag_seconds
-- FROM market_klines_stream FINAL
-- GROUP BY symbol;
