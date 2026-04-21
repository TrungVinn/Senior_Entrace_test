"""
Shared feature generation logic for both batch and stream pipelines.

Features computed:
- SMA (Simple Moving Average) — 7, 25, 99 periods
- RSI (Relative Strength Index) — 14 periods
- Volatility (rolling std of log returns, 20 periods)
- Log returns & percentage change
- VWAP (Volume Weighted Average Price, 20 periods)

Both PySpark and Pandas implementations are provided so batch jobs
and stream processors can share the same feature logic.

Usage (PySpark):
    from common.features import add_all_features
    df = add_all_features(spark_df)

Usage (Pandas):
    from common.features import add_all_features_pandas
    df = add_all_features_pandas(pandas_df)
"""

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# PySpark feature generation
# ---------------------------------------------------------------------------
# PySpark imports deferred to avoid errors when Spark is not installed
# (e.g., in the producer container).

def add_sma(df, col="close", periods=None, partition_col="symbol", order_col="timestamp"):
    """Add Simple Moving Average columns."""
    from pyspark.sql import Window
    from pyspark.sql import functions as F

    if periods is None:
        periods = [7, 25, 99]
    for p in periods:
        w = Window.partitionBy(partition_col).orderBy(order_col).rowsBetween(-(p - 1), 0)
        df = df.withColumn(f"sma_{p}", F.avg(F.col(col)).over(w))
    return df


def add_rsi(df, col="close", period=14, partition_col="symbol", order_col="timestamp"):
    """Add RSI (Relative Strength Index) column."""
    from pyspark.sql import Window
    from pyspark.sql import functions as F

    w = Window.partitionBy(partition_col).orderBy(order_col)
    w_rsi = Window.partitionBy(partition_col).orderBy(order_col).rowsBetween(-(period - 1), 0)

    df = df.withColumn("_price_change", F.col(col) - F.lag(F.col(col), 1).over(w))
    df = df.withColumn("_gain", F.when(F.col("_price_change") > 0, F.col("_price_change")).otherwise(0.0))
    df = df.withColumn("_loss", F.when(F.col("_price_change") < 0, F.abs(F.col("_price_change"))).otherwise(0.0))
    df = df.withColumn("_avg_gain", F.avg(F.col("_gain")).over(w_rsi))
    df = df.withColumn("_avg_loss", F.avg(F.col("_loss")).over(w_rsi))
    df = df.withColumn(
        "rsi_14",
        F.when(F.col("_avg_loss") == 0, 100.0)
         .otherwise(100.0 - (100.0 / (1.0 + F.col("_avg_gain") / F.col("_avg_loss"))))
    )
    df = df.drop("_price_change", "_gain", "_loss", "_avg_gain", "_avg_loss")
    return df


def add_returns(df, col="close", partition_col="symbol", order_col="timestamp"):
    """Add log returns and percentage change columns."""
    from pyspark.sql import Window
    from pyspark.sql import functions as F

    w = Window.partitionBy(partition_col).orderBy(order_col)
    prev_close = F.lag(F.col(col), 1).over(w)
    df = df.withColumn("log_return", F.log(F.col(col) / prev_close))
    df = df.withColumn("pct_change", (F.col(col) - prev_close) / prev_close * 100.0)
    return df


def add_volatility(df, col="log_return", period=20, partition_col="symbol", order_col="timestamp"):
    """Add rolling volatility (std of log returns)."""
    from pyspark.sql import Window
    from pyspark.sql import functions as F

    w = Window.partitionBy(partition_col).orderBy(order_col).rowsBetween(-(period - 1), 0)
    df = df.withColumn(f"volatility_{period}", F.stddev(F.col(col)).over(w))
    return df


def add_vwap(df, partition_col="symbol", order_col="timestamp", period=20):
    """Add Volume Weighted Average Price."""
    from pyspark.sql import Window
    from pyspark.sql import functions as F

    w = Window.partitionBy(partition_col).orderBy(order_col).rowsBetween(-(period - 1), 0)
    df = df.withColumn("_typical_price", (F.col("high") + F.col("low") + F.col("close")) / 3.0)
    df = df.withColumn("_tp_volume", F.col("_typical_price") * F.col("volume"))
    df = df.withColumn("vwap", F.sum(F.col("_tp_volume")).over(w) / F.sum(F.col("volume")).over(w))
    df = df.drop("_typical_price", "_tp_volume")
    return df


def add_all_features(df, partition_col="symbol", order_col="timestamp"):
    """Apply all feature generation steps (PySpark DataFrame)."""
    df = add_sma(df, partition_col=partition_col, order_col=order_col)
    df = add_rsi(df, partition_col=partition_col, order_col=order_col)
    df = add_returns(df, partition_col=partition_col, order_col=order_col)
    df = add_volatility(df, partition_col=partition_col, order_col=order_col)
    df = add_vwap(df, partition_col=partition_col, order_col=order_col)
    return df


# ---------------------------------------------------------------------------
# Pandas feature generation
# ---------------------------------------------------------------------------

def add_all_features_pandas(df: pd.DataFrame) -> pd.DataFrame:
    """Apply all features using Pandas (grouped by symbol)."""
    result_frames = []
    for _symbol, group in df.groupby("symbol"):
        group = group.sort_values("timestamp").copy()

        # SMA
        for p in [7, 25, 99]:
            group[f"sma_{p}"] = group["close"].rolling(window=p, min_periods=1).mean()

        # Returns
        group["log_return"] = np.log(group["close"] / group["close"].shift(1))
        group["pct_change"] = group["close"].pct_change() * 100.0

        # RSI (14)
        delta = group["close"].diff()
        gain = delta.where(delta > 0, 0.0)
        loss = (-delta).where(delta < 0, 0.0)
        avg_gain = gain.rolling(window=14, min_periods=1).mean()
        avg_loss = loss.rolling(window=14, min_periods=1).mean()
        rs = avg_gain / avg_loss.replace(0, np.nan)
        group["rsi_14"] = 100.0 - (100.0 / (1.0 + rs))
        group["rsi_14"] = group["rsi_14"].fillna(100.0)

        # Volatility
        group["volatility_20"] = group["log_return"].rolling(window=20, min_periods=1).std()

        # VWAP
        tp = (group["high"] + group["low"] + group["close"]) / 3.0
        group["vwap"] = (
            (tp * group["volume"]).rolling(window=20, min_periods=1).sum()
            / group["volume"].rolling(window=20, min_periods=1).sum()
        )

        result_frames.append(group)

    return pd.concat(result_frames, ignore_index=True) if result_frames else df
