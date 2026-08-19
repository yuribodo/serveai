from __future__ import annotations

from typing import Any
from uuid import UUID

from app.domain.aggregate import ConversationAggregate
from app.domain.models import (
    BookingItem,
    ChatConversation,
    ErrorItem,
    MessageItem,
    OfferItem,
    OperationItem,
    ProvidersItem,
    ProviderSummary,
    RequestStatus,
    TimelineItem,
)


def present_conversation(aggregate: ConversationAggregate) -> ChatConversation:
    timeline: list[TimelineItem] = []
    ordered: list[tuple[int, str, Any]] = [
        *((message.sequence, "message", message) for message in aggregate.messages),
        *((event.sequence, "event", event) for event in aggregate.events),
    ]

    for _, item_kind, item in sorted(ordered, key=lambda value: value[0]):
        if item_kind == "message":
            timeline.append(
                MessageItem(
                    id=item.id,
                    role=item.role,
                    content=item.content,
                    created_at=item.created_at,
                )
            )
            continue

        payload = item.payload
        if item.event_type == "operation":
            timeline.append(
                OperationItem(
                    id=item.id,
                    status=RequestStatus(payload["status"]),
                    title=str(payload["title"]),
                    detail=_optional_text(payload.get("detail")),
                    created_at=item.created_at,
                )
            )
        elif item.event_type == "providers":
            provider_ids = {UUID(str(value)) for value in payload.get("providerIds", [])}
            providers = [
                ProviderSummary(
                    id=provider.id,
                    name=provider.name,
                    address=provider.address,
                    rating=provider.rating,
                    review_count=provider.review_count,
                    phone=provider.phone,
                    website=provider.website,
                )
                for provider in aggregate.providers
                if provider.id in provider_ids
            ]
            timeline.append(
                ProvidersItem(id=item.id, providers=providers, created_at=item.created_at)
            )
        elif item.event_type == "offer":
            offer = next(
                (offer for offer in aggregate.offers if offer.id == UUID(str(payload["offerId"]))),
                None,
            )
            if offer is None:
                continue
            provider = next(
                (provider for provider in aggregate.providers if provider.id == offer.provider_id),
                None,
            )
            timeline.append(
                OfferItem(
                    id=item.id,
                    provider_id=offer.provider_id,
                    provider_name=provider.name if provider else "Prestador",
                    price=offer.price,
                    available_at=offer.available_at,
                    within_budget=offer.within_budget,
                    within_availability=offer.within_availability,
                    acceptable=offer.acceptable,
                    created_at=item.created_at,
                )
            )
        elif item.event_type == "booking" and aggregate.booking is not None:
            provider = next(
                (
                    candidate
                    for candidate in aggregate.providers
                    if candidate.id == aggregate.booking.provider_id
                ),
                None,
            )
            timeline.append(
                BookingItem(
                    id=item.id,
                    provider_name=provider.name if provider else "Prestador",
                    start=aggregate.booking.start,
                    end=aggregate.booking.end,
                    price=aggregate.booking.price,
                    address=aggregate.request.exact_address or "Endereço a confirmar",
                    calendar_event_url=aggregate.booking.calendar_event_url,
                    created_at=item.created_at,
                )
            )
        elif item.event_type == "error":
            timeline.append(
                ErrorItem(
                    id=item.id,
                    code=str(payload.get("code", "unexpected_error")),
                    message=str(payload.get("message", "Não foi possível concluir esta etapa.")),
                    retryable=bool(payload.get("retryable", True)),
                    created_at=item.created_at,
                )
            )

    can_send = aggregate.status in {
        RequestStatus.COLLECTING_REQUIREMENTS,
        RequestStatus.NEEDS_USER_INPUT,
        RequestStatus.FAILED,
    }
    automatic_statuses = {
        RequestStatus.READY,
        RequestStatus.SEARCHING,
        RequestStatus.PROVIDERS_FOUND,
        RequestStatus.CONTACTING,
        RequestStatus.WAITING_FOR_REPLIES,
        RequestStatus.OFFER_RECEIVED,
        RequestStatus.ACCEPTED,
    }
    poll_after_ms = 2_000 if aggregate.status in automatic_statuses else None
    return ChatConversation(
        conversation_id=aggregate.id,
        status=aggregate.status,
        can_send_message=can_send,
        poll_after_ms=poll_after_ms,
        timeline=timeline,
        service_request=aggregate.request,
        updated_at=aggregate.updated_at,
    )


def _optional_text(value: object) -> str | None:
    return str(value) if value is not None else None
