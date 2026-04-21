"""
Market Regime Classification Job

Classifies the current market regime for each symbol based on
rolling volatility percentiles:
- volatility < 33rd percentile → low_volatility
- 33rd–66th percentile → medium_volatility
- > 66th percentile → high_volatility

Confidence is based on distance from the nearest threshold boundary.
"""

import numpy as np
import pandas as pd
import clickhouse_connect
from config.settings import (
    CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_USER,
    CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE, CLICKHOUSE_SECURE,
)
from utils.logger import setup_logger

logger = setup_logger("ai.regime_classification")


def _get_client():
    return clickhouse_connect.get_client(
        host=CLICKHOUSE_HOST, port=CLICKHOUSE_PORT,
        username=CLICKHOUSE_USER, password=CLICKHOUSE_PASSWORD,
        database=CLICKHOUSE_DATABASE, secure=CLICKHOUSE_SECURE,
    )


def run_regime_classification():
    """Main job: classify regime for each symbol."""
    client = _get_client()

    result = client.query("""
        SELECT symbol, timestamp, volatility_20
        FROM market_klines_stream FINAL
        WHERE volatility_20 IS NOT NULL
        ORDER BY symbol, timestamp DESC
        LIMIT 1000
    """)

    if not result.result_rows:
        logger.info("No data — skipping regime classification")
        client.close()
        return

    df = pd.DataFrame(result.result_rows, columns=result.column_names)

    regimes = []
    for symbol, group in df.groupby("symbol"):
        group = group.sort_values("timestamp")
        if group.empty:
            continue

        vol_series = group["volatility_20"].dropna()
        if len(vol_series) < 5:
            continue

        p33 = float(vol_series.quantile(0.33))
        p66 = float(vol_series.quantile(0.66))
        latest_vol = float(vol_series.iloc[-1])
        latest_ts = group.iloc[-1]["timestamp"]

        if latest_vol < p33:
            regime = "low_volatility"
            # Distance to nearest boundary (p33)
            dist = (p33 - latest_vol) / max(p33, 1e-10)
        elif latest_vol > p66:
            regime = "high_volatility"
            dist = (latest_vol - p66) / max(latest_vol, 1e-10)
        else:
            regime = "medium_volatility"
            mid = (p33 + p66) / 2
            half_range = (p66 - p33) / 2
            dist = 1.0 - abs(latest_vol - mid) / max(half_range, 1e-10)

        confidence = round(max(0.5, min(1.0, 0.5 + dist * 0.5)), 4)

        regimes.append([
            symbol, latest_ts, regime, confidence, round(latest_vol, 8),
        ])

    if regimes:
        client.insert(
            "market_regimes", regimes,
            column_names=["symbol", "timestamp", "regime", "confidence", "volatility_value"],
        )
        logger.info("Wrote %d regimes to market_regimes", len(regimes))
    else:
        logger.info("No regimes computed")

    client.close()


if __name__ == "__main__":
    run_regime_classification()
