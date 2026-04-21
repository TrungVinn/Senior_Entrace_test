"""
Binance WebSocket → Redis Streams Producer

Connects to Binance WebSocket for real-time kline data, parses messages
into a structured schema, and publishes to Redis Streams.

Follows template pattern: class-based job with config from settings.py
and logging from utils/logger.py.

Features:
- Async WebSocket with automatic reconnect + exponential backoff
- Multiple symbols (configurable via BINANCE_SYMBOLS env var)
- Graceful shutdown (SIGINT / SIGTERM)
- Redis Streams with MAXLEN trimming (bounded memory)
- Structured logging

Usage:
    cd fullstackAI/jobs/src
    python -m stream.producer
"""

import asyncio
import json
import signal
import sys
import time
from typing import Optional

import websockets

from config.settings import (
    BINANCE_INTERVAL,
    BINANCE_SYMBOLS,
    BINANCE_WS_BASE,
    REDIS_MAXLEN,
    REDIS_STREAM_KEY,
    WS_RECONNECT_BACKOFF_FACTOR,
    WS_RECONNECT_DELAY_INITIAL,
    WS_RECONNECT_DELAY_MAX,
)
from utils.logger import setup_logger
from utils.redis_client import get_async_redis_client

logger = setup_logger("stream.producer")

# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------
shutdown_event = asyncio.Event()


def _handle_signal(sig, _frame):
    logger.info("Received signal %s — initiating graceful shutdown", sig)
    shutdown_event.set()


# ---------------------------------------------------------------------------
# WebSocket helpers
# ---------------------------------------------------------------------------

def build_ws_url(symbols: list[str], interval: str) -> str:
    """Build combined Binance WebSocket stream URL for multiple kline streams."""
    streams = [f"{sym}@kline_{interval}" for sym in symbols]
    stream_path = "/".join(streams)
    return f"{BINANCE_WS_BASE}/stream?streams={stream_path}"


def parse_kline_message(raw: dict) -> Optional[dict]:
    """
    Parse Binance combined stream kline message.

    Input (Binance combined stream format):
    {
        "stream": "btcusdt@kline_1m",
        "data": {
            "e": "kline", "E": 1672515782136, "s": "BTCUSDT",
            "k": { "t": ..., "T": ..., "o": "16800.00", ... }
        }
    }

    Output:
    {
        "symbol": "BTCUSDT", "event_time": 1672515782136,
        "kline_start": ..., "open": 16800.0, ...
    }
    """
    try:
        data = raw.get("data", {})
        if data.get("e") != "kline":
            return None

        k = data["k"]
        return {
            "symbol": data["s"],
            "event_time": data["E"],
            "kline_start": k["t"],
            "kline_close": k["T"],
            "interval": k["i"],
            "open": float(k["o"]),
            "high": float(k["h"]),
            "low": float(k["l"]),
            "close": float(k["c"]),
            "volume": float(k["v"]),
            "quote_volume": float(k["q"]),
            "num_trades": int(k["n"]),
            "is_closed": bool(k["x"]),
        }
    except (KeyError, ValueError, TypeError) as e:
        logger.warning("Failed to parse kline message: %s", e)
        return None


# ---------------------------------------------------------------------------
# Producer (follows template class-based pattern like MarketDataFetcher)
# ---------------------------------------------------------------------------

class BinanceRedisProducer:
    """Async producer: Binance WebSocket → Redis Streams."""

    def __init__(self):
        self.redis_client = None
        self.msg_count = 0
        self.last_log_time = time.monotonic()

    async def start(self):
        """Initialize Redis and start consuming WebSocket data."""
        self.redis_client = await get_async_redis_client()
        logger.info(
            "Producer started | symbols=%s | interval=%s | stream=%s | maxlen=%s",
            BINANCE_SYMBOLS, BINANCE_INTERVAL, REDIS_STREAM_KEY, REDIS_MAXLEN,
        )
        try:
            await self._consume_websocket()
        finally:
            await self.redis_client.aclose()
            logger.info("Redis closed. Total messages published: %d", self.msg_count)

    async def _publish(self, record: dict) -> str:
        """Publish record to Redis Streams with MAXLEN trimming."""
        msg_id = await self.redis_client.xadd(
            REDIS_STREAM_KEY,
            {"data": json.dumps(record)},
            maxlen=REDIS_MAXLEN,
            approximate=True,
        )
        return msg_id

    async def _consume_websocket(self):
        """WebSocket consumer loop with automatic reconnect + backoff."""
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

                        msg_id = await self._publish(record)
                        self.msg_count += 1

                        # Periodic throughput log every 60s
                        now = time.monotonic()
                        if now - self.last_log_time >= 60:
                            logger.info(
                                "Published %d msgs | last: %s close=%s closed=%s | id=%s",
                                self.msg_count, record["symbol"],
                                record["close"], record["is_closed"], msg_id,
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
        """Synchronous entry point (matches template pattern)."""
        asyncio.run(self.start())


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def main():
    logger.info("Starting Binance Redis Producer")
    producer = BinanceRedisProducer()
    producer.run()


if __name__ == "__main__":
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    try:
        main()
    except KeyboardInterrupt:
        logger.info("KeyboardInterrupt — exiting")
        sys.exit(0)
