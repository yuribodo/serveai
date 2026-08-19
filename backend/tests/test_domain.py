from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.domain.aggregate import ConversationAggregate
from app.domain.models import (
    AvailabilityWindow,
    Budget,
    OfferStatus,
    ProviderOffer,
    RequestStatus,
    ServiceRequestData,
)
from app.domain.rules import InvalidStateTransition, evaluate_offer, transition

NOW = datetime(2026, 8, 19, 10, tzinfo=ZoneInfo("America/Sao_Paulo"))


def test_offer_must_match_budget_and_availability() -> None:
    request = ServiceRequestData(
        budget=Budget(maximum=200),
        availability=[AvailabilityWindow(start=NOW, end=NOW + timedelta(hours=4))],
    )
    compatible = ProviderOffer(
        conversation_id="40ab527d-2d9e-478a-844f-d13aa08659f9",
        provider_id="cfb8bb46-a4b6-4b57-a002-3f78fb3f540a",
        inbound_message_id="email-1",
        status=OfferStatus.AVAILABLE,
        price=180,
        available_at=NOW + timedelta(hours=1),
        raw_text="Posso por R$ 180",
        created_at=NOW,
    )
    expensive = compatible.model_copy(update={"price": 230})

    assert evaluate_offer(request, compatible).acceptable is True
    assert evaluate_offer(request, expensive).acceptable is False


def test_offer_must_fit_the_full_booking_inside_availability() -> None:
    request = ServiceRequestData(
        budget=Budget(maximum=200),
        availability=[AvailabilityWindow(start=NOW, end=NOW + timedelta(hours=4))],
    )
    offer = ProviderOffer(
        conversation_id="40ab527d-2d9e-478a-844f-d13aa08659f9",
        provider_id="cfb8bb46-a4b6-4b57-a002-3f78fb3f540a",
        inbound_message_id="email-at-window-end",
        status=OfferStatus.AVAILABLE,
        price=180,
        available_at=NOW + timedelta(hours=4),
        raw_text="Posso no fim da janela por R$ 180",
        created_at=NOW,
    )

    assert evaluate_offer(request, offer).within_availability is False
    assert (
        evaluate_offer(
            request,
            offer.model_copy(update={"available_at": NOW + timedelta(hours=3)}),
        ).within_availability
        is True
    )


def test_invalid_state_transition_is_rejected() -> None:
    aggregate = ConversationAggregate(created_at=NOW, updated_at=NOW)

    with pytest.raises(InvalidStateTransition):
        transition(aggregate, RequestStatus.BOOKED, NOW)
