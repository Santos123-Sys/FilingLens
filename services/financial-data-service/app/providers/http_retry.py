from __future__ import annotations

import asyncio
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

import httpx

RETRYABLE_STATUS = {429, 500, 502, 503, 504}
DEFAULT_ATTEMPTS = 3
DEFAULT_BASE_DELAY = 0.35
MAX_RETRY_AFTER_SECONDS = 5.0


def retryable_status(status_code: int) -> bool:
    return status_code in RETRYABLE_STATUS


def retry_delay_seconds(response: httpx.Response | None, attempt: int, base_delay: float = DEFAULT_BASE_DELAY) -> float:
    """Bound provider-directed Retry-After and otherwise use exponential backoff."""
    if response is not None:
        raw = response.headers.get("Retry-After")
        if raw:
            try:
                return min(MAX_RETRY_AFTER_SECONDS, max(0.0, float(raw)))
            except ValueError:
                try:
                    target = parsedate_to_datetime(raw)
                    if target.tzinfo is None:
                        target = target.replace(tzinfo=timezone.utc)
                    seconds = (target - datetime.now(timezone.utc)).total_seconds()
                    return min(MAX_RETRY_AFTER_SECONDS, max(0.0, seconds))
                except (TypeError, ValueError, OverflowError):
                    pass
    return min(MAX_RETRY_AFTER_SECONDS, max(0.0, base_delay * (2 ** attempt)))


async def get_with_retry(
    client: httpx.AsyncClient,
    url: str,
    *,
    attempts: int = DEFAULT_ATTEMPTS,
    base_delay: float = DEFAULT_BASE_DELAY,
) -> httpx.Response:
    """GET with bounded retries for transient transport errors, 429 and 5xx only."""
    attempts = max(1, attempts)
    last_error: Exception | None = None

    for attempt in range(attempts):
        response: httpx.Response | None = None
        try:
            response = await client.get(url)
            if response.status_code < 400:
                return response
            if not retryable_status(response.status_code) or attempt == attempts - 1:
                response.raise_for_status()
            await asyncio.sleep(retry_delay_seconds(response, attempt, base_delay))
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = exc
            if attempt == attempts - 1:
                raise
            await asyncio.sleep(retry_delay_seconds(None, attempt, base_delay))

    if last_error:
        raise last_error
    raise RuntimeError("provider_retry_exhausted")
