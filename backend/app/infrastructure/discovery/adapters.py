from __future__ import annotations

import asyncio
import hashlib
import html
import ipaddress
import logging
import math
import re
import socket
from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Final, Protocol
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit
from uuid import UUID, uuid5

import httpx

from app.domain.models import ProviderCandidate, ServiceRequestData

logger = logging.getLogger(__name__)

GOOGLE_TEXT_SEARCH_URL: Final = "https://places.googleapis.com/v1/places:searchText"
GOOGLE_FIELD_MASK: Final = ",".join(
    (
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.businessStatus",
        "places.nationalPhoneNumber",
        "places.websiteUri",
        "places.rating",
        "places.userRatingCount",
    )
)


class ProviderDiscoveryError(RuntimeError):
    """Raised when provider discovery returns an unusable response."""


class ContactResolver(Protocol):
    async def resolve(self, website: str | None) -> str | None: ...


class GooglePlacesDiscovery:
    """Google Places Text Search (New) adapter with deterministic local ranking."""

    def __init__(
        self,
        *,
        api_key: str,
        timeout_seconds: float = 10.0,
        http_client: httpx.AsyncClient | None = None,
        contact_resolver: ContactResolver | None = None,
        contact_resolution_limit: int = 3,
    ) -> None:
        if not api_key.strip():
            raise ValueError("api_key must not be blank")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        self._api_key = api_key
        self._timeout = httpx.Timeout(timeout_seconds)
        self._client = http_client
        self._contact_resolver = contact_resolver or WebsiteContactResolver(
            timeout_seconds=min(timeout_seconds, 6.0),
            http_client=http_client,
        )
        self._contact_resolution_limit = max(0, contact_resolution_limit)

    async def search(
        self,
        conversation_id: UUID,
        request: ServiceRequestData,
        limit: int = 10,
    ) -> list[ProviderCandidate]:
        if limit <= 0:
            return []
        search_location = request.location.search_text if request.location else None
        if not request.service_type or not search_location:
            raise ValueError("service type and location are required for provider discovery")

        page_size = min(limit, 20)
        payload: dict[str, object] = {
            "textQuery": f"{request.service_type} em {search_location}",
            "pageSize": page_size,
            "languageCode": "pt-BR",
            "regionCode": "BR",
            "rankPreference": "RELEVANCE",
            "includePureServiceAreaBusinesses": True,
        }
        if (
            request.location
            and request.location.latitude is not None
            and request.location.longitude is not None
        ):
            payload["locationBias"] = {
                "circle": {
                    "center": {
                        "latitude": request.location.latitude,
                        "longitude": request.location.longitude,
                    },
                    "radius": 12_000.0,
                }
            }

        response = await self._post(payload)
        raw_places = _extract_places(response)
        candidates: list[tuple[ProviderCandidate, int]] = []
        for original_index, raw_place in enumerate(raw_places):
            candidate = _normalize_place(
                raw_place,
                conversation_id=conversation_id,
                fallback_location=search_location,
            )
            if candidate is None or candidate.business_status in {
                "CLOSED_PERMANENTLY",
                "CLOSED_TEMPORARILY",
            }:
                continue
            candidates.append((candidate, original_index))

        ranked = _rank_candidates(
            candidates,
            user_latitude=request.location.latitude if request.location else None,
            user_longitude=request.location.longitude if request.location else None,
        )[:page_size]
        return await self._resolve_public_emails(ranked)

    async def _post(self, payload: dict[str, object]) -> httpx.Response:
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self._api_key,
            "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
        }
        try:
            if self._client is not None:
                response = await self._client.post(
                    GOOGLE_TEXT_SEARCH_URL,
                    json=payload,
                    headers=headers,
                    timeout=self._timeout,
                )
            else:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    response = await client.post(
                        GOOGLE_TEXT_SEARCH_URL,
                        json=payload,
                        headers=headers,
                    )
        except httpx.HTTPError as exc:
            raise ProviderDiscoveryError("Google Places request failed") from exc

        if response.is_error:
            raise ProviderDiscoveryError(
                f"Google Places returned HTTP {response.status_code}"
            ) from None
        return response

    async def _resolve_public_emails(
        self,
        candidates: list[ProviderCandidate],
    ) -> list[ProviderCandidate]:
        resolution_count = min(len(candidates), self._contact_resolution_limit)
        if resolution_count == 0:
            return candidates

        results = await asyncio.gather(
            *(
                self._contact_resolver.resolve(provider.website)
                for provider in candidates[:resolution_count]
            ),
            return_exceptions=True,
        )
        resolved = list(candidates)
        for index, result in enumerate(results):
            if isinstance(result, str):
                resolved[index] = resolved[index].model_copy(update={"email": result})
            elif isinstance(result, BaseException):
                logger.debug(
                    "Public contact resolution failed: %s",
                    type(result).__name__,
                )
        return resolved


