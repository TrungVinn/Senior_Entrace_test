import os
from dotenv import load_dotenv

load_dotenv()

# =============================================================================
# Database (PostgreSQL)
# =============================================================================
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/trading_db')

# =============================================================================
# Redis — message broker (replacing Kafka) + cache
# =============================================================================
REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379')
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', '6379'))
REDIS_PASSWORD = os.getenv('REDIS_PASSWORD', '')
REDIS_SSL = os.getenv('REDIS_SSL', 'false').lower() in ('true', '1', 'yes')

# Stream settings
REDIS_STREAM_KEY = os.getenv('REDIS_STREAM_KEY', 'binance_market_data')
REDIS_CONSUMER_GROUP = os.getenv('REDIS_CONSUMER_GROUP', 'market_processor')
REDIS_MAXLEN = int(os.getenv('REDIS_MAXLEN', '100000'))

# =============================================================================
# ClickHouse Cloud
# =============================================================================
CLICKHOUSE_HOST = os.getenv('CLICKHOUSE_HOST', 'localhost')
CLICKHOUSE_PORT = int(os.getenv('CLICKHOUSE_PORT', '8443'))
CLICKHOUSE_USER = os.getenv('CLICKHOUSE_USER', 'default')
CLICKHOUSE_PASSWORD = os.getenv('CLICKHOUSE_PASSWORD', '')
CLICKHOUSE_DATABASE = os.getenv('CLICKHOUSE_DATABASE', 'default')
CLICKHOUSE_SECURE = os.getenv('CLICKHOUSE_SECURE', 'true').lower() in ('true', '1', 'yes')

# =============================================================================
# Binance WebSocket (stream producer)
# =============================================================================
BINANCE_SYMBOLS = [
    s.strip().lower()
    for s in os.getenv('BINANCE_SYMBOLS', 'btcusdt,ethusdt').split(',')
]
BINANCE_INTERVAL = os.getenv('BINANCE_INTERVAL', '1m')
BINANCE_WS_BASE = 'wss://stream.binance.com:9443'

# =============================================================================
# Stream Processor
# =============================================================================
STREAM_BATCH_SIZE = int(os.getenv('STREAM_BATCH_SIZE', '500'))
STREAM_BLOCK_MS = int(os.getenv('STREAM_BLOCK_MS', '5000'))
STREAM_PROCESSING_INTERVAL = os.getenv('STREAM_PROCESSING_INTERVAL', '10 seconds')
SPARK_CHECKPOINT_DIR = os.getenv('SPARK_CHECKPOINT_DIR', '/dbfs/checkpoints/stream_processor')

# =============================================================================
# WebSocket reconnect
# =============================================================================
WS_RECONNECT_DELAY_INITIAL = int(os.getenv('WS_RECONNECT_DELAY_INITIAL', '1'))
WS_RECONNECT_DELAY_MAX = int(os.getenv('WS_RECONNECT_DELAY_MAX', '60'))
WS_RECONNECT_BACKOFF_FACTOR = int(os.getenv('WS_RECONNECT_BACKOFF_FACTOR', '2'))

# =============================================================================
# API & Job settings (existing template)
# =============================================================================
MARKET_DATA_API_KEY = os.getenv('MARKET_DATA_API_KEY', '')
JOB_INTERVAL_MINUTES = int(os.getenv('JOB_INTERVAL_MINUTES', '5'))
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')

# Stock symbols to track
TRACKED_SYMBOLS = [
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA',
    'NVDA', 'META', 'JPM', 'V', 'WMT'
]

# Market indices
MARKET_INDICES = {
    '^GSPC': 'S&P 500',
    '^IXIC': 'NASDAQ',
    '^DJI': 'DOW',
    'GC=F': 'GOLD'
}
