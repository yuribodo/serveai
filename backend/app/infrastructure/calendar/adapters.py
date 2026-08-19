from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Callable, Mapping
from datetime import datetime
from threading import RLock
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build  # type: ignore[import-untyped]
from googleapiclient.errors import HttpError  # type: ignore[import-untyped]

from app.domain.models import Booking, ProviderCandidate

CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events"
GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"


class CalendarConfigurationError(ValueError):
    """Raised when a calendar adapter is missing required configuration."""


class CalendarOperationError(RuntimeError):
    """Raised when an event cannot be created or recovered."""


def _required(value: str, name: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise CalendarConfigurationError(f"{name} must not be empty")
    return normalized


def _event_id(conversation_id: UUID, offer_id: UUID) -> str:
    seed = f"serveai:{conversation_id.hex}:{offer_id.hex}".encode()
    # Hexadecimal is a subset of the base32hex alphabet required by Calendar event IDs.
    return f"serveai{hashlib.sha256(seed).hexdigest()}"


def _booking_id(conversation_id: UUID, offer_id: UUID) -> UUID:
    return uuid5(NAMESPACE_URL, f"serveai:booking:{conversation_id}:{offer_id}")


def _require_period(start: datetime, end: datetime) -> None:
    if start.tzinfo is None or start.utcoffset() is None:
        raise CalendarOperationError("Booking start must include a timezone")
    if end.tzinfo is None or end.utcoffset() is None:
        raise CalendarOperationError("Booking end must include a timezone")
    if start >= end:
        raise CalendarOperationError("Booking start must precede booking end")


def _http_status(error: HttpError) -> int | None:
    response = getattr(error, "resp", None)
    status = getattr(response, "status", None)
    return status if isinstance(status, int) else None


class GoogleCalendarGateway:
    """Create idempotent appointments with OAuth refresh credentials."""

    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        refresh_token: str,
        calendar_id: str,
        timezone: str = "America/Sao_Paulo",
        service_factory: Callable[[], Any] | None = None,
    ) -> None:
        self._client_id = _required(client_id, "client_id")
        self._client_secret = _required(client_secret, "client_secret")
        self._refresh_token = _required(refresh_token, "refresh_token")
        # Calendar ID is deliberately mandatory: secondary-calendar writes must be explicit.
        self._calendar_id = _required(calendar_id, "calendar_id")
        self._timezone = _required(timezone, "timezone")
        try:
            self._timezone_info = ZoneInfo(self._timezone)
        except ZoneInfoNotFoundError as exc:
            raise CalendarConfigurationError(f"Unknown calendar timezone: {timezone}") from exc
        self._service_factory = service_factory

    def _new_service(self) -> Any:
        if self._service_factory is not None:
            return self._service_factory()

        credentials = Credentials(  # type: ignore[no-untyped-call]
            token=None,
            refresh_token=self._refresh_token,
            token_uri=GOOGLE_TOKEN_URI,
            client_id=self._client_id,
            client_secret=self._client_secret,
            scopes=[CALENDAR_EVENTS_SCOPE],
        )
        return build(
            "calendar",
            "v3",
            credentials=credentials,
            cache_discovery=False,
        )

    def _create_or_get_event(self, event: dict[str, object]) -> Mapping[str, object]:
        service = self._new_service()
        event_id = str(event["id"])
        send_updates = "all" if event["attendees"] else "none"

        try:
            result = (
                service.events()
                .insert(
                    calendarId=self._calendar_id,
                    body=event,
                    sendUpdates=send_updates,
                )
                .execute()
            )
        except HttpError as exc:
            if _http_status(exc) != 409:
                raise CalendarOperationError("Google Calendar rejected the appointment") from exc
            try:
                result = (
                    service.events().get(calendarId=self._calendar_id, eventId=event_id).execute()
                )
            except HttpError as get_exc:
                raise CalendarOperationError(
                    "Google Calendar could not recover the existing appointment"
                ) from get_exc

        if not isinstance(result, Mapping):
            raise CalendarOperationError("Google Calendar returned an invalid event response")
        return result

    async def create_booking(
        self,
        *,
        conversation_id: UUID,
        provider: ProviderCandidate,
        offer_id: UUID,
        start: datetime,
        end: datetime,
        price: float,
        address: str,
        attendee_email: str | None,
        now: datetime,
    ) -> Booking:
        _require_period(start, end)
        if price < 0:
            raise CalendarOperationError("Booking price cannot be negative")
        normalized_address = address.strip()
        if not normalized_address:
            raise CalendarOperationError("Booking address must not be empty")

        event_id = _event_id(conversation_id, offer_id)
        attendees = (
            [{"email": attendee_email.strip()}]
            if attendee_email is not None and attendee_email.strip()
            else []
        )
        local_start = start.astimezone(self._timezone_info)
        local_end = end.astimezone(self._timezone_info)
        event: dict[str, object] = {
            "id": event_id,
            "summary": f"ServeAI — {provider.name}",
            "description": "\n".join(
                (
                    "Agendamento criado pela ServeAI.",
                    f"Prestador: {provider.name}",
                    f"Valor combinado: R$ {price:.2f}",
                    f"Solicitação: {conversation_id}",
                    f"Oferta: {offer_id}",
                )
            ),
            "location": normalized_address,
            "start": {
                "dateTime": local_start.isoformat(),
                "timeZone": self._timezone,
            },
            "end": {
                "dateTime": local_end.isoformat(),
                "timeZone": self._timezone,
            },
            "attendees": attendees,
            "transparency": "opaque",
            "guestsCanInviteOthers": False,
            "guestsCanModify": False,
            "reminders": {
                "useDefault": False,
                "overrides": [{"method": "popup", "minutes": 60}],
            },
            "extendedProperties": {
                "private": {
                    "serveaiConversationId": str(conversation_id),
                    "serveaiProviderId": str(provider.id),
                    "serveaiOfferId": str(offer_id),
                }
            },
        }

        try:
            result = await asyncio.to_thread(self._create_or_get_event, event)
        except CalendarOperationError:
            raise
        except Exception as exc:
            raise CalendarOperationError(
                "Google Calendar could not create the appointment"
            ) from exc

        returned_id = result.get("id")
        calendar_event_id = returned_id if isinstance(returned_id, str) else event_id
        returned_url = result.get("htmlLink")
        calendar_event_url = returned_url if isinstance(returned_url, str) else None
        return Booking(
            id=_booking_id(conversation_id, offer_id),
            conversation_id=conversation_id,
            provider_id=provider.id,
            offer_id=offer_id,
            start=start,
            end=end,
            price=price,
            calendar_event_id=calendar_event_id,
            calendar_event_url=calendar_event_url,
            created_at=now,
        )


class DemoCalendarGateway:
    """In-memory idempotent calendar used when Google OAuth is not configured."""

    def __init__(self) -> None:
        self._bookings: dict[str, Booking] = {}
        self._lock = RLock()

    async def create_booking(
        self,
        *,
        conversation_id: UUID,
        provider: ProviderCandidate,
        offer_id: UUID,
        start: datetime,
        end: datetime,
        price: float,
        address: str,
        attendee_email: str | None,
        now: datetime,
    ) -> Booking:
        del attendee_email
        _require_period(start, end)
        if price < 0:
            raise CalendarOperationError("Booking price cannot be negative")
        if not address.strip():
            raise CalendarOperationError("Booking address must not be empty")

        event_id = _event_id(conversation_id, offer_id)
        with self._lock:
            existing = self._bookings.get(event_id)
            if existing is not None:
                return existing

            booking = Booking(
                id=_booking_id(conversation_id, offer_id),
                conversation_id=conversation_id,
                provider_id=provider.id,
                offer_id=offer_id,
                start=start,
                end=end,
                price=price,
                calendar_event_id=event_id,
                calendar_event_url=None,
                created_at=now,
            )
            self._bookings[event_id] = booking
            return booking
