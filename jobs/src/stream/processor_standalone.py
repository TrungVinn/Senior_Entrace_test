"""
Standalone Stream Processor (No Spark / No Databricks required)

Redis Streams → Pandas (feature generation) → ClickHouse Cloud

Runs as a long-lived Python process. Uses Redis consumer groups for
reliable at-least-once delivery. Processes in micro-batches using Pandas
(same feature logic as the Spark version via common/features.py).

Usage:
    cd fullstackAI/jobs/src
    python -m stream.processor_standalone

    Or via Docker:
    docker-compose up processor
"""

import json
import signal
import sys
import time
from datetime import datetime, timezone

import pandas as pd
import clickhouse_connect

from config.settings import (
    REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_SSL,
    REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP,
    CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_USER,
    CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE, CLICKHOUSE_SECURE,
    STREAM_BATCH_SIZE, STREAM_BLOCK_MS,
)
from utils.logger import setup_logger
from utils.redis_client import get_redis_client
from common.features import add_all_features_pandas

logger = setup_logger("stream.processor_standalone")

# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------
_running = True


def _handle_signal(sig, _frame):
    global _running
    logger.info("Received signal %s — shutting down after current batch", sig)
    _running = False


# ---------------------------------------------------------------------------
# ClickHouse columns to write
# ---------------------------------------------------------------------------
CLICKHOUSE_COLUMNS = [
    "symbol", "timestamp", "open", "high", "low", "close", "volume",
    "quote_volume", "num_trades", "is_closed", "interval",
    "sma_7", "sma_25", "sma_99", "rsi_14",
    "log_return", "pct_change", "volatility_20", "vwap",
]


# ---------------------------------------------------------------------------
# Processor (follows template class-based pattern)
# ---------------------------------------------------------------------------

class StandaloneProcessor:
    """Pure Python stream processor: Redis Streams → Pandas → ClickHouse."""

    def __init__(self):
        self.redis_client = get_redis_client()
        self.ch_client = None
        self.consumer_name = "standalone-worker-1"
        self.total_processed = 0
        self._ensure_consumer_group()

    def _ensure_consumer_group(self):
        """Create consumer group if it doesn't exist."""
        try:
            self.redis_client.xgroup_create(
                REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP, id="0", mkstream=True,
            )
            logger.info("Created consumer group '%s'", REDIS_CONSUMER_GROUP)
        except Exception as e:
            if "BUSYGROUP" in str(e):
                logger.info("Consumer group '%s' already exists", REDIS_CONSUMER_GROUP)
            else:
                raise

    def _get_clickhouse(self):
        """Lazy ClickHouse connection."""
        if self.ch_client is None:
            self.ch_client = clickhouse_connect.get_client(
                host=CLICKHOUSE_HOST,
                port=CLICKHOUSE_PORT,
                username=CLICKHOUSE_USER,
                password=CLICKHOUSE_PASSWORD,
                database=CLICKHOUSE_DATABASE,
                secure=CLICKHOUSE_SECURE,
            )
            logger.info("Connected to ClickHouse at %s:%s", CLICKHOUSE_HOST, CLICKHOUSE_PORT)
        return self.ch_client

    def _read_batch(self) -> tuple[list[dict], list[str]]:
        """Read a batch of messages from Redis Streams."""
        messages = self.redis_client.xreadgroup(
            groupname=REDIS_CONSUMER_GROUP,
            consumername=self.consumer_name,
            streams={REDIS_STREAM_KEY: ">"},
            count=STREAM_BATCH_SIZE,
            block=STREAM_BLOCK_MS,
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
                    self.redis_client.xack(REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP, msg_id)

        return records, msg_ids

    def _process_and_write(self, records: list[dict]) -> int:
        """Convert to DataFrame, compute features, write to ClickHouse."""
        df = pd.DataFrame(records)

        # Convert epoch ms → datetime
        df["timestamp"] = pd.to_datetime(df["kline_start"], unit="ms")

        # Dedup: keep latest event per (symbol, kline_start)
        df = df.sort_values("event_time", ascending=False)
        df = df.drop_duplicates(subset=["symbol", "kline_start"], keep="first")

        # Feature generation (shared Pandas implementation)
        df = add_all_features_pandas(df)

        # Select columns for ClickHouse
        available = [c for c in CLICKHOUSE_COLUMNS if c in df.columns]
        write_df = df[available]

        # Write to ClickHouse
        client = self._get_clickhouse()
        data = write_df.values.tolist()
        client.insert("market_klines_stream", data, column_names=available)

        return len(data)

    def _ack_messages(self, msg_ids: list[str]):
        """ACK processed messages in Redis."""
        if msg_ids:
            self.redis_client.xack(REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP, *msg_ids)

    def process_one_batch(self) -> int:
        """Process a single micro-batch. Returns number of records processed."""
        records, msg_ids = self._read_batch()

        if not records:
            return 0

        count = self._process_and_write(records)
        self._ack_messages(msg_ids)

        return count

    def run(self):
        """Main loop — process batches until shutdown signal."""
        logger.info(
            "Standalone processor started | Redis=%s:%s stream=%s group=%s",
            REDIS_HOST, REDIS_PORT, REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP,
        )
        logger.info(
            "ClickHouse=%s:%s db=%s | batch_size=%d block_ms=%d",
            CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_DATABASE,
            STREAM_BATCH_SIZE, STREAM_BLOCK_MS,
        )

        batch_num = 0
        while _running:
            try:
                count = self.process_one_batch()
                batch_num += 1
                self.total_processed += count

                if count > 0:
                    logger.info(
                        "Batch #%d: processed %d records (total: %d)",
                        batch_num, count, self.total_processed,
                    )
                elif batch_num % 30 == 0:
                    # Log heartbeat every ~30 empty batches
                    logger.info(
                        "Heartbeat: batch #%d, total processed: %d, stream healthy",
                        batch_num, self.total_processed,
                    )

            except Exception as e:
                logger.error("Batch #%d failed: %s", batch_num, e, exc_info=True)
                # Brief pause before retry to avoid tight error loop
                time.sleep(2)

        logger.info("Processor stopped. Total records processed: %d", self.total_processed)

    def stop(self):
        """Clean up connections."""
        if self.redis_client:
            self.redis_client.close()
        if self.ch_client:
            self.ch_client.close()
        logger.info("Connections closed")


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def main():
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    processor = StandaloneProcessor()
    try:
        processor.run()
    finally:
        processor.stop()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("KeyboardInterrupt — exiting")
        sys.exit(0)
