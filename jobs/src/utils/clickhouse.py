"""
ClickHouse Cloud client utility.
Uses clickhouse-connect for native HTTP interface (port 8443).
"""

import clickhouse_connect
from config.settings import (
    CLICKHOUSE_HOST,
    CLICKHOUSE_PORT,
    CLICKHOUSE_USER,
    CLICKHOUSE_PASSWORD,
    CLICKHOUSE_DATABASE,
    CLICKHOUSE_SECURE,
)
from utils.logger import setup_logger

logger = setup_logger(__name__)


def get_clickhouse_client():
    """Create a ClickHouse Cloud client connection."""
    client = clickhouse_connect.get_client(
        host=CLICKHOUSE_HOST,
        port=CLICKHOUSE_PORT,
        username=CLICKHOUSE_USER,
        password=CLICKHOUSE_PASSWORD,
        database=CLICKHOUSE_DATABASE,
        secure=CLICKHOUSE_SECURE,
    )
    logger.info(
        "Connected to ClickHouse at %s:%s (db=%s)",
        CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_DATABASE,
    )
    return client


def insert_dataframe(client, table: str, df, column_names: list[str]):
    """
    Insert a pandas DataFrame into ClickHouse.
    Uses native insert for best performance.
    """
    data = df[column_names].values.tolist()
    client.insert(table, data, column_names=column_names)
    logger.info("Inserted %d rows into %s", len(data), table)
