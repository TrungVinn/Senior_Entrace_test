"""
Spark Structured Streaming Processor (Databricks)

Redis Streams → Spark (feature generation) → ClickHouse Cloud

Architecture:
    Spark Structured Streaming uses a "rate" source as a micro-batch clock.
    Each micro-batch triggers a foreachBatch callback that:
    1. Reads pending messages from Redis Streams via consumer group
    2. Converts to Spark DataFrame
    3. Deduplicates by (symbol, kline_start)
    4. Computes features (SMA, RSI, volatility, returns, VWAP)
    5. Writes idempotently to ClickHouse (ReplacingMergeTree handles dedup)
    6. ACKs processed messages in Redis

    Why this pattern?
    - Redis Streams has no native Spark source connector (unlike Kafka)
    - The "rate" source + foreachBatch gives us Spark's checkpointing
      and fault-tolerance while reading from Redis
    - Consumer groups provide at-least-once delivery with ACK semantics

Usage on Databricks:
    spark-submit stream/processor.py

    Or use the notebook version: stream/processor_notebook.py
"""

import json
from datetime import datetime, timezone

import redis
from pyspark.sql import SparkSession, DataFrame, Window
from pyspark.sql import functions as F
from pyspark.sql.types import (
    StructType, StructField, StringType, LongType,
    DoubleType, BooleanType, TimestampType,
)

from config.settings import (
    REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_SSL,
    REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP,
    CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_USER,
    CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE, CLICKHOUSE_SECURE,
    STREAM_BATCH_SIZE, STREAM_BLOCK_MS,
    STREAM_PROCESSING_INTERVAL, SPARK_CHECKPOINT_DIR,
)
from utils.logger import setup_logger
from common.features import add_all_features

logger = setup_logger("stream.processor")

# ---------------------------------------------------------------------------
# Schema for kline records from Redis Streams
# ---------------------------------------------------------------------------

KLINE_SCHEMA = StructType([
    StructField("symbol", StringType(), False),
    StructField("event_time", LongType(), False),
    StructField("kline_start", LongType(), False),
    StructField("kline_close", LongType(), False),
    StructField("interval", StringType(), False),
    StructField("open", DoubleType(), False),
    StructField("high", DoubleType(), False),
    StructField("low", DoubleType(), False),
    StructField("close", DoubleType(), False),
    StructField("volume", DoubleType(), False),
    StructField("quote_volume", DoubleType(), False),
    StructField("num_trades", LongType(), False),
    StructField("is_closed", BooleanType(), False),
])


# ---------------------------------------------------------------------------
# Redis helpers (sync — used inside Spark driver)
# ---------------------------------------------------------------------------

def get_sync_redis() -> redis.Redis:
    """Create synchronous Redis client for Spark driver."""
    return redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        password=REDIS_PASSWORD if REDIS_PASSWORD else None,
        ssl=REDIS_SSL,
        decode_responses=True,
        socket_connect_timeout=10,
    )


def ensure_consumer_group(r: redis.Redis, stream: str, group: str):
    """Create consumer group if it doesn't exist."""
    try:
        r.xgroup_create(stream, group, id="0", mkstream=True)
        logger.info("Created consumer group '%s' on stream '%s'", group, stream)
    except redis.ResponseError as e:
        if "BUSYGROUP" not in str(e):
            raise


def read_and_parse_messages(r, stream, group, consumer, count, block_ms):
    """Read + parse messages from Redis Streams consumer group."""
    messages = r.xreadgroup(
        groupname=group,
        consumername=consumer,
        streams={stream: ">"},
        count=count,
        block=block_ms,
    )

    records, msg_ids = [], []
    if not messages:
        return records, msg_ids

    for _stream_name, stream_messages in messages:
        for msg_id, data in stream_messages:
            try:
                record = json.loads(data["data"])
                records.append(record)
                msg_ids.append(msg_id)
            except (json.JSONDecodeError, KeyError) as e:
                logger.warning("Skipping malformed message %s: %s", msg_id, e)
                r.xack(stream, group, msg_id)

    return records, msg_ids


def ack_messages(r, stream, group, msg_ids):
    """ACK processed messages."""
    if msg_ids:
        r.xack(stream, group, *msg_ids)


# ---------------------------------------------------------------------------
# ClickHouse writer
# ---------------------------------------------------------------------------

CLICKHOUSE_COLUMNS = [
    "symbol", "timestamp", "open", "high", "low", "close", "volume",
    "quote_volume", "num_trades", "is_closed", "interval",
    "sma_7", "sma_25", "sma_99", "rsi_14",
    "log_return", "pct_change", "volatility_20", "vwap",
]


