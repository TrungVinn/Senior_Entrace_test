"""
Anomaly Detection Job

Detects anomalies in price and volume using:
1. Z-score method: flag points where |z| > 2.5 on rolling 50-period window
2. Isolation Forest (sklearn): multivariate anomaly on [close, volume, pct_change, volatility]

Severity mapping:
- |z| > 3.5 → high
- |z| > 3.0 → medium
- |z| > 2.5 → low
"""

import numpy as np
import pandas as pd
import clickhouse_connect
from sklearn.ensemble import IsolationForest
from config.settings import (
    CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_USER,
    CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE, CLICKHOUSE_SECURE,
)
from utils.logger import setup_logger

logger = setup_logger("ai.anomaly_detection")


def _get_client():
    return clickhouse_connect.get_client(
        host=CLICKHOUSE_HOST, port=CLICKHOUSE_PORT,
        username=CLICKHOUSE_USER, password=CLICKHOUSE_PASSWORD,
        database=CLICKHOUSE_DATABASE, secure=CLICKHOUSE_SECURE,
    )


def _zscore_anomalies(group: pd.DataFrame, symbol: str) -> list:
    """Detect Z-score anomalies on close price and volume."""
    anomalies = []
    for col, label in [("close", "price_zscore"), ("volume", "volume_zscore")]:
        rolling_mean = group[col].rolling(50, min_periods=10).mean()
        rolling_std = group[col].rolling(50, min_periods=10).std()
        zscore = (group[col] - rolling_mean) / rolling_std.replace(0, np.nan)

        for idx in group.index:
            z = zscore.loc[idx]
            if pd.isna(z) or abs(z) < 2.5:
                continue

            abs_z = abs(z)
            if abs_z > 3.5:
                severity = "high"
            elif abs_z > 3.0:
                severity = "medium"
            else:
                severity = "low"

            direction = "spike" if z > 0 else "drop"
            desc = f"{col.capitalize()} {direction}: z-score={z:.2f}"

            anomalies.append([
                symbol, group.loc[idx, "timestamp"], label,
                severity, round(float(z), 4), desc,
            ])

    return anomalies


def _isolation_forest_anomalies(group: pd.DataFrame, symbol: str) -> list:
    """Detect anomalies using Isolation Forest."""
    features = ["close", "volume", "pct_change", "volatility_20"]
    feat_df = group[features].dropna()

    if len(feat_df) < 20:
        return []

    iso = IsolationForest(contamination=0.05, random_state=42, n_estimators=100)
    scores = iso.fit_predict(feat_df.values)

    anomalies = []
    for i, (idx, score) in enumerate(zip(feat_df.index, scores)):
        if score == -1:
            anomalies.append([
                symbol, group.loc[idx, "timestamp"], "isolation_forest",
                "medium", 0.0, "Multivariate anomaly detected by Isolation Forest",
            ])

    return anomalies


def run_anomaly_detection():
    """Main job: detect anomalies for all symbols."""
    client = _get_client()

    result = client.query("""
        SELECT symbol, timestamp, close, volume, pct_change, volatility_20
        FROM market_klines_stream FINAL
        ORDER BY symbol, timestamp DESC
        LIMIT 2000
    """)

    if not result.result_rows:
        logger.info("No data — skipping anomaly detection")
        client.close()
        return

    df = pd.DataFrame(result.result_rows, columns=result.column_names)

    all_anomalies = []
    for symbol, group in df.groupby("symbol"):
        group = group.sort_values("timestamp").reset_index(drop=True)
        all_anomalies.extend(_zscore_anomalies(group, symbol))
        all_anomalies.extend(_isolation_forest_anomalies(group, symbol))

    if all_anomalies:
        client.insert(
            "market_anomalies", all_anomalies,
            column_names=["symbol", "timestamp", "type", "severity", "zscore", "description"],
        )
        logger.info("Wrote %d anomalies to market_anomalies", len(all_anomalies))
    else:
        logger.info("No anomalies detected")

    client.close()


if __name__ == "__main__":
    run_anomaly_detection()