class DemoProviderDiscovery:
    """Offline, stable providers for local development and the controlled demo path."""

    async def search(
        self,
        conversation_id: UUID,
        request: ServiceRequestData,
        limit: int = 10,
    ) -> list[ProviderCandidate]:
        if limit <= 0:
            return []
        location = request.location.search_text if request.location else "São Paulo"
        service_type = (request.service_type or "serviço").casefold()
        if service_type == "chaveiro":
            names = ("Chaveiro Pinheiros", "Chaveiro Central", "Chaves Express")
        else:
            label = (request.service_type or "Serviço").strip().title()
            names = (f"{label} Local", f"{label} Central", f"{label} Express")

        ratings = ((4.8, 214), (4.7, 138), (4.6, 89))
        providers: list[ProviderCandidate] = []
        for index, name in enumerate(names, start=1):
            external_id = f"serveai-demo-provider-{index}"
            rating, reviews = ratings[index - 1]
            providers.append(
                ProviderCandidate(
                    id=uuid5(conversation_id, external_id),
                    conversation_id=conversation_id,
                    external_id=external_id,
                    name=name,
                    address=f"Prestador demonstrativo — {location}",
                    rating=rating,
                    review_count=reviews,
                    phone=f"+55119000000{index:02d}",
                    email=f"provider{index}@example.com",
                    business_status="OPERATIONAL",
                    rank=index,
                )
            )
        return providers[: min(limit, len(providers))]


