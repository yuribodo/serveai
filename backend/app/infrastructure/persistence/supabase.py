from __future__ import annotations

import asyncio
from collections.abc import Iterable
from datetime import datetime
from typing import Any, cast
from uuid import UUID
from weakref import ReferenceType, ref

from postgrest.exceptions import APIError

from app.application.ports import (
    ConcurrentConversationWriteError,
    ConversationNotFoundError,
)
from app.domain.aggregate import ConversationAggregate
from app.domain.models import (
    AgentEvent,
    Booking,
    Outreach,
    ProviderCandidate,
    ProviderOffer,
    RequestStatus,
    ServiceRequestData,
    StoredMessage,
)
from supabase import Client, create_client


def _object_rows(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    rows: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("Supabase returned a non-object row")
        rows.append(cast(dict[str, Any], item))
    return rows


def _datetime(value: object) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    raise ValueError("Supabase returned an invalid timestamp")


def _string_set(value: object) -> set[str]:
    if not isinstance(value, list):
        return set()
    return {item for item in value if isinstance(item, str)}


class SupabaseConversationRepository:
    """Supabase persistence behind the aggregate-oriented repository port.

    The Supabase Python client is synchronous, so every request is moved to a
    worker thread to keep FastAPI's event loop responsive.
    """

    def __init__(self, url: str, secret_key: str, *, client: Client | None = None) -> None:
        self._client = client or create_client(url, secret_key)
        self._loaded_versions: dict[int, tuple[ReferenceType[ConversationAggregate], datetime]] = {}

    async def get(self, conversation_id: UUID) -> ConversationAggregate:
        aggregate = await asyncio.to_thread(self._get_sync, conversation_id)
        self._remember_version(aggregate, aggregate.updated_at)
        return aggregate

    async def save(self, aggregate: ConversationAggregate) -> None:
        expected_updated_at = self._expected_version(aggregate)
        snapshot = aggregate.model_copy(deep=True)
        try:
            saved_updated_at = await asyncio.to_thread(
                self._save_sync,
                snapshot,
                expected_updated_at,
            )
        except APIError as exc:
            if exc.code in {"23505", "40001", "55P03"}:
                raise ConcurrentConversationWriteError(
                    "Conversation changed concurrently; reload it before retrying"
                ) from exc
            raise
        aggregate.updated_at = saved_updated_at
        self._remember_version(aggregate, saved_updated_at)

    async def find_by_client_message_id(
        self, client_message_id: str
    ) -> ConversationAggregate | None:
        conversation_id = await asyncio.to_thread(
            self._find_conversation_id_sync, client_message_id
        )
        return await self.get(conversation_id) if conversation_id is not None else None

    async def find_by_reply_to(self, reply_to: str) -> tuple[ConversationAggregate, UUID] | None:
        reference = await asyncio.to_thread(self._find_reply_reference_sync, reply_to)
        if reference is None:
            return None
        conversation_id, provider_id = reference
        return await self.get(conversation_id), provider_id

    def _find_conversation_id_sync(self, client_message_id: str) -> UUID | None:
        response = (
            self._client.table("messages")
            .select("conversation_id")
            .eq("client_message_id", client_message_id)
            .limit(1)
            .execute()
        )
        rows = _object_rows(response.data)
        if not rows:
            return None
        return UUID(str(rows[0]["conversation_id"]))

    def _find_reply_reference_sync(self, reply_to: str) -> tuple[UUID, UUID] | None:
        normalized_reply_to = reply_to.strip().lower()
        response = (
            self._client.table("outreaches")
            .select("conversation_id,provider_id")
            .eq("reply_to", normalized_reply_to)
            .limit(1)
            .execute()
        )
        rows = _object_rows(response.data)
        if not rows:
            return None
        row = rows[0]
        return UUID(str(row["conversation_id"])), UUID(str(row["provider_id"]))

    def _get_sync(self, conversation_id: UUID) -> ConversationAggregate:
        conversation_key = str(conversation_id)
        response = (
            self._client.table("service_requests")
            .select("*")
            .eq("id", conversation_key)
            .limit(1)
            .execute()
        )
        response_rows = _object_rows(response.data)
        if not response_rows:
            raise ConversationNotFoundError(conversation_key)
        row = response_rows[0]

        def rows(table: str) -> list[dict[str, Any]]:
            result = (
                self._client.table(table)
                .select("*")
                .eq("conversation_id", conversation_key)
                .execute()
            )
            return _object_rows(result.data)

        messages = [StoredMessage.model_validate(item) for item in rows("messages")]
        events = [AgentEvent.model_validate(item) for item in rows("agent_events")]
        providers = [ProviderCandidate.model_validate(item) for item in rows("provider_candidates")]
        outreaches = [Outreach.model_validate(item) for item in rows("outreaches")]
        offers = [ProviderOffer.model_validate(item) for item in rows("provider_offers")]
        booking_rows = rows("bookings")

        return ConversationAggregate(
            id=row["id"],
            status=RequestStatus(str(row["status"])),
            request=ServiceRequestData.model_validate(row.get("request_data") or {}),
            messages=sorted(messages, key=lambda item: item.sequence),
            events=sorted(events, key=lambda item: item.sequence),
            providers=providers,
            outreaches=outreaches,
            offers=offers,
            booking=Booking.model_validate(booking_rows[0]) if booking_rows else None,
            processed_client_message_ids=_string_set(row.get("processed_client_message_ids")),
            processed_inbound_message_ids=_string_set(row.get("processed_inbound_message_ids")),
            pending_offer_id=row.get("pending_offer_id"),
            next_sequence=int(row.get("next_sequence") or 1),
            created_at=_datetime(row["created_at"]),
            updated_at=_datetime(row["updated_at"]),
        )

    def _save_sync(
        self,
        aggregate: ConversationAggregate,
        expected_updated_at: datetime | None,
    ) -> datetime:
        root = {
            "id": str(aggregate.id),
            "status": aggregate.status.value,
            "request_data": aggregate.request.model_dump(mode="json"),
            "pending_offer_id": (
                str(aggregate.pending_offer_id) if aggregate.pending_offer_id else None
            ),
            "next_sequence": aggregate.next_sequence,
            "processed_client_message_ids": sorted(aggregate.processed_client_message_ids),
            "processed_inbound_message_ids": sorted(aggregate.processed_inbound_message_ids),
            "created_at": aggregate.created_at.isoformat(),
            "updated_at": aggregate.updated_at.isoformat(),
        }
        outreaches = self._model_payload(aggregate.outreaches)
        for outreach in outreaches:
            reply_to = outreach.get("reply_to")
            if isinstance(reply_to, str):
                outreach["reply_to"] = reply_to.strip().lower()

        payload = {
            "root": root,
            "messages": self._model_payload(aggregate.messages),
            "agent_events": self._model_payload(aggregate.events),
            "provider_candidates": self._model_payload(aggregate.providers),
            "outreaches": outreaches,
            "provider_offers": self._model_payload(aggregate.offers),
            "bookings": (
                self._model_payload([aggregate.booking]) if aggregate.booking is not None else []
            ),
        }
        response = self._client.rpc(
            "persist_conversation",
            {
                "p_aggregate": payload,
                "p_expected_updated_at": (
                    expected_updated_at.isoformat() if expected_updated_at else None
                ),
            },
        ).execute()
        return _datetime(response.data)

    @staticmethod
    def _model_payload(models: Iterable[Any]) -> list[dict[str, Any]]:
        return [cast(dict[str, Any], model.model_dump(mode="json")) for model in models]

    def _expected_version(self, aggregate: ConversationAggregate) -> datetime | None:
        tracked = self._loaded_versions.get(id(aggregate))
        if tracked is None or tracked[0]() is not aggregate:
            return None
        return tracked[1]

    def _remember_version(
        self,
        aggregate: ConversationAggregate,
        updated_at: datetime,
    ) -> None:
        key = id(aggregate)

        def forget(
            reference: ReferenceType[ConversationAggregate],
            tracked_key: int = key,
        ) -> None:
            tracked = self._loaded_versions.get(tracked_key)
            if tracked is not None and tracked[0] is reference:
                self._loaded_versions.pop(tracked_key, None)

        reference = ref(aggregate, forget)
        self._loaded_versions[key] = (reference, updated_at)
