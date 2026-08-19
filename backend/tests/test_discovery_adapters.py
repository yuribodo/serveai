from __future__ import annotations

import json
from uuid import UUID

import httpx
import pytest

from app.domain.models import Location, ServiceRequestData
from app.infrastructure.discovery.adapters import (
    GooglePlacesDiscovery,
    WebsiteContactResolver,
)

CONVERSATION_ID = UUID("8611a8f4-e6e9-4d9a-9ffc-d32ddc8e1723")


class StubContactResolver:
    def __init__(self) -> None:
        self.websites: list[str | None] = []

    async def resolve(self, website: str | None) -> str | None:
        self.websites.append(website)
        return "publico@chaveiro.example" if website else None


async def public_dns(_: str) -> list[str]:
    return ["8.8.8.8"]


@pytest.mark.asyncio
async def test_google_places_filters_ranks_normalizes_and_resolves_contact() -> None:
    captured_payloads: list[dict[str, object]] = []
    captured_field_masks: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_payloads.append(json.loads(request.content))
        captured_field_masks.append(request.headers["X-Goog-FieldMask"])
        return httpx.Response(
            200,
            json={
                "places": [
                    {
                        "id": "far-low-rated",
                        "displayName": {"text": "Chaveiro Distante"},
                        "formattedAddress": "Rua Distante, 1",
                        "location": {"latitude": -24.1, "longitude": -47.1},
                        "businessStatus": "OPERATIONAL",
                        "rating": 3.0,
                        "userRatingCount": 2,
                    },
                    {
                        "id": "best-nearby",
                        "displayName": {"text": "Chaveiro Bem Avaliado"},
                        "formattedAddress": "Rua dos Pinheiros, 10",
                        "location": {"latitude": -23.561, "longitude": -46.691},
                        "businessStatus": "OPERATIONAL",
                        "nationalPhoneNumber": "(11) 3000-0000",
                        "websiteUri": "https://chaveiro.example",
                        "rating": 4.9,
                        "userRatingCount": 1_000,
                    },
                    {
                        "id": "closed-provider",
                        "displayName": {"text": "Chaveiro Fechado"},
                        "formattedAddress": "Rua Fechada, 5",
                        "businessStatus": "CLOSED_PERMANENTLY",
                        "rating": 5.0,
                        "userRatingCount": 5_000,
                    },
                ]
            },
        )

    resolver = StubContactResolver()
    request = ServiceRequestData(
        service_type="chaveiro",
        location=Location(
            neighborhood="Pinheiros",
            city="São Paulo",
            latitude=-23.56,
            longitude=-46.69,
        ),
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        discovery = GooglePlacesDiscovery(
            api_key="places-test-key",
            http_client=client,
            contact_resolver=resolver,
            contact_resolution_limit=1,
        )
        providers = await discovery.search(CONVERSATION_ID, request, limit=25)
        repeated = await discovery.search(CONVERSATION_ID, request, limit=25)

    assert [provider.external_id for provider in providers] == ["best-nearby", "far-low-rated"]
    assert [provider.rank for provider in providers] == [1, 2]
    assert providers[0].email == "publico@chaveiro.example"
    assert providers[0].id == repeated[0].id
    assert resolver.websites == ["https://chaveiro.example", "https://chaveiro.example"]
    assert captured_payloads[0]["textQuery"] == "chaveiro em Pinheiros, São Paulo"
    assert captured_payloads[0]["pageSize"] == 20
    assert captured_payloads[0]["locationBias"] == {
        "circle": {
            "center": {"latitude": -23.56, "longitude": -46.69},
            "radius": 12_000.0,
        }
    }
    assert "places.displayName" in captured_field_masks[0]
    assert "places.websiteUri" in captured_field_masks[0]


@pytest.mark.asyncio
async def test_website_resolver_checks_only_home_and_same_host_contact_page() -> None:
    requested_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_paths.append(request.url.path)
        if request.url.path == "/":
            return httpx.Response(
                200,
                headers={"content-type": "text/html; charset=utf-8"},
                text='<a href="/contato">Fale conosco</a>',
            )
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text='<a href="mailto:Orcamento%40Chaveiro.Example?subject=site">E-mail</a>',
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        resolver = WebsiteContactResolver(http_client=client, dns_resolver=public_dns)
        email = await resolver.resolve("https://chaveiro.example")
        private_email = await resolver.resolve("http://127.0.0.1/admin")

    assert email == "orcamento@chaveiro.example"
    assert private_email is None
    assert requested_paths == ["/", "/contato"]


@pytest.mark.asyncio
async def test_website_resolver_rejects_private_dns_and_nonstandard_ports() -> None:
    requested_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_urls.append(str(request.url))
        return httpx.Response(200, headers={"content-type": "text/html"}, text="ok")

    async def private_dns(_: str) -> list[str]:
        return ["127.0.0.1"]

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        resolver = WebsiteContactResolver(http_client=client, dns_resolver=private_dns)
        rebound = await resolver.resolve("http://127.0.0.1.nip.io/secret")
        unusual_port = await resolver.resolve("https://example.com:8443/secret")

    assert rebound is None
    assert unusual_port is None
    assert requested_urls == []
