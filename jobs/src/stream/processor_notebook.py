# Databricks notebook source
# MAGIC %md
# MAGIC # Stream Processor — Redis Streams → Spark → ClickHouse
# MAGIC
# MAGIC Reads kline data from Redis Streams, computes technical indicators,
# MAGIC and writes idempotently to ClickHouse Cloud (ReplacingMergeTree).
# MAGIC
# MAGIC **Prerequisites:**
# MAGIC - Cluster libs: `redis`, `clickhouse-connect`, `python-dotenv`
# MAGIC - Databricks Secrets scope `stream-pipeline` with keys:
# MAGIC   `redis-host`, `redis-port`, `redis-password`,
# MAGIC   `clickhouse-host`, `clickhouse-port`, `clickhouse-user`, `clickhouse-password`

# COMMAND ----------

# MAGIC %pip install redis clickhouse-connect python-dotenv

# COMMAND ----------

import json
import os

import redis
from pyspark.sql import DataFrame, Window
from pyspark.sql import functions as F
from pyspark.sql.types import (
    StructType, StructField, StringType, LongType,
    DoubleType, BooleanType, TimestampType,
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Configuration

# COMMAND ----------

# Databricks Secrets (production) — fallback to env vars (local dev)
try:
    REDIS_HOST = dbutils.secrets.get(scope="stream-pipeline", key="redis-host")
    REDIS_PORT = int(dbutils.secrets.get(scope="stream-pipeline", key="redis-port"))
    REDIS_PASSWORD = dbutils.secrets.get(scope="stream-pipeline", key="redis-password")
    CLICKHOUSE_HOST = dbutils.secrets.get(scope="stream-pipeline", key="clickhouse-host")
    CLICKHOUSE_PORT = int(dbutils.secrets.get(scope="stream-pipeline", key="clickhouse-port"))
    CLICKHOUSE_USER = dbutils.secrets.get(scope="stream-pipeline", key="clickhouse-user")
    CLICKHOUSE_PASSWORD = dbutils.secrets.get(scope="stream-pipeline", key="clickhouse-password")
except Exception:
    REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
    REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")
    CLICKHOUSE_HOST = os.getenv("CLICKHOUSE_HOST", "localhost")
    CLICKHOUSE_PORT = int(os.getenv("CLICKHOUSE_PORT", "8443"))
    CLICKHOUSE_USER = os.getenv("CLICKHOUSE_USER", "default")
    CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "")

REDIS_SSL = True
REDIS_STREAM_KEY = "binance_market_data"
REDIS_CONSUMER_GROUP = "spark_processor"
CLICKHOUSE_DATABASE = os.getenv("CLICKHOUSE_DATABASE", "default")
BATCH_SIZE = 500
BLOCK_MS = 5000
CHECKPOINT_DIR = "/dbfs/checkpoints/stream_processor"

