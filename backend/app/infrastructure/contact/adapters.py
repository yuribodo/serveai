from __future__ import annotations

import json
import re
from collections.abc import Mapping
from datetime import datetime
from html import unescape
from html.parser import HTMLParser
from threading import RLock
from typing import Any, cast
from urllib.parse import quote

import httpx
from svix.webhooks import Webhook

from app.domain.models import Outreach, ProviderCandidate, ServiceRequestData

RESEND_API_BASE_URL = "https://api.resend.com"
MAX_INBOUND_RESPONSE_BYTES = 512_000
MAX_INBOUND_TEXT_CHARS = 12_000
_QUOTED_REPLY_PATTERN = re.compile(
    r"(?:\r?\n){1,2}(?:"
    r"On .+ wrote:|"
    r"Em .+ escreveu:|"
    r"-{2,}\s*(?:Original Message|Mensagem original)\s*-{2,}|"
    r"(?:From|De):\s.+"
    r")",
    flags=re.IGNORECASE,
)


class ContactConfigurationError(ValueError):
    """Raised when a contact adapter is missing required configuration."""


class ContactDeliveryError(RuntimeError):
    """Raised when a contact provider cannot send or retrieve a message."""


class InvalidWebhookError(ValueError):
    """Raised when a contact webhook is malformed or fails verification."""


class _HTMLTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._quoted_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if tag.casefold() == "blockquote":
            self._quoted_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() == "blockquote" and self._quoted_depth:
            self._quoted_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._quoted_depth:
            return
        value = data.strip()
        if value:
            self.parts.append(value)


def _html_to_text(value: str) -> str:
    parser = _HTMLTextExtractor()
    parser.feed(value)
    parser.close()
    return unescape("\n".join(parser.parts)).strip()


def _clean_inbound_text(value: str) -> str:
    normalized = value.replace("\x00", "").strip()
    unquoted = _QUOTED_REPLY_PATTERN.split(normalized, maxsplit=1)[0].strip()
    return unquoted[:MAX_INBOUND_TEXT_CHARS].strip()


