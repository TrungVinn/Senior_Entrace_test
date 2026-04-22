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

import pandas as pd
import clickhouse_connect
from confluent_kafka import Consumer, KafkaError

from config.settings import (
    KAFKA_BOOTSTRAP_SERVERS, KAFKA_TOPIC, KAFKA_CONSUMER_GROUP,
    KAFKA_AUTO_OFFSET_RESET, KAFKA_SSL_CA, KAFKA_SSL_CERT, KAFKA_SSL_KEY,
    CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_USER,
    CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE, CLICKHOUSE_SECURE,
    STREAM_BATCH_SIZE, STREAM_POLL_TIMEOUT_S,
)
from utils.logger import setup_logger
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
    """Pure Python stream processor: Kafka (Aiven) → Pandas → ClickHouse."""

    def __init__(self):
        self.consumer = Consumer({
            'bootstrap.servers':        KAFKA_BOOTSTRAP_SERVERS,
            'security.protocol':        'SSL',
            'ssl.ca.location':          KAFKA_SSL_CA,
            'ssl.certificate.location': KAFKA_SSL_CERT,
            'ssl.key.location':         KAFKA_SSL_KEY,
            'group.id':                 KAFKA_CONSUMER_GROUP,
            'auto.offset.reset':        KAFKA_AUTO_OFFSET_RESET,
            'enable.auto.commit':       False,
        })
        self.consumer.subscribe([KAFKA_TOPIC])
        self.ch_client = None
        self.total_processed = 0
        logger.info(
            "Kafka consumer subscribed | topic=%s group=%s brokers=%s",
            KAFKA_TOPIC, KAFKA_CONSUMER_GROUP, KAFKA_BOOTSTRAP_SERVERS,
        )

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

    def _read_batch(self) -> tuple[list[dict], list]:
        """Read a batch of messages from Kafka."""
        messages = self.consumer.consume(
            num_messages=STREAM_BATCH_SIZE,
            timeout=STREAM_POLL_TIMEOUT_S,
        )
        records, offsets = [], []
        for msg in messages:
            if msg.error():
                if msg.error().code() != KafkaError._PARTITION_EOF:
                    logger.warning("Kafka error: %s", msg.error())
                continue
            try:
                record = json.loads(msg.value())
                records.append(record)
                offsets.append(msg)
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning("Skipping malformed message: %s", e)
        return records, offsets

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

    def _ack_messages(self, offsets: list):
        """Commit offsets to Kafka after successful processing."""
        if offsets:
            self.consumer.commit(message=offsets[-1])

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
            "Standalone processor started | Kafka=%s topic=%s group=%s",
            KAFKA_BOOTSTRAP_SERVERS, KAFKA_TOPIC, KAFKA_CONSUMER_GROUP,
        )
        logger.info(
            "ClickHouse=%s:%s db=%s | batch_size=%d poll_timeout=%.1fs",
            CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_DATABASE,
            STREAM_BATCH_SIZE, STREAM_POLL_TIMEOUT_S,
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
        self.consumer.close()
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
