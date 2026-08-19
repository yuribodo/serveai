from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

import httpx
import pytest
from svix.webhooks import Webhook

from app.domain.models import (
    AvailabilityWindow,
    Budget,
    Location,
    ProviderCandidate,
    ServiceRequestData,
)
from app.infrastructure.contact.adapters import (
    ContactDeliveryError,
    InvalidWebhookError,
    ResendEmailChannel,
)

CONVERSATION_ID = UUID("99b6f159-3e3d-4de5-a354-b1715bb2473b")
PROVIDER_ID = UUID("836b69fc-41b6-4718-8e85-bd639e0778c3")
NOW = datetime(2026, 8, 19, 10, tzinfo=ZoneInfo("America/Sao_Paulo"))
WEBHOOK_SECRET = "whsec_dGVzdHNlY3JldA=="


def _provider() -> ProviderCandidate:
    return ProviderCandidate(
        id=PROVIDER_ID,
        conversation_id=CONVERSATION_ID,
        external_id="google-place-1",
        name="Chaveiro Pinheiros",
        address="Rua dos Pinheiros, 10",
        email="real-provider@example.com",
    )


def _service_request() -> ServiceRequestData:
    return ServiceRequestData(
        service_type="chaveiro",
        problem=(
            "Perdi a chave na Rua dos Pinheiros, 100, apartamento 12 e estou trancado para fora"
        ),
        location=Location(
            address="Rua dos Pinheiros, 100, apartamento 12",
            neighborhood="Pinheiros",
            city="São Paulo",
        ),
        budget=Budget(minimum=100, maximum=200),
        availability=[
            AvailabilityWindow(
                start=NOW.replace(hour=14),
                end=NOW.replace(hour=18),
            )
        ],
    )


@pytest.mark.asyncio
async def test_resend_outreach_uses_controlled_destination_and_stable_retry_key() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"id": "resend-message-1"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        channel = ResendEmailChannel(
            api_key="re_test",
            webhook_secret=WEBHOOK_SECRET,
            inbound_domain="inbound.serveai.example",
            destination_override="controlled-inbox@example.com",
            client=client,
        )
        outreach = await channel.send_outreach(_provider(), _service_request(), NOW)

    assert len(requests) == 1
    sent = requests[0]
    payload = json.loads(sent.content)
    assert sent.headers["Authorization"] == "Bearer re_test"
    assert sent.headers["Idempotency-Key"] == (
        f"serveai-outreach/{CONVERSATION_ID.hex}/{PROVIDER_ID.hex}"
    )
    assert payload["to"] == ["controlled-inbox@example.com"]
    assert payload["reply_to"] == f"offer+{PROVIDER_ID.hex}@inbound.serveai.example"
    assert payload["tags"] == [
        {"name": "conversation_id", "value": CONVERSATION_ID.hex},
        {"name": "provider_id", "value": PROVIDER_ID.hex},
    ]
    assert "Local: Pinheiros, São Paulo" in payload["text"]
    assert "Rua dos Pinheiros" not in payload["text"]
    assert "apartamento 12" not in payload["text"]
    assert "Orçamento máximo: R$ 200,00" in payload["text"]
    assert outreach.destination == "controlled-inbox@example.com"
    assert outreach.reply_to == payload["reply_to"]
    assert outreach.external_message_id == "resend-message-1"


@pytest.mark.asyncio
async def test_resend_webhook_accepts_valid_svix_signature_and_rejects_invalid_one() -> None:
    payload = b'{"type":"email.received","data":{"email_id":"inbound-1"}}'
    message_id = "msg_serveai_test"
    signed_at = datetime.now(UTC)
    signature = Webhook(WEBHOOK_SECRET).sign(message_id, signed_at, payload.decode())
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(500))
    ) as client:
        channel = ResendEmailChannel(
            api_key="re_test",
            webhook_secret=WEBHOOK_SECRET,
            inbound_domain="inbound.serveai.example",
            client=client,
        )
        verified = channel.verify_webhook(
            payload,
            {
                "Svix-Id": message_id,
                "Svix-Timestamp": str(int(signed_at.timestamp())),
                "Svix-Signature": signature,
            },
        )
        assert verified["type"] == "email.received"
        assert verified["data"] == {"email_id": "inbound-1"}

        with pytest.raises(InvalidWebhookError, match="Invalid Resend webhook signature"):
            channel.verify_webhook(
                payload,
                {
                    "svix-id": message_id,
                    "svix-timestamp": str(int(signed_at.timestamp())),
                    "svix-signature": "v1,invalid",
                },
            )


@pytest.mark.asyncio
async def test_resend_inbound_html_is_converted_to_readable_text() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.raw_path == b"/emails/receiving/inbound%2Fwith%20spaces"
        return httpx.Response(
            200,
            json={"html": "<p>Consigo às <strong>15:30</strong>.</p><p>Fica R$ 180.</p>"},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        channel = ResendEmailChannel(
            api_key="re_test",
            webhook_secret=WEBHOOK_SECRET,
            inbound_domain="inbound.serveai.example",
            client=client,
        )
        text = await channel.fetch_inbound_text("inbound/with spaces")

    assert text == "Consigo às\n15:30\n.\nFica R$ 180."


@pytest.mark.asyncio
async def test_resend_inbound_drops_quoted_thread_and_rejects_oversized_response() -> None:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(
                200,
                json={
                    "text": (
                        "Consigo hoje às 15h por R$ 180.\n\n"
                        "Em quarta-feira, ServeAI escreveu:\n" + "conteúdo citado" * 500
                    )
                },
            )
        return httpx.Response(200, content=b"{" + b"x" * 600_000 + b"}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        channel = ResendEmailChannel(
            api_key="re_test",
            webhook_secret=WEBHOOK_SECRET,
            inbound_domain="inbound.serveai.example",
            client=client,
        )
        text = await channel.fetch_inbound_text("small-reply")
        with pytest.raises(ContactDeliveryError, match="too large"):
            await channel.fetch_inbound_text("oversized-reply")

    assert text == "Consigo hoje às 15h por R$ 180."
