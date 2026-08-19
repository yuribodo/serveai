from __future__ import annotations

import asyncio
from uuid import UUID

from app.application.ports import ConversationNotFoundError
from app.domain.aggregate import ConversationAggregate


class InMemoryConversationRepository:
    """Process-local repository used by tests and the zero-configuration demo."""

    def __init__(self) -> None:
        self._conversations: dict[UUID, ConversationAggregate] = {}
        self._lock = asyncio.Lock()

    async def get(self, conversation_id: UUID) -> ConversationAggregate:
        async with self._lock:
            aggregate = self._conversations.get(conversation_id)
            if aggregate is None:
                raise ConversationNotFoundError(str(conversation_id))
            return aggregate.model_copy(deep=True)

    async def find_by_client_message_id(
        self, client_message_id: str
    ) -> ConversationAggregate | None:
        async with self._lock:
            for aggregate in self._conversations.values():
                if client_message_id in aggregate.processed_client_message_ids:
                    return aggregate.model_copy(deep=True)
        return None

    async def find_by_reply_to(self, reply_to: str) -> tuple[ConversationAggregate, UUID] | None:
        normalized = reply_to.casefold()
        async with self._lock:
            for aggregate in self._conversations.values():
                for outreach in aggregate.outreaches:
                    if outreach.reply_to and outreach.reply_to.casefold() == normalized:
                        return aggregate.model_copy(deep=True), outreach.provider_id
        return None

    async def save(self, aggregate: ConversationAggregate) -> None:
        async with self._lock:
            self._conversations[aggregate.id] = aggregate.model_copy(deep=True)
