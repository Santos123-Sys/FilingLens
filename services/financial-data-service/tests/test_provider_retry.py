import asyncio

import httpx
import pytest

from app.providers.http_retry import get_with_retry, retry_delay_seconds, retryable_status


def test_retries_transient_503_then_succeeds():
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] == 1:
            return httpx.Response(503, request=request)
        return httpx.Response(200, json={"ok": True}, request=request)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            response = await get_with_retry(client, "https://example.test/data", attempts=3, base_delay=0)
            return response

    response = asyncio.run(run())
    assert response.status_code == 200
    assert calls["count"] == 2


def test_does_not_retry_nonretryable_404():
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(404, request=request)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await get_with_retry(client, "https://example.test/missing", attempts=3, base_delay=0)

    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(run())
    assert calls["count"] == 1


def test_retries_transport_failure_then_succeeds():
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] == 1:
            raise httpx.ConnectError("temporary", request=request)
        return httpx.Response(200, content=b"ok", request=request)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await get_with_retry(client, "https://example.test/data", attempts=3, base_delay=0)

    response = asyncio.run(run())
    assert response.text == "ok"
    assert calls["count"] == 2


def test_retry_after_is_bounded():
    request = httpx.Request("GET", "https://example.test/data")
    response = httpx.Response(429, headers={"Retry-After": "999"}, request=request)
    assert retry_delay_seconds(response, 0) == 5.0


def test_retryable_status_policy_is_explicit():
    assert retryable_status(429)
    assert retryable_status(503)
    assert not retryable_status(404)
    assert not retryable_status(422)
