"""
Job Scheduler
Manages and schedules all background jobs
"""

import schedule
import time
from utils.logger import setup_logger
from config.settings import JOB_INTERVAL_MINUTES
from jobs.market_data_fetcher import MarketDataFetcher
from jobs.portfolio_calculator import PortfolioCalculator

logger = setup_logger(__name__)

def run_market_data_job():
    """Run market data fetch job"""
    try:
        logger.info("Running market data fetch job")
        fetcher = MarketDataFetcher()
        fetcher.run()
    except Exception as e:
        logger.error(f"Market data job failed: {str(e)}")

def run_portfolio_calculation_job():
    """Run portfolio calculation job"""
    try:
        logger.info("Running portfolio calculation job")
        calculator = PortfolioCalculator()
        calculator.run()
    except Exception as e:
        logger.error(f"Portfolio calculation job failed: {str(e)}")

def main():
    """Main scheduler loop"""
    logger.info("Starting job scheduler")

    # Schedule jobs
    schedule.every(JOB_INTERVAL_MINUTES).minutes.do(run_market_data_job)
    schedule.every(15).minutes.do(run_portfolio_calculation_job)

    # Run jobs immediately on startup
    logger.info("Running initial jobs")
    run_market_data_job()
    run_portfolio_calculation_job()

    logger.info(f"Jobs scheduled. Market data: every {JOB_INTERVAL_MINUTES} minutes, Portfolio: every 15 minutes")

    # Keep the scheduler running
    while True:
        schedule.run_pending()
        time.sleep(60)

if __name__ == '__main__':
    main()