def _required(value: str, name: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ContactConfigurationError(f"{name} must not be empty")
    return normalized


def _inbound_domain(value: str) -> str:
    normalized = _required(value, "inbound_domain").lower().strip(".")
    if "@" in normalized or "://" in normalized or "/" in normalized:
        raise ContactConfigurationError("inbound_domain must be a bare email domain")
    return normalized


def _reply_to(provider_id: object, inbound_domain: str) -> str:
    provider_hex = getattr(provider_id, "hex", str(provider_id).replace("-", ""))
    return f"offer+{provider_hex}@{inbound_domain}"


def _format_money(value: float | None) -> str:
    if value is None:
        return "não informado"
    formatted = f"{value:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return f"R$ {formatted}"


def _format_outreach(provider: ProviderCandidate, request: ServiceRequestData) -> str:
    location = _outreach_location(request)
    problem = _outreach_problem(request)
    maximum = request.budget.maximum if request.budget else None
    windows = [
        f"{window.start:%d/%m/%Y às %H:%M} - {window.end:%H:%M}" for window in request.availability
    ]
    availability = "; ".join(windows) or "a combinar"

    return "\n".join(
        (
            f"Olá, {provider.name}!",
            "",
            "A ServeAI está buscando um prestador para esta solicitação:",
            f"Serviço: {request.service_type or 'não informado'}",
            f"Descrição: {problem or 'não informada'}",
            f"Local: {location or 'não informado'}",
            f"Orçamento máximo: {_format_money(maximum)}",
            f"Disponibilidade: {availability}",
            "",
            "Você poderia responder este e-mail informando disponibilidade e preço?",
        )
    )


def _outreach_location(request: ServiceRequestData) -> str | None:
    """Return a useful service region without exposing a residential address."""

    location = request.location
    if location is None:
        return None
    region = ", ".join(
        value.strip() for value in (location.neighborhood, location.city) if value and value.strip()
    )
    if region:
        return region
    if location.address and not any(character.isdigit() for character in location.address):
        return location.address.strip()
    if location.latitude is not None and location.longitude is not None:
        return "região aproximada informada"
    return "região informada pelo cliente"


def _outreach_problem(request: ServiceRequestData) -> str | None:
    """Remove a known exact address if it was repeated in the problem text."""

    problem = request.problem
    exact_address = request.exact_address
    if not problem or not exact_address:
        return problem
    sanitized = re.sub(re.escape(exact_address), "[endereço omitido]", problem, flags=re.IGNORECASE)
    return sanitized.strip()


class ResendEmailChannel:
    """Contact providers through Resend's HTTP and Receiving APIs."""

    def __init__(
        self,
        *,
        api_key: str,
        webhook_secret: str,
        inbound_domain: str,
        from_email: str = "ServeAI <onboarding@resend.dev>",
        destination_override: str | None = None,
        timeout_seconds: float = 10.0,
        client: httpx.AsyncClient | None = None,
        base_url: str = RESEND_API_BASE_URL,
    ) -> None:
        if timeout_seconds <= 0:
            raise ContactConfigurationError("timeout_seconds must be greater than zero")

        self._api_key = _required(api_key, "api_key")
        self._from_email = _required(from_email, "from_email")
        self._inbound_domain = _inbound_domain(inbound_domain)
        self._destination_override = (
            _required(destination_override, "destination_override")
            if destination_override is not None
            else None
        )
        self._base_url = _required(base_url, "base_url").rstrip("/")
        self._webhook = Webhook(_required(webhook_secret, "webhook_secret"))
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(timeout_seconds))
        self._owns_client = client is None

    async def __aenter__(self) -> ResendEmailChannel:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    async def send_outreach(
        self,
        provider: ProviderCandidate,
        request: ServiceRequestData,
        now: datetime,
    ) -> Outreach:
        destination = self._destination_override or provider.email
        if not destination:
            raise ContactDeliveryError(f"Provider {provider.id} does not have a contact email")

        reply_to = _reply_to(provider.id, self._inbound_domain)
        payload: dict[str, object] = {
            "from": self._from_email,
            "to": [destination],
            "reply_to": reply_to,
            "subject": f"Solicitação ServeAI — {request.service_type or 'serviço local'}",
            "text": _format_outreach(provider, request),
            "tags": [
                {"name": "conversation_id", "value": provider.conversation_id.hex},
                {"name": "provider_id", "value": provider.id.hex},
            ],
        }

        try:
            headers = {
                **self._headers,
                "Idempotency-Key": (
                    f"serveai-outreach/{provider.conversation_id.hex}/{provider.id.hex}"
                ),
            }
            response = await self._client.post(
                f"{self._base_url}/emails",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            result = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ContactDeliveryError("Resend could not send the outreach email") from exc

        if not isinstance(result, Mapping) or not isinstance(result.get("id"), str):
            raise ContactDeliveryError("Resend returned an invalid send response")

        return Outreach(
            conversation_id=provider.conversation_id,
            provider_id=provider.id,
            destination=destination,
            reply_to=reply_to,
            external_message_id=result["id"],
            created_at=now,
        )

    def verify_webhook(
        self,
        payload: bytes,
        headers: dict[str, str],
    ) -> dict[str, object]:
        normalized_headers = {key.lower(): value for key, value in headers.items()}
        try:
            verified = self._webhook.verify(payload, normalized_headers)
        except Exception as exc:
            raise InvalidWebhookError("Invalid Resend webhook signature") from exc

        if not isinstance(verified, Mapping):
            raise InvalidWebhookError("Verified Resend webhook is not an object")
        return {str(key): cast(object, value) for key, value in verified.items()}

    async def fetch_inbound_text(self, email_id: str) -> str:
        normalized_id = _required(email_id, "email_id")
        try:
            async with self._client.stream(
                "GET",
                f"{self._base_url}/emails/receiving/{quote(normalized_id, safe='')}",
                headers=self._headers,
            ) as response:
                response.raise_for_status()
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_INBOUND_RESPONSE_BYTES:
                        raise ContactDeliveryError("Inbound email response is too large")
                result = json.loads(body)
        except ContactDeliveryError:
            raise
        except (httpx.HTTPError, ValueError, UnicodeDecodeError) as exc:
            raise ContactDeliveryError("Resend could not retrieve the inbound email") from exc

        if not isinstance(result, Mapping):
            raise ContactDeliveryError("Resend returned an invalid inbound email response")

        plain_text = result.get("text")
        if isinstance(plain_text, str) and plain_text.strip():
            text = _clean_inbound_text(plain_text)
            if text:
                return text

        html = result.get("html")
        if isinstance(html, str) and html.strip():
            text = _clean_inbound_text(_html_to_text(html))
            if text:
                return text

        raise ContactDeliveryError("Inbound email does not contain a readable body")


class DemoEmailChannel:
    """Deterministic, network-free email adapter for local demos and tests."""

    def __init__(
        self,
        *,
        destination_override: str = "demo-provider@serveai.local",
        inbound_domain: str = "inbound.serveai.local",
    ) -> None:
        self._destination_override = _required(destination_override, "destination_override")
        self._inbound_domain = _inbound_domain(inbound_domain)
        self._inbound_messages: dict[str, str] = {}
        self._lock = RLock()

    async def send_outreach(
        self,
        provider: ProviderCandidate,
        request: ServiceRequestData,
        now: datetime,
    ) -> Outreach:
        del request
        return Outreach(
            conversation_id=provider.conversation_id,
            provider_id=provider.id,
            destination=self._destination_override,
            reply_to=_reply_to(provider.id, self._inbound_domain),
            external_message_id=f"demo-{provider.id.hex}",
            created_at=now,
        )

    def verify_webhook(
        self,
        payload: bytes,
        headers: dict[str, str],
    ) -> dict[str, object]:
        del headers
        try:
            parsed: Any = json.loads(payload)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise InvalidWebhookError("Demo webhook body must be valid JSON") from exc

        if not isinstance(parsed, dict) or parsed.get("type") != "email.received":
            raise InvalidWebhookError("Demo webhook must be an email.received event")

        data = parsed.get("data")
        if not isinstance(data, dict):
            raise InvalidWebhookError("Demo webhook must include a data object")

        email_id = data.get("email_id")
        if not isinstance(email_id, str) or not email_id.strip():
            raise InvalidWebhookError("Demo webhook must include data.email_id")

        body = data.get("text")
        if body is not None and not isinstance(body, str):
            raise InvalidWebhookError("Demo webhook data.text must be a string")
        if isinstance(body, str):
            with self._lock:
                self._inbound_messages[email_id] = body

        return cast(dict[str, object], parsed)

    async def fetch_inbound_text(self, email_id: str) -> str:
        normalized_id = _required(email_id, "email_id")
        with self._lock:
            body = self._inbound_messages.get(normalized_id)
        if body is None:
            raise ContactDeliveryError(f"Demo inbound email {normalized_id!r} was not registered")
        return body
