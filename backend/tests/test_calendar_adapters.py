from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from googleapiclient.errors import HttpError

from app.domain.models import Booking, ProviderCandidate
from app.infrastructure.calendar.adapters import GoogleCalendarGateway

CONVERSATION_ID = UUID("921d5f3e-a642-4f75-bcff-ac9afead3f5d")
PROVIDER_ID = UUID("38aa0525-5465-4e6f-9220-2d1d0b2afe9b")
OFFER_ID = UUID("5cc93cce-ef27-46c4-a138-2f63c6c66818")
NOW = datetime(2026, 8, 19, 10, tzinfo=ZoneInfo("America/Sao_Paulo"))


@dataclass
class FakeHTTPResponse:
    status: int = 409
    reason: str = "Conflict"


class FakeExecutable:
    def __init__(self, result: object = None, error: Exception | None = None) -> None:
        self._result = result
        self._error = error

    def execute(self) -> object:
        if self._error:
            raise self._error
        return self._result


class FakeEventsResource:
    def __init__(self, *, conflict: bool = False) -> None:
        self.conflict = conflict
        self.insert_calls: list[dict[str, object]] = []
        self.get_calls: list[dict[str, str]] = []

    def insert(self, **kwargs: object) -> FakeExecutable:
        self.insert_calls.append(kwargs)
        body = kwargs["body"]
        assert isinstance(body, dict)
        if self.conflict:
            return FakeExecutable(error=HttpError(FakeHTTPResponse(), b"{}"))
        return FakeExecutable(result={"id": body["id"], "htmlLink": "https://calendar.test/event"})

    def get(self, **kwargs: str) -> FakeExecutable:
        self.get_calls.append(kwargs)
        return FakeExecutable(
            result={"id": kwargs["eventId"], "htmlLink": "https://calendar.test/existing"}
        )


class FakeCalendarService:
    def __init__(self, events: FakeEventsResource) -> None:
        self._events = events

    def events(self) -> FakeEventsResource:
        return self._events


def _provider() -> ProviderCandidate:
    return ProviderCandidate(
        id=PROVIDER_ID,
        conversation_id=CONVERSATION_ID,
        external_id="google-place-1",
        name="Chaveiro Pinheiros",
        address="Rua dos Pinheiros, 100",
    )


def _gateway(events: FakeEventsResource) -> GoogleCalendarGateway:
    service = FakeCalendarService(events)
    return GoogleCalendarGateway(
        client_id="client-id",
        client_secret="client-secret",
        refresh_token="refresh-token",
        calendar_id="serveai-demo@group.calendar.google.com",
        service_factory=lambda: service,
    )


async def _create_booking(gateway: GoogleCalendarGateway) -> Booking:
    return await gateway.create_booking(
        conversation_id=CONVERSATION_ID,
        provider=_provider(),
        offer_id=OFFER_ID,
        start=datetime(2026, 8, 19, 18, 30, tzinfo=UTC),
        end=datetime(2026, 8, 19, 19, 30, tzinfo=UTC),
        price=180,
        address=" Rua dos Pinheiros, 100 ",
        attendee_email=" controlled-inbox@example.com ",
        now=NOW,
    )


@pytest.mark.asyncio
async def test_google_calendar_uses_stable_event_id_and_complete_payload() -> None:
    events = FakeEventsResource()
    gateway = _gateway(events)

    first = await _create_booking(gateway)
    repeated = await _create_booking(gateway)

    assert first.id == repeated.id
    assert first.calendar_event_id == repeated.calendar_event_id
    assert len(events.insert_calls) == 2
    first_call, second_call = events.insert_calls
    assert first_call["calendarId"] == "serveai-demo@group.calendar.google.com"
    assert first_call["sendUpdates"] == "all"
    assert first_call["body"] == second_call["body"]
    body = first_call["body"]
    assert isinstance(body, dict)
    assert body["id"] == first.calendar_event_id
    assert body["summary"] == "ServeAI — Chaveiro Pinheiros"
    assert body["location"] == "Rua dos Pinheiros, 100"
    assert body["start"] == {
        "dateTime": "2026-08-19T15:30:00-03:00",
        "timeZone": "America/Sao_Paulo",
    }
    assert body["end"] == {
        "dateTime": "2026-08-19T16:30:00-03:00",
        "timeZone": "America/Sao_Paulo",
    }
    assert body["attendees"] == [{"email": "controlled-inbox@example.com"}]
    assert body["extendedProperties"] == {
        "private": {
            "serveaiConversationId": str(CONVERSATION_ID),
            "serveaiProviderId": str(PROVIDER_ID),
            "serveaiOfferId": str(OFFER_ID),
        }
    }


@pytest.mark.asyncio
async def test_google_calendar_recovers_existing_event_after_conflict() -> None:
    events = FakeEventsResource(conflict=True)

    booking = await _create_booking(_gateway(events))

    assert len(events.insert_calls) == 1
    assert events.get_calls == [
        {
            "calendarId": "serveai-demo@group.calendar.google.com",
            "eventId": booking.calendar_event_id,
        }
    ]
    assert booking.calendar_event_url == "https://calendar.test/existing"
