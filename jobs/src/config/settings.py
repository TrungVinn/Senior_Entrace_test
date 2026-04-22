import os
from dotenv import load_dotenv

load_dotenv()

# =============================================================================
# Database (PostgreSQL)
# =============================================================================
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/trading_db')

# =============================================================================
# Kafka — Aiven managed broker
# =============================================================================
KAFKA_BOOTSTRAP_SERVERS = os.getenv('KAFKA_BOOTSTRAP_SERVERS', '')
KAFKA_TOPIC             = os.getenv('KAFKA_TOPIC', 'binance_market_data')
KAFKA_CONSUMER_GROUP    = os.getenv('KAFKA_CONSUMER_GROUP', 'market_processor')
KAFKA_AUTO_OFFSET_RESET = os.getenv('KAFKA_AUTO_OFFSET_RESET', 'earliest')
KAFKA_SSL_CA            = os.getenv('KAFKA_SSL_CA', '/app/certs/ca.pem')
KAFKA_SSL_CERT          = os.getenv('KAFKA_SSL_CERT', '/app/certs/service.cert')
KAFKA_SSL_KEY           = os.getenv('KAFKA_SSL_KEY', '/app/certs/service.key')

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
STREAM_BATCH_SIZE          = int(os.getenv('STREAM_BATCH_SIZE', '500'))
STREAM_POLL_TIMEOUT_S      = float(os.getenv('STREAM_POLL_TIMEOUT_S', '5.0'))
STREAM_PROCESSING_INTERVAL = os.getenv('STREAM_PROCESSING_INTERVAL', '10 seconds')
SPARK_CHECKPOINT_DIR       = os.getenv('SPARK_CHECKPOINT_DIR', '/dbfs/checkpoints/stream_processor')

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