def write_to_clickhouse(df: DataFrame, table: str = "market_klines_stream"):
    """Write Spark DataFrame to ClickHouse via clickhouse-connect."""
    import clickhouse_connect

    pdf = df.toPandas()
    if pdf.empty:
        return 0

    client = clickhouse_connect.get_client(
        host=CLICKHOUSE_HOST, port=CLICKHOUSE_PORT,
        username=CLICKHOUSE_USER, password=CLICKHOUSE_PASSWORD,
        database=CLICKHOUSE_DATABASE, secure=CLICKHOUSE_SECURE,
    )

    available = [c for c in CLICKHOUSE_COLUMNS if c in pdf.columns]
    data = pdf[available].values.tolist()
    client.insert(table, data, column_names=available)
    client.close()

    logger.info("Wrote %d rows to ClickHouse '%s'", len(data), table)
    return len(data)


# ---------------------------------------------------------------------------
# Stream Processor (follows template class-based pattern)
# ---------------------------------------------------------------------------

class StreamProcessor:
    """Spark Structured Streaming: Redis Streams → features → ClickHouse."""

    def __init__(self, spark: SparkSession):
        self.spark = spark
        self.redis_client = get_sync_redis()
        self.consumer_name = "spark-worker-1"
        ensure_consumer_group(self.redis_client, REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP)

    def process_batch(self, _trigger_df: DataFrame, epoch_id: int):
        """
        foreachBatch callback — called by Spark for each micro-batch.
        _trigger_df is from rate source (ignored); actual data comes from Redis.
        """
        logger.info("Processing micro-batch epoch_id=%d", epoch_id)

        # 1. Read from Redis Streams
        records, msg_ids = read_and_parse_messages(
            self.redis_client, REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP,
            self.consumer_name, STREAM_BATCH_SIZE, STREAM_BLOCK_MS,
        )

        if not records:
            logger.info("No new messages in epoch %d", epoch_id)
            return

        logger.info("Read %d messages from Redis (epoch %d)", len(records), epoch_id)

        # 2. Convert to Spark DataFrame
        spark_df = self.spark.createDataFrame(records, schema=KLINE_SCHEMA)

        # 3. Convert epoch ms → timestamp
        spark_df = spark_df.withColumn(
            "timestamp",
            (F.col("kline_start") / 1000).cast(TimestampType()),
        )

        # 4. Dedup: keep latest event per (symbol, kline_start)
        w = Window.partitionBy("symbol", "kline_start").orderBy(F.col("event_time").desc())
        spark_df = spark_df.withColumn("_rn", F.row_number().over(w))
        spark_df = spark_df.filter(F.col("_rn") == 1).drop("_rn")

        # 5. Feature generation (shared module)
        spark_df = add_all_features(spark_df, partition_col="symbol", order_col="timestamp")

        # 6. Drop intermediate columns
        spark_df = spark_df.drop("event_time", "kline_start", "kline_close")

        # 7. Write to ClickHouse (idempotent via ReplacingMergeTree)
        write_to_clickhouse(spark_df)

        # 8. ACK after successful write
        ack_messages(self.redis_client, REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP, msg_ids)
        logger.info("Epoch %d complete: %d records processed", epoch_id, len(records))

    def run(self):
        """Start the streaming query."""
        logger.info(
            "Starting StreamProcessor | Redis=%s:%s stream=%s group=%s",
            REDIS_HOST, REDIS_PORT, REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP,
        )
        logger.info(
            "ClickHouse=%s:%s db=%s | checkpoint=%s",
            CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_DATABASE, SPARK_CHECKPOINT_DIR,
        )

        rate_stream = (
            self.spark.readStream
            .format("rate")
            .option("rowsPerSecond", 1)
            .load()
        )

        query = (
            rate_stream.writeStream
            .foreachBatch(self.process_batch)
            .trigger(processingTime=STREAM_PROCESSING_INTERVAL)
            .option("checkpointLocation", SPARK_CHECKPOINT_DIR)
            .queryName("redis_to_clickhouse_stream")
            .start()
        )

        logger.info("Streaming query started — awaiting termination")
        query.awaitTermination()

    def stop(self):
        """Clean up."""
        if self.redis_client:
            self.redis_client.close()
            logger.info("Redis connection closed")


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def main():
    spark = (
        SparkSession.builder
        .appName("BinanceStreamProcessor")
        .config("spark.sql.streaming.schemaInference", "true")
        .getOrCreate()
    )

    processor = StreamProcessor(spark)
    try:
        processor.run()
    except KeyboardInterrupt:
        logger.info("Interrupted — shutting down")
    finally:
        processor.stop()
        spark.stop()


if __name__ == "__main__":
    main()
