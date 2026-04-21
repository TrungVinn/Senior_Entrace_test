"""
Market Data Fetcher Job
Fetches real-time market data from financial APIs and updates the database
"""

import yfinance as yf
from datetime import datetime
from utils.database import get_db, Stock, ChartData
from utils.logger import setup_logger
from config.settings import TRACKED_SYMBOLS, MARKET_INDICES

logger = setup_logger(__name__)

class MarketDataFetcher:
    def __init__(self):
        self.db = get_db()

    def fetch_stock_data(self, symbol: str) -> dict:
        """Fetch stock data from Yahoo Finance"""
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            history = ticker.history(period='1d')

            if history.empty:
                logger.warning(f"No data available for {symbol}")
                return None

            current_price = history['Close'].iloc[-1]
            previous_close = info.get('previousClose', current_price)
            change = current_price - previous_close
            change_percent = (change / previous_close) * 100 if previous_close else 0

            return {
                'symbol': symbol,
                'name': info.get('longName', symbol),
                'price': round(current_price, 2),
                'change': round(change, 2),
                'change_percent': round(change_percent, 2),
                'volume': self.format_volume(info.get('volume', 0)),
                'market_cap': self.format_market_cap(info.get('marketCap', 0)),
                'updated_at': datetime.utcnow()
            }
        except Exception as e:
            logger.error(f"Error fetching data for {symbol}: {str(e)}")
            return None

    def format_volume(self, volume: int) -> str:
        """Format volume to human-readable format"""
        if volume >= 1_000_000:
            return f"{volume / 1_000_000:.1f}M"
        elif volume >= 1_000:
            return f"{volume / 1_000:.1f}K"
        return str(volume)

    def format_market_cap(self, market_cap: int) -> str:
        """Format market cap to human-readable format"""
        if market_cap >= 1_000_000_000_000:
            return f"{market_cap / 1_000_000_000_000:.2f}T"
        elif market_cap >= 1_000_000_000:
            return f"{market_cap / 1_000_000_000:.0f}B"
        elif market_cap >= 1_000_000:
            return f"{market_cap / 1_000_000:.0f}M"
        return str(market_cap)

    def update_stock_in_db(self, stock_data: dict):
        """Update or insert stock data in database"""
        try:
            existing_stock = self.db.query(Stock).filter(
                Stock.symbol == stock_data['symbol']
            ).first()

            if existing_stock:
                for key, value in stock_data.items():
                    setattr(existing_stock, key, value)
                logger.info(f"Updated {stock_data['symbol']}")
            else:
                new_stock = Stock(**stock_data)
                self.db.add(new_stock)
                logger.info(f"Added new stock {stock_data['symbol']}")

            self.db.commit()
        except Exception as e:
            logger.error(f"Database error: {str(e)}")
            self.db.rollback()

    def run(self):
        """Main job execution"""
        logger.info("Starting market data fetch job")

        all_symbols = TRACKED_SYMBOLS + list(MARKET_INDICES.keys())

        for symbol in all_symbols:
            logger.info(f"Fetching data for {symbol}")
            stock_data = self.fetch_stock_data(symbol)

            if stock_data:
                self.update_stock_in_db(stock_data)

        logger.info("Market data fetch job completed")

def main():
    fetcher = MarketDataFetcher()
    fetcher.run()

if __name__ == '__main__':
    main()