class WebsiteContactResolver:
    """Find a public ``mailto:`` on a site's home or contact page.

    The resolver deliberately does not guess addresses, crawl beyond one same-host
    contact page, follow redirects, or inspect arbitrary page text.
    """

    def __init__(
        self,
        *,
        timeout_seconds: float = 6.0,
        http_client: httpx.AsyncClient | None = None,
        max_response_bytes: int = 256_000,
        dns_resolver: Callable[[str], Awaitable[Sequence[str]]] | None = None,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        if max_response_bytes <= 0:
            raise ValueError("max_response_bytes must be positive")
        self._timeout = httpx.Timeout(timeout_seconds)
        self._client = http_client
        self._max_response_bytes = max_response_bytes
        self._dns_resolver = dns_resolver or _resolve_host_addresses

    async def resolve(self, website: str | None) -> str | None:
        root = _normalize_public_url(website)
        if root is None:
            return None

        root_html = await self._fetch_html(root)
        if root_html is None:
            return None
        email = _first_mailto(root_html)
        if email:
            return email

        root_host = urlsplit(root).hostname
        contact_url = _first_contact_url(root_html, root, root_host)
        if contact_url is None:
            return None
        contact_html = await self._fetch_html(contact_url)
        return _first_mailto(contact_html) if contact_html else None

    async def _fetch_html(self, url: str) -> str | None:
        host = urlsplit(url).hostname
        if host is None or not await _host_resolves_public(host, self._dns_resolver):
            return None
        headers = {
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "ServeAI/0.1 (+public-contact-discovery)",
        }
        try:
            if self._client is not None:
                return await self._stream_html(self._client, url, headers)
            else:
                async with httpx.AsyncClient(
                    timeout=self._timeout,
                    follow_redirects=False,
                ) as client:
                    return await self._stream_html(client, url, headers)
        except httpx.HTTPError:
            return None

    async def _stream_html(
        self,
        client: httpx.AsyncClient,
        url: str,
        headers: dict[str, str],
    ) -> str | None:
        async with client.stream(
            "GET",
            url,
            headers=headers,
            timeout=self._timeout,
            follow_redirects=False,
        ) as response:
            content_type = response.headers.get("content-type", "").casefold()
            if response.is_error or response.is_redirect or "html" not in content_type:
                return None
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > self._max_response_bytes:
                    return None
            encoding = response.encoding or "utf-8"
            return bytes(body).decode(encoding, errors="replace")


def _extract_places(response: httpx.Response) -> list[Mapping[str, object]]:
    try:
        payload: object = response.json()
    except ValueError as exc:
        raise ProviderDiscoveryError("Google Places returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise ProviderDiscoveryError("Google Places returned an invalid response shape")
    raw_places = payload.get("places", [])
    if not isinstance(raw_places, list):
        raise ProviderDiscoveryError("Google Places returned an invalid places collection")
    return [place for place in raw_places if isinstance(place, dict)]


def _normalize_place(
    raw: Mapping[str, object],
    *,
    conversation_id: UUID,
    fallback_location: str,
) -> ProviderCandidate | None:
    display_name = raw.get("displayName")
    name = _mapping_text(display_name, "text")
    if not name:
        return None

    address = _string_or_none(raw.get("formattedAddress"))
    external_id = _string_or_none(raw.get("id")) or _stable_external_id(name, address)
    location = raw.get("location")
    latitude = _mapping_float(location, "latitude")
    longitude = _mapping_float(location, "longitude")
    return ProviderCandidate(
        id=uuid5(conversation_id, external_id),
        conversation_id=conversation_id,
        external_id=external_id,
        name=name,
        address=address or f"Atende na região de {fallback_location}",
        latitude=latitude,
        longitude=longitude,
        rating=_float_or_none(raw.get("rating")),
        review_count=_int_or_none(raw.get("userRatingCount")),
        phone=_string_or_none(raw.get("nationalPhoneNumber")),
        website=_string_or_none(raw.get("websiteUri")),
        business_status=_string_or_none(raw.get("businessStatus")),
    )


def _rank_candidates(
    indexed_candidates: list[tuple[ProviderCandidate, int]],
    *,
    user_latitude: float | None,
    user_longitude: float | None,
) -> list[ProviderCandidate]:
    total = max(len(indexed_candidates), 1)

    def score(item: tuple[ProviderCandidate, int]) -> tuple[float, str, str]:
        candidate, original_index = item
        relevance = 1.0 - (original_index / total)
        rating = min(max((candidate.rating or 0.0) / 5.0, 0.0), 1.0)
        review_quality = min(math.log10((candidate.review_count or 0) + 1) / 4.0, 1.0)
        contact_quality = (int(bool(candidate.phone)) + int(bool(candidate.website))) / 2.0
        operational = 1.0 if candidate.business_status == "OPERATIONAL" else 0.5
        distance_quality = 0.5
        if (
            user_latitude is not None
            and user_longitude is not None
            and candidate.latitude is not None
            and candidate.longitude is not None
        ):
            distance_km = _haversine_km(
                user_latitude,
                user_longitude,
                candidate.latitude,
                candidate.longitude,
            )
            distance_quality = 1.0 / (1.0 + distance_km / 5.0)

        weighted = (
            relevance * 0.35
            + rating * 0.25
            + review_quality * 0.15
            + contact_quality * 0.10
            + distance_quality * 0.10
            + operational * 0.05
        )
        return (-weighted, candidate.name.casefold(), candidate.external_id)

    ordered = sorted(indexed_candidates, key=score)
    return [
        candidate.model_copy(update={"rank": rank})
        for rank, (candidate, _) in enumerate(ordered, start=1)
    ]


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_km = 6_371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    haversine = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    return 2 * earth_radius_km * math.asin(math.sqrt(haversine))


def _stable_external_id(name: str, address: str | None) -> str:
    digest = hashlib.sha256(f"{name}|{address or ''}".encode()).hexdigest()[:24]
    return f"generated-{digest}"


def _mapping_text(value: object, key: str) -> str | None:
    return _string_or_none(value.get(key)) if isinstance(value, Mapping) else None


def _mapping_float(value: object, key: str) -> float | None:
    return _float_or_none(value.get(key)) if isinstance(value, Mapping) else None


def _string_or_none(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _float_or_none(value: object) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _int_or_none(value: object) -> int | None:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


_MAILTO_PATTERN: Final = re.compile(
    r"href\s*=\s*[\"']mailto:([^\"'#?]+)(?:\?[^\"']*)?[\"']",
    re.IGNORECASE,
)
_EMAIL_PATTERN: Final = re.compile(r"^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$", re.I)
_CONTACT_LINK_PATTERN: Final = re.compile(
    r"href\s*=\s*[\"']([^\"']*(?:contato|contact|fale-conosco|fale_conosco)[^\"']*)[\"']",
    re.IGNORECASE,
)


def _first_mailto(page_html: str) -> str | None:
    for match in _MAILTO_PATTERN.finditer(html.unescape(page_html)):
        for raw_candidate in re.split(r"[,;]", unquote(match.group(1))):
            candidate = raw_candidate.strip().casefold()
            if _EMAIL_PATTERN.fullmatch(candidate) and not candidate.startswith(
                ("noreply@", "no-reply@")
            ):
                return candidate
    return None


def _first_contact_url(page_html: str, root_url: str, root_host: str | None) -> str | None:
    for match in _CONTACT_LINK_PATTERN.finditer(html.unescape(page_html)):
        candidate = urljoin(root_url, match.group(1).strip())
        normalized = _normalize_public_url(candidate, expected_host=root_host)
        if normalized:
            return normalized
    return None


def _normalize_public_url(value: str | None, *, expected_host: str | None = None) -> str | None:
    if not value or not value.strip():
        return None
    raw = value.strip()
    if "://" not in raw:
        raw = f"https://{raw}"
    parsed = urlsplit(raw)
    host = parsed.hostname
    try:
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme not in {"http", "https"}
        or not host
        or parsed.username
        or parsed.password
        or port not in {None, 80, 443}
        or (expected_host is not None and host.casefold() != expected_host.casefold())
        or not _is_public_host(host)
    ):
        return None
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path or "/", parsed.query, ""))


def _is_public_host(host: str) -> bool:
    normalized = host.rstrip(".").casefold()
    if normalized == "localhost" or normalized.endswith((".localhost", ".local", ".internal")):
        return False
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        return True
    return address.is_global


async def _resolve_host_addresses(host: str) -> Sequence[str]:
    loop = asyncio.get_running_loop()
    records = await loop.getaddrinfo(
        host,
        None,
        family=socket.AF_UNSPEC,
        type=socket.SOCK_STREAM,
    )
    return tuple({str(record[4][0]).split("%", 1)[0] for record in records})


async def _host_resolves_public(
    host: str,
    resolver: Callable[[str], Awaitable[Sequence[str]]],
) -> bool:
    if not _is_public_host(host):
        return False
    try:
        addresses = await resolver(host)
    except (OSError, ValueError):
        return False
    if not addresses:
        return False
    try:
        return all(ipaddress.ip_address(address).is_global for address in addresses)
    except ValueError:
        return False


__all__ = [
    "ContactResolver",
    "DemoProviderDiscovery",
    "GooglePlacesDiscovery",
    "ProviderDiscoveryError",
    "WebsiteContactResolver",
]
