"""
Signal Scoring Job

Combines RSI, SMA crossover, and volume signals into a composite
BUY / SELL / NEUTRAL score per symbol.

Scoring logic:
- RSI component (40%): RSI < 30 → +1 (oversold/buy), RSI > 70 → -1 (overbought/sell)
- SMA component (40%): close > sma_7 > sma_25 → +1 (bullish), reverse → -1 (bearish)
- Volume component (20%): volume > 2x avg → +0.5 * price_direction

Composite: score > 0.3 → BUY, score < -0.3 → SELL, else NEUTRAL
"""

import numpy as np
import pandas as pd
import clickhouse_connect
from config.settings import (
    CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_USER,
    CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE, CLICKHOUSE_SECURE,
)
from utils.logger import setup_logger

logger = setup_logger("ai.signal_scoring")


def _get_client():
    return clickhouse_connect.get_client(
        host=CLICKHOUSE_HOST, port=CLICKHOUSE_PORT,
        username=CLICKHOUSE_USER, password=CLICKHOUSE_PASSWORD,
        database=CLICKHOUSE_DATABASE, secure=CLICKHOUSE_SECURE,
    )


def _compute_rsi_component(rsi: float) -> float:
    """RSI component: -1 to +1 scale."""
    if np.isnan(rsi):
        return 0.0
    if rsi < 30:
        return 1.0 - (rsi / 30.0)  # 0→1, 30→0
    elif rsi > 70:
        return -((rsi - 70.0) / 30.0)  # 70→0, 100→-1
    else:
        return 0.0


def _compute_sma_component(close: float, sma7: float, sma25: float) -> float:
    """SMA crossover component: -1 to +1."""
    if np.isnan(sma7) or np.isnan(sma25) or sma25 == 0:
        return 0.0
    if close > sma7 > sma25:
        return min(1.0, (close - sma25) / sma25 * 10)
    elif close < sma7 < sma25:
        return max(-1.0, (close - sma25) / sma25 * 10)
    else:
        return 0.0


def _compute_volume_component(volume: float, avg_volume: float, pct_change: float) -> float:
    """Volume anomaly component: ±0.5 if volume spike + direction."""
    if np.isnan(avg_volume) or avg_volume == 0 or np.isnan(pct_change):
        return 0.0
    if volume > 2.0 * avg_volume:
        direction = 1.0 if pct_change > 0 else -1.0
        return 0.5 * direction
    return 0.0


def run_signal_scoring():
    """Main job: compute signals for all symbols, write to ClickHouse."""
    client = _get_client()

    # Read recent data
    query = """
        SELECT symbol, timestamp, close, volume, sma_7, sma_25, rsi_14, pct_change
        FROM market_klines_stream FINAL
        ORDER BY symbol, timestamp DESC
        LIMIT 500
    """
    result = client.query(query)
    if not result.result_rows:
        logger.info("No data in market_klines_stream — skipping")
        client.close()
        return

    df = pd.DataFrame(result.result_rows, columns=result.column_names)

    signals = []
    for symbol, group in df.groupby("symbol"):
        group = group.sort_values("timestamp")
        if group.empty:
            continue

        latest = group.iloc[-1]
        close = float(latest["close"])
        sma7 = float(latest["sma_7"]) if latest["sma_7"] is not None else np.nan
        sma25 = float(latest["sma_25"]) if latest["sma_25"] is not None else np.nan
        rsi = float(latest["rsi_14"]) if latest["rsi_14"] is not None else np.nan
        volume = float(latest["volume"])
        pct = float(latest["pct_change"]) if latest["pct_change"] is not None else np.nan
        avg_vol = float(group["volume"].mean())

        rsi_comp = _compute_rsi_component(rsi)
        sma_comp = _compute_sma_component(close, sma7, sma25)
        vol_comp = _compute_volume_component(volume, avg_vol, pct)

        score = 0.4 * rsi_comp + 0.4 * sma_comp + 0.2 * vol_comp

        if score > 0.3:
            signal = "BUY"
        elif score < -0.3:
            signal = "SELL"
        else:
            signal = "NEUTRAL"

        signals.append([
            symbol, latest["timestamp"], signal, round(score, 4),
            round(rsi_comp, 4), round(sma_comp, 4), round(vol_comp, 4),
        ])

    if signals:
        client.insert(
            "market_ai_signals", signals,
            column_names=["symbol", "timestamp", "signal", "score",
                          "rsi_component", "sma_component", "volume_component"],
        )
        logger.info("Wrote %d signals to market_ai_signals", len(signals))
    else:
        logger.info("No signals computed")

    client.close()


if __name__ == "__main__":
    run_signal_scoring()
