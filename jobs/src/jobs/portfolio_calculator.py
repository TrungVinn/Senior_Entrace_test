"""
Portfolio Calculator Job
Calculates portfolio metrics, risk analysis, and performance indicators
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from utils.database import get_db
from utils.logger import setup_logger
from sqlalchemy import text

logger = setup_logger(__name__)

class PortfolioCalculator:
    def __init__(self):
        self.db = get_db()

    def calculate_portfolio_value(self):
        """Calculate total portfolio value"""
        query = text("""
            SELECT
                SUM(quantity * current_price) as total_value,
                SUM(quantity * entry_price) as total_invested
            FROM positions
            WHERE quantity > 0
        """)

        result = self.db.execute(query).fetchone()
        return {
            'total_value': result[0] or 0,
            'total_invested': result[1] or 0
        }

    def calculate_returns(self):
        """Calculate portfolio returns"""
        portfolio = self.calculate_portfolio_value()
        total_value = portfolio['total_value']
        total_invested = portfolio['total_invested']

        if total_invested == 0:
            return {'total_return': 0, 'total_return_pct': 0}

        total_return = total_value - total_invested
        total_return_pct = (total_return / total_invested) * 100

        return {
            'total_return': round(total_return, 2),
            'total_return_pct': round(total_return_pct, 2)
        }

    def calculate_risk_metrics(self):
        """Calculate portfolio risk metrics"""
        # Get historical returns
        query = text("""
            SELECT symbol, current_price, entry_price, quantity
            FROM positions
            WHERE quantity > 0
        """)

        positions = pd.read_sql(query, self.db.bind)

        if positions.empty:
            return {
                'volatility': 0,
                'sharpe_ratio': 0,
                'max_drawdown': 0
            }

        # Calculate position values
        positions['value'] = positions['quantity'] * positions['current_price']
        positions['weight'] = positions['value'] / positions['value'].sum()

        # Simulated volatility (in production, use historical price data)
        daily_returns = np.random.randn(252) * 0.02  # 2% daily volatility
        portfolio_volatility = np.std(daily_returns) * np.sqrt(252) * 100

        # Sharpe ratio (assuming 4% risk-free rate)
        avg_return = np.mean(daily_returns) * 252
        sharpe_ratio = (avg_return - 0.04) / (np.std(daily_returns) * np.sqrt(252))

        # Maximum drawdown
        cumulative_returns = np.cumprod(1 + daily_returns)
        running_max = np.maximum.accumulate(cumulative_returns)
        drawdown = (cumulative_returns - running_max) / running_max
        max_drawdown = np.min(drawdown) * 100

        return {
            'volatility': round(portfolio_volatility, 2),
            'sharpe_ratio': round(sharpe_ratio, 2),
            'max_drawdown': round(max_drawdown, 2)
        }

    def calculate_concentration(self):
        """Calculate portfolio concentration metrics"""
        query = text("""
            SELECT
                symbol,
                quantity * current_price as value
            FROM positions
            WHERE quantity > 0
            ORDER BY value DESC
        """)

        positions = pd.read_sql(query, self.db.bind)

        if positions.empty:
            return {
                'top_holding': 0,
                'top_5_holdings': 0
            }

        total_value = positions['value'].sum()
        positions['weight'] = (positions['value'] / total_value) * 100

        return {
            'top_holding': round(positions['weight'].iloc[0], 2) if len(positions) > 0 else 0,
            'top_5_holdings': round(positions['weight'].head(5).sum(), 2)
        }

    def run(self):
        """Main job execution"""
        logger.info("Starting portfolio calculation job")

        try:
            returns = self.calculate_returns()
            risk = self.calculate_risk_metrics()
            concentration = self.calculate_concentration()

            logger.info(f"Portfolio Returns: {returns}")
            logger.info(f"Risk Metrics: {risk}")
            logger.info(f"Concentration: {concentration}")

            # Store results in cache or database
            logger.info("Portfolio calculation completed successfully")

        except Exception as e:
            logger.error(f"Error in portfolio calculation: {str(e)}")

def main():
    calculator = PortfolioCalculator()
    calculator.run()

if __name__ == '__main__':
    main()
