from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from app.domain.aggregate import ConversationAggregate
from app.domain.models import ProviderOffer, RequestStatus, ServiceRequestData


class InvalidStateTransition(ValueError):
    pass


DEFAULT_BOOKING_DURATION = timedelta(hours=1)


ALLOWED_TRANSITIONS: dict[RequestStatus, set[RequestStatus]] = {
    RequestStatus.COLLECTING_REQUIREMENTS: {RequestStatus.READY, RequestStatus.FAILED},
    RequestStatus.READY: {RequestStatus.SEARCHING, RequestStatus.FAILED},
    RequestStatus.SEARCHING: {RequestStatus.PROVIDERS_FOUND, RequestStatus.FAILED},
    RequestStatus.PROVIDERS_FOUND: {RequestStatus.CONTACTING, RequestStatus.FAILED},
    RequestStatus.CONTACTING: {RequestStatus.WAITING_FOR_REPLIES, RequestStatus.FAILED},
    RequestStatus.WAITING_FOR_REPLIES: {
        RequestStatus.OFFER_RECEIVED,
        RequestStatus.NEEDS_USER_INPUT,
        RequestStatus.FAILED,
    },
    RequestStatus.OFFER_RECEIVED: {
        RequestStatus.ACCEPTED,
        RequestStatus.NEEDS_USER_INPUT,
        RequestStatus.WAITING_FOR_REPLIES,
        RequestStatus.FAILED,
    },
    RequestStatus.NEEDS_USER_INPUT: {
        RequestStatus.ACCEPTED,
        RequestStatus.COLLECTING_REQUIREMENTS,
        RequestStatus.WAITING_FOR_REPLIES,
        RequestStatus.FAILED,
    },
    RequestStatus.ACCEPTED: {RequestStatus.BOOKED, RequestStatus.FAILED},
    RequestStatus.BOOKED: set(),
    RequestStatus.FAILED: {
        RequestStatus.COLLECTING_REQUIREMENTS,
        RequestStatus.NEEDS_USER_INPUT,
        RequestStatus.ACCEPTED,
    },
}


def transition(aggregate: ConversationAggregate, target: RequestStatus, now: datetime) -> None:
    if target == aggregate.status:
        return
    if target not in ALLOWED_TRANSITIONS[aggregate.status]:
        raise InvalidStateTransition(f"cannot transition from {aggregate.status} to {target}")
    aggregate.status = target
    aggregate.updated_at = now


QUESTIONS: dict[str, str] = {
    "serviceType": "Que tipo de profissional ou serviço você precisa?",
    "location": "Onde você está? Pode informar o bairro e a cidade.",
    "problem": "O que aconteceu? Conte brevemente o problema.",
    "budget": "Qual é o valor máximo que você gostaria de gastar?",
    "availability": "Quando você pode receber o profissional?",
}


def next_question(request: ServiceRequestData) -> str | None:
    missing = request.missing_fields()
    return QUESTIONS[missing[0]] if missing else None


@dataclass(frozen=True, slots=True)
class OfferEvaluation:
    within_budget: bool
    within_availability: bool

    @property
    def acceptable(self) -> bool:
        return self.within_budget and self.within_availability


def evaluate_offer(request: ServiceRequestData, offer: ProviderOffer) -> OfferEvaluation:
    maximum = request.budget.maximum if request.budget else None
    within_budget = offer.price is not None and maximum is not None and offer.price <= maximum
    within_availability = bool(
        offer.available_at
        and any(
            window.start <= offer.available_at
            and offer.available_at + DEFAULT_BOOKING_DURATION <= window.end
            for window in request.availability
        )
    )
    return OfferEvaluation(
        within_budget=within_budget,
        within_availability=within_availability,
    )
