from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, cast
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from postgrest.exceptions import APIError

from app.domain.aggregate import ConversationAggregate
from app.domain.models import Outreach, ProviderCandidate
from app.infrastructure.persistence.supabase import (
    ConcurrentConversationWriteError,
    SupabaseConversationRepository,
)
from supabase import Client

NOW = datetime(2026, 8, 19, 10, tzinfo=ZoneInfo("America/Sao_Paulo"))
CONVERSATION_ID = UUID("40ab527d-2d9e-478a-844f-d13aa08659f9")
PROVIDER_ID = UUID("cfb8bb46-a4b6-4b57-a002-3f78fb3f540a")


class FakeResponse:
    def __init__(self, data: object) -> None:
        self.data = data


class FakeQuery:
    def __init__(
        self,
        rows: object,
        operations: list[tuple[str, tuple[object, ...]]],
        error: APIError | None = None,
    ) -> None:
        self._rows = rows
        self._operations = operations
        self._filters: list[tuple[str, object]] = []
        self._limit: int | None = None
        self._error = error

    def select(self, columns: str) -> FakeQuery:
        self._operations.append(("select", (columns,)))
        return self

    def eq(self, column: str, value: object) -> FakeQuery:
        self._operations.append(("eq", (column, value)))
        self._filters.append((column, value))
        return self

    def limit(self, count: int) -> FakeQuery:
        self._operations.append(("limit", (count,)))
        self._limit = count
        return self

    def execute(self) -> FakeResponse:
        if self._error is not None:
            raise self._error
        if not isinstance(self._rows, list):
            return FakeResponse(self._rows)
        rows = [
            row
            for row in self._rows
            if isinstance(row, dict)
            and all(str(row.get(column)) == str(value) for column, value in self._filters)
        ]
        if self._limit is not None:
            rows = rows[: self._limit]
        return FakeResponse(rows)


class FakeClient:
    def __init__(self, table_rows: dict[str, list[dict[str, object]]] | None = None) -> None:
        self.table_rows = table_rows or {}
        self.operations: list[tuple[str, tuple[object, ...]]] = []
        self.rpc_calls: list[tuple[str, dict[str, object]]] = []
        self.rpc_error: APIError | None = None

    def table(self, name: str) -> FakeQuery:
        self.operations.append(("table", (name,)))
        return FakeQuery(self.table_rows.get(name, []), self.operations)

    def rpc(self, name: str, params: dict[str, object]) -> FakeQuery:
        self.rpc_calls.append((name, params))
        aggregate = cast(dict[str, Any], params["p_aggregate"])
        root = cast(dict[str, Any], aggregate["root"])
        return FakeQuery(root["updated_at"], self.operations, self.rpc_error)


def _root_row(updated_at: datetime = NOW) -> dict[str, object]:
    return {
        "id": str(CONVERSATION_ID),
        "status": "collecting_requirements",
        "request_data": {},
        "processed_client_message_ids": [],
        "processed_inbound_message_ids": [],
        "pending_offer_id": None,
        "next_sequence": 1,
        "created_at": NOW.isoformat(),
        "updated_at": updated_at.isoformat(),
    }


def _repository(fake: FakeClient) -> SupabaseConversationRepository:
    return SupabaseConversationRepository(
        "https://project.supabase.co",
        "server-only-test-secret",
        client=cast(Client, fake),
    )


