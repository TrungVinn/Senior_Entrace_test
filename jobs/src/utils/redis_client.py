"""
Redis client utility for both sync and async usage.
Follows template pattern from utils/database.py.
"""

import redis
import redis.asyncio as aioredis
from config.settings import REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_SSL
from utils.logger import setup_logger

logger = setup_logger(__name__)


def get_redis_client() -> redis.Redis:
    """Create a synchronous Redis client."""
    client = redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        password=REDIS_PASSWORD if REDIS_PASSWORD else None,
        ssl=REDIS_SSL,
        decode_responses=True,
        socket_connect_timeout=10,
        retry_on_timeout=True,
    )
    client.ping()
    logger.info("Connected to Redis at %s:%s (sync)", REDIS_HOST, REDIS_PORT)
    return client


async def get_async_redis_client() -> aioredis.Redis:
    """Create an async Redis client."""
    client = aioredis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        password=REDIS_PASSWORD if REDIS_PASSWORD else None,
        ssl=REDIS_SSL,
        decode_responses=True,
        socket_connect_timeout=10,
        retry_on_timeout=True,
    )
    await client.ping()
    logger.info("Connected to Redis at %s:%s (async)", REDIS_HOST, REDIS_PORT)
    return client