print(f"Redis: {REDIS_HOST}:{REDIS_PORT}")
print(f"ClickHouse: {CLICKHOUSE_HOST}:{CLICKHOUSE_PORT}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Schema & Redis Setup

# COMMAND ----------

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


def get_redis():
    return redis.Redis(
        host=REDIS_HOST, port=REDIS_PORT,
        password=REDIS_PASSWORD if REDIS_PASSWORD else None,
        ssl=REDIS_SSL, decode_responses=True,
    )


r = get_redis()
try:
    r.xgroup_create(REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP, id="0", mkstream=True)
    print(f"Created consumer group '{REDIS_CONSUMER_GROUP}'")
except redis.ResponseError as e:
    if "BUSYGROUP" in str(e):
        print(f"Consumer group '{REDIS_CONSUMER_GROUP}' already exists")
    else:
        raise
r.close()

# COMMAND ----------

# MAGIC %md
# MAGIC ## Feature Generation
# MAGIC Same logic as `common/features.py` — inlined for notebook portability.

# COMMAND ----------

def add_all_features(df, partition_col="symbol", order_col="timestamp"):
    """SMA, RSI, returns, volatility, VWAP."""

    # SMA (7, 25, 99)
    for p in [7, 25, 99]:
        w = Window.partitionBy(partition_col).orderBy(order_col).rowsBetween(-(p - 1), 0)
        df = df.withColumn(f"sma_{p}", F.avg("close").over(w))

    # Returns
    w_lag = Window.partitionBy(partition_col).orderBy(order_col)
    prev = F.lag("close", 1).over(w_lag)
    df = df.withColumn("log_return", F.log(F.col("close") / prev))
    df = df.withColumn("pct_change", (F.col("close") - prev) / prev * 100.0)

    # RSI (14)
    w_rsi = Window.partitionBy(partition_col).orderBy(order_col).rowsBetween(-13, 0)
    df = df.withColumn("_delta", F.col("close") - F.lag("close", 1).over(w_lag))
    df = df.withColumn("_gain", F.when(F.col("_delta") > 0, F.col("_delta")).otherwise(0.0))
    df = df.withColumn("_loss", F.when(F.col("_delta") < 0, F.abs(F.col("_delta"))).otherwise(0.0))
    df = df.withColumn("_avg_gain", F.avg("_gain").over(w_rsi))
    df = df.withColumn("_avg_loss", F.avg("_loss").over(w_rsi))
    df = df.withColumn(
        "rsi_14",
        F.when(F.col("_avg_loss") == 0, 100.0)
         .otherwise(100.0 - (100.0 / (1.0 + F.col("_avg_gain") / F.col("_avg_loss"))))
    )
    df = df.drop("_delta", "_gain", "_loss", "_avg_gain", "_avg_loss")

    # Volatility (20)
    w_vol = Window.partitionBy(partition_col).orderBy(order_col).rowsBetween(-19, 0)
    df = df.withColumn("volatility_20", F.stddev("log_return").over(w_vol))

    # VWAP (20)
    w_vwap = Window.partitionBy(partition_col).orderBy(order_col).rowsBetween(-19, 0)
    df = df.withColumn("_tp", (F.col("high") + F.col("low") + F.col("close")) / 3.0)
    df = df.withColumn("vwap", F.sum(F.col("_tp") * F.col("volume")).over(w_vwap) / F.sum("volume").over(w_vwap))
    df = df.drop("_tp")

    return df

# COMMAND ----------

# MAGIC %md
# MAGIC ## ClickHouse Writer

# COMMAND ----------

def write_to_clickhouse(df):
    """Write DataFrame to ClickHouse market_klines_stream table."""
    import clickhouse_connect

    pdf = df.toPandas()
    if pdf.empty:
        return 0

    client = clickhouse_connect.get_client(
        host=CLICKHOUSE_HOST, port=CLICKHOUSE_PORT,
        username=CLICKHOUSE_USER, password=CLICKHOUSE_PASSWORD,
        database=CLICKHOUSE_DATABASE, secure=True,
    )

    columns = [
        "symbol", "timestamp", "open", "high", "low", "close", "volume",
        "quote_volume", "num_trades", "is_closed", "interval",
        "sma_7", "sma_25", "sma_99", "rsi_14",
        "log_return", "pct_change", "volatility_20", "vwap",
    ]
    available = [c for c in columns if c in pdf.columns]
    data = pdf[available].values.tolist()
    client.insert("market_klines_stream", data, column_names=available)
    client.close()
    return len(data)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Micro-Batch Processor

# COMMAND ----------

def process_batch(_trigger_df, epoch_id):
    """Read Redis → features → ClickHouse → ACK."""
    r = get_redis()

    messages = r.xreadgroup(
        groupname=REDIS_CONSUMER_GROUP,
        consumername="databricks-worker-1",
        streams={REDIS_STREAM_KEY: ">"},
        count=BATCH_SIZE, block=BLOCK_MS,
    )

    records, msg_ids = [], []
    if messages:
        for _stream, stream_msgs in messages:
            for msg_id, data in stream_msgs:
                try:
                    records.append(json.loads(data["data"]))
                    msg_ids.append(msg_id)
                except (json.JSONDecodeError, KeyError):
                    r.xack(REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP, msg_id)

    if not records:
        print(f"Epoch {epoch_id}: no new messages")
        r.close()
        return

    print(f"Epoch {epoch_id}: processing {len(records)} records")

    # Spark DataFrame
    spark_df = spark.createDataFrame(records, schema=KLINE_SCHEMA)
    spark_df = spark_df.withColumn("timestamp", (F.col("kline_start") / 1000).cast(TimestampType()))

    # Dedup
    w = Window.partitionBy("symbol", "kline_start").orderBy(F.col("event_time").desc())
    spark_df = spark_df.withColumn("_rn", F.row_number().over(w))
    spark_df = spark_df.filter(F.col("_rn") == 1).drop("_rn")

    # Features
    spark_df = add_all_features(spark_df)
    spark_df = spark_df.drop("event_time", "kline_start", "kline_close")

    # Write
    count = write_to_clickhouse(spark_df)

    # ACK
    if msg_ids:
        r.xack(REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP, *msg_ids)
    r.close()

    print(f"Epoch {epoch_id}: wrote {count} rows, ACK'd {len(msg_ids)} messages")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Start Streaming

# COMMAND ----------

rate_stream = (
    spark.readStream
    .format("rate")
    .option("rowsPerSecond", 1)
    .load()
)

query = (
    rate_stream.writeStream
    .foreachBatch(process_batch)
    .trigger(processingTime="10 seconds")
    .option("checkpointLocation", CHECKPOINT_DIR)
    .queryName("redis_to_clickhouse_stream")
    .start()
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Monitor & Control

# COMMAND ----------

# Check status:
# display(query.status)
# display(query.recentProgress)

# Stop:
# query.stop()

query.awaitTermination()