@pytest.mark.asyncio
async def test_save_is_one_rpc_and_uses_optimistic_version() -> None:
    fake = FakeClient()
    repository = _repository(fake)
    aggregate = ConversationAggregate(
        id=CONVERSATION_ID,
        created_at=NOW,
        updated_at=NOW,
    )
    aggregate.add_message(
        role="user",
        content="Preciso de um chaveiro",
        client_message_id="client-message-1",
        now=NOW,
    )
    provider = ProviderCandidate(
        id=PROVIDER_ID,
        conversation_id=CONVERSATION_ID,
        external_id="places/provider-1",
        name="Chaveiro Teste",
        address="Pinheiros, São Paulo",
    )
    aggregate.providers.append(provider)
    aggregate.outreaches.append(
        Outreach(
            conversation_id=CONVERSATION_ID,
            provider_id=PROVIDER_ID,
            destination="provider@example.com",
            reply_to="Offer+ABC@Inbound.ServeAI.Example",
            created_at=NOW,
        )
    )

    await repository.save(aggregate)

    assert len(fake.rpc_calls) == 1
    rpc_name, first_params = fake.rpc_calls[0]
    assert rpc_name == "persist_conversation"
    assert first_params["p_expected_updated_at"] is None
    first_payload = cast(dict[str, Any], first_params["p_aggregate"])
    assert first_payload["root"]["id"] == str(CONVERSATION_ID)
    assert first_payload["messages"][0]["client_message_id"] == "client-message-1"
    assert first_payload["outreaches"][0]["reply_to"] == ("offer+abc@inbound.serveai.example")
    assert not [operation for operation in fake.operations if operation[0] == "table"]

    first_version = aggregate.updated_at
    aggregate.add_event("operation", {"status": "searching"}, NOW + timedelta(seconds=1))
    await repository.save(aggregate)

    assert len(fake.rpc_calls) == 2
    assert fake.rpc_calls[1][1]["p_expected_updated_at"] == first_version.isoformat()


@pytest.mark.asyncio
async def test_each_loaded_copy_keeps_its_database_version() -> None:
    fake = FakeClient({"service_requests": [_root_row()]})
    repository = _repository(fake)

    first = await repository.get(CONVERSATION_ID)
    second = await repository.get(CONVERSATION_ID)
    first.updated_at = NOW + timedelta(seconds=1)
    second.updated_at = NOW + timedelta(seconds=2)

    await repository.save(first)
    await repository.save(second)

    assert fake.rpc_calls[0][1]["p_expected_updated_at"] == NOW.isoformat()
    assert fake.rpc_calls[1][1]["p_expected_updated_at"] == NOW.isoformat()


@pytest.mark.asyncio
async def test_concurrency_database_errors_are_retryable_repository_conflicts() -> None:
    fake = FakeClient()
    fake.rpc_error = APIError(
        {
            "code": "40001",
            "message": "conversation changed concurrently",
            "hint": None,
            "details": None,
        }
    )
    repository = _repository(fake)
    aggregate = ConversationAggregate(
        id=CONVERSATION_ID,
        created_at=NOW,
        updated_at=NOW,
    )

    with pytest.raises(ConcurrentConversationWriteError):
        await repository.save(aggregate)


@pytest.mark.asyncio
async def test_reply_lookup_is_normalized_and_index_friendly() -> None:
    fake = FakeClient(
        {
            "service_requests": [_root_row()],
            "outreaches": [
                {
                    "conversation_id": str(CONVERSATION_ID),
                    "provider_id": str(PROVIDER_ID),
                    "reply_to": "offer+abc@inbound.serveai.example",
                    "destination": "provider@example.com",
                    "created_at": NOW.isoformat(),
                }
            ],
        }
    )
    repository = _repository(fake)

    result = await repository.find_by_reply_to(" Offer+ABC@Inbound.ServeAI.Example ")

    assert result is not None
    aggregate, provider_id = result
    assert aggregate.id == CONVERSATION_ID
    assert provider_id == PROVIDER_ID
    assert ("eq", ("reply_to", "offer+abc@inbound.serveai.example")) in fake.operations


def test_migration_secures_and_serializes_aggregate_persistence() -> None:
    migration = (
        Path(__file__).parents[1] / "supabase" / "migrations" / "0001_initial_schema.sql"
    ).read_text()

    assert migration.count("create table public.") == 7
    assert migration.count("enable row level security") == 7
    assert "security invoker" in migration
    assert "security definer" not in migration
    assert "pg_advisory_xact_lock" in migration
    assert "and updated_at = p_expected_updated_at" in migration
    assert "outreaches_reply_to_unique" in migration
    assert "service_requests_pending_offer_idx" in migration
    assert "provider_offers_conversation_provider_idx" in migration
    assert "from public, anon, authenticated" in migration
    assert "to service_role" in migration
