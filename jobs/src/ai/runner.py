"""
AI Job Runner

Periodically runs all AI post-processing jobs:
1. Signal scoring (RSI + SMA + volume → BUY/SELL/NEUTRAL)
2. Anomaly detection (Z-score + Isolation Forest)
3. Regime classification (volatility percentiles)

Usage:
    cd fullstackAI/jobs/src
    python -m ai.runner
"""

import time
import signal
import sys

from utils.logger import setup_logger

logger = setup_logger("ai.runner")

_running = True


def _handle_signal(sig, _frame):
    global _running
    logger.info("Received signal %s — stopping", sig)
    _running = False


def main():
    from ai.signal_scoring import run_signal_scoring
    from ai.anomaly_detection import run_anomaly_detection
    from ai.regime_classification import run_regime_classification

    logger.info("AI Runner started — running jobs every 60s")

    cycle = 0
    while _running:
        cycle += 1
        logger.info("--- AI cycle #%d ---", cycle)

        try:
            run_signal_scoring()
        except Exception as e:
            logger.error("Signal scoring failed: %s", e, exc_info=True)

        try:
            run_anomaly_detection()
        except Exception as e:
            logger.error("Anomaly detection failed: %s", e, exc_info=True)

        try:
            run_regime_classification()
        except Exception as e:
            logger.error("Regime classification failed: %s", e, exc_info=True)

        logger.info("AI cycle #%d complete — sleeping 60s", cycle)

        # Sleep in small intervals for responsive shutdown
        for _ in range(60):
            if not _running:
                break
            time.sleep(1)

    logger.info("AI Runner stopped")


if __name__ == "__main__":
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
