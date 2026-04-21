-- =============================================================================
-- ClickHouse Cloud — AI Pipeline Schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS market_ai_signals (
    symbol String,
    timestamp DateTime64 (3),
    signal String, -- BUY, SELL, NEUTRAL
    score Float64, -- -1.0 to 1.0
    rsi_component Float64,
    sma_component Float64,
    volume_component Float64,
    ingestion_time DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree (ingestion_time)
ORDER BY (symbol, timestamp);

CREATE TABLE IF NOT EXISTS market_anomalies (
    symbol String,
    timestamp DateTime64 (3),
    type String, -- price_zscore, volume_zscore
    severity String, -- low, medium, high
    zscore Float64,
    description String,
    ingestion_time DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree (ingestion_time)
ORDER BY (symbol, timestamp, type);

CREATE TABLE IF NOT EXISTS market_regimes (
    symbol String,
    timestamp DateTime64 (3),
    regime String, -- low_volatility, medium_volatility, high_volatility
    confidence Float64,
    volatility_value Float64,
    ingestion_time DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree (ingestion_time)
ORDER BY (symbol, timestamp);