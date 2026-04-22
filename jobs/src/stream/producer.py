"""
Binance WebSocket → Kafka Producer (Aiven)

Connects to Binance WebSocket for real-time kline data, parses messages
into a structured schema, and publishes to Kafka.

Features:
- Async WebSocket with automatic reconnect + exponential backoff
- Multiple symbols (configurable via BINANCE_SYMBOLS env var)
- Graceful shutdown (SIGINT / SIGTERM)
- Kafka with SSL (Aiven) — keyed by symbol for partition ordering

Usage:
    cd fullstackAI/jobs/src
    python -m stream.producer
"""

import asyncio
import json
import signal
import ssl
import sys
import time
from typing import Optional

import websockets
from aiokafka import AIOKafkaProducer

from config.settings import (
    BINANCE_INTERVAL,
    BINANCE_SYMBOLS,
    BINANCE_WS_BASE,
    KAFKA_BOOTSTRAP_SERVERS,
    KAFKA_TOPIC,
    KAFKA_SSL_CA,
    KAFKA_SSL_CERT,
    KAFKA_SSL_KEY,
    WS_RECONNECT_BACKOFF_FACTOR,
    WS_RECONNECT_DELAY_INITIAL,
    WS_RECONNECT_DELAY_MAX,
)
from utils.logger import setup_logger

logger = setup_logger("stream.producer")

shutdown_event = asyncio.Event()


def _handle_signal(sig, _frame):
    logger.info("Received signal %s — initiating graceful shutdown", sig)
    shutdown_event.set()


def _build_ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context(ssl.Purpose.SERVER_AUTH, cafile=KAFKA_SSL_CA)
    ctx.load_cert_chain(certfile=KAFKA_SSL_CERT, keyfile=KAFKA_SSL_KEY)
    return ctx


def build_ws_url(symbols: list[str], interval: str) -> str:
    streams = [f"{sym}@kline_{interval}" for sym in symbols]
    return f"{BINANCE_WS_BASE}/stream?streams={'/'.join(streams)}"


def parse_kline_message(raw: dict) -> Optional[dict]:
    try:
        data = raw.get("data", {})
        if data.get("e") != "kline":
            return None
        k = data["k"]
        return {
            "symbol":       data["s"],
            "event_time":   data["E"],
            "kline_start":  k["t"],
            "kline_close":  k["T"],
            "interval":     k["i"],
            "open":         float(k["o"]),
            "high":         float(k["h"]),
            "low":          float(k["l"]),
            "close":        float(k["c"]),
            "volume":       float(k["v"]),
            "quote_volume": float(k["q"]),
            "num_trades":   int(k["n"]),
            "is_closed":    bool(k["x"]),
        }
    except (KeyError, ValueError, TypeError) as e:
        logger.warning("Failed to parse kline message: %s", e)
        return None


class BinanceKafkaProducer:
    """Async producer: Binance WebSocket → Kafka (Aiven SSL)."""

    def __init__(self):
        self.kafka_producer: Optional[AIOKafkaProducer] = None
        self.msg_count = 0
        self.last_log_time = time.monotonic()

    async def start(self):
        self.kafka_producer = AIOKafkaProducer(
            bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
            security_protocol="SSL",
            ssl_context=_build_ssl_context(),
            value_serializer=lambda v: json.dumps(v).encode(),
            key_serializer=lambda k: k.encode() if k else None,
        )
        await self.kafka_producer.start()
        logger.info(
            "Producer started | symbols=%s | interval=%s | topic=%s | brokers=%s",
            BINANCE_SYMBOLS, BINANCE_INTERVAL, KAFKA_TOPIC, KAFKA_BOOTSTRAP_SERVERS,
        )
        try:
            await self._consume_websocket()
        finally:
            await self.kafka_producer.stop()
            logger.info("Kafka producer closed. Total messages published: %d", self.msg_count)

    async def _publish(self, record: dict):
        await self.kafka_producer.send(
            KAFKA_TOPIC,
            key=record["symbol"],
            value=record,
        )

    async def _consume_websocket(self):
        url = build_ws_url(BINANCE_SYMBOLS, BINANCE_INTERVAL)
        reconnect_delay = WS_RECONNECT_DELAY_INITIAL
        logger.info("WebSocket URL: %s", url)

        while not shutdown_event.is_set():
            try:
                async with websockets.connect(
                    url,
                    ping_interval=20,
                    ping_timeout=10,
                    close_timeout=5,
                ) as ws:
                    logger.info("WebSocket connected")
                    reconnect_delay = WS_RECONNECT_DELAY_INITIAL

                    while not shutdown_event.is_set():
                        try:
                            raw_msg = await asyncio.wait_for(ws.recv(), timeout=30)
                        except asyncio.TimeoutError:
                            logger.warning("WebSocket receive timeout — reconnecting")
                            break

                        payload = json.loads(raw_msg)
                        record = parse_kline_message(payload)
                        if record is None:
                            continue

                        await self._publish(record)
                        self.msg_count += 1

                        now = time.monotonic()
                        if now - self.last_log_time >= 60:
                            logger.info(
                                "Published %d msgs | last: %s close=%s closed=%s",
                                self.msg_count, record["symbol"],
                                record["close"], record["is_closed"],
                            )
                            self.last_log_time = now

            except websockets.exceptions.ConnectionClosed as e:
                logger.warning("WebSocket closed: %s", e)
            except Exception as e:
                logger.error("WebSocket error: %s", e, exc_info=True)

            if not shutdown_event.is_set():
                logger.info("Reconnecting in %ds...", reconnect_delay)
                try:
                    await asyncio.wait_for(shutdown_event.wait(), timeout=reconnect_delay)
                except asyncio.TimeoutError:
                    pass
                reconnect_delay = min(
                    reconnect_delay * WS_RECONNECT_BACKOFF_FACTOR,
                    WS_RECONNECT_DELAY_MAX,
                )

        logger.info("Producer loop exited")

    def run(self):
        asyncio.run(self.start())


def main():
    logger.info("Starting Binance Kafka Producer")
    producer = BinanceKafkaProducer()
    producer.run()


if __name__ == "__main__":
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)
    try:
        main()
    except KeyboardInterrupt:
        logger.info("KeyboardInterrupt — exiting")
        sys.exit(0)
