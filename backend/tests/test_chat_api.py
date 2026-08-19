from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient


def _post(client: TestClient, path: str, body: dict[str, object]) -> dict[str, Any]:
    response = client.post(path, json=body)
    assert response.status_code in {200, 201}, response.text
    return response.json()


def test_multiturn_timeline_and_client_message_idempotency(client: TestClient) -> None:
    first = _post(
        client,
        "/api/v1/conversations",
        {
            "message": "Preciso de um chaveiro em Pinheiros, São Paulo",
            "clientMessageId": "message-1",
        },
    )
    repeated_creation = _post(
        client,
        "/api/v1/conversations",
        {
            "message": "Preciso de um chaveiro em Pinheiros, São Paulo",
            "clientMessageId": "message-1",
        },
    )

    assert repeated_creation["conversationId"] == first["conversationId"]
    assert repeated_creation["timeline"] == first["timeline"]
    assert first["status"] == "collecting_requirements"
    assert first["timeline"][-1]["content"].startswith("O que aconteceu")

    conversation_id = first["conversationId"]
    second = _post(
        client,
        f"/api/v1/conversations/{conversation_id}/messages",
        {"message": "Perdi minha chave", "clientMessageId": "message-2"},
    )
    repeated_second = _post(
        client,
        f"/api/v1/conversations/{conversation_id}/messages",
        {"message": "Perdi minha chave", "clientMessageId": "message-2"},
    )
    assert repeated_second["timeline"] == second["timeline"]

    third = _post(
        client,
        f"/api/v1/conversations/{conversation_id}/messages",
        {"message": "Até R$ 250", "clientMessageId": "message-3"},
    )
    assert third["serviceRequest"]["problem"] == "Perdi minha chave"

    waiting = _post(
        client,
        f"/api/v1/conversations/{conversation_id}/messages",
        {"message": "Hoje das 14h às 18h", "clientMessageId": "message-4"},
    )
    assert waiting["status"] == "waiting_for_replies"
    assert waiting["canSendMessage"] is False
    assert waiting["pollAfterMs"] == 2000
    assert [item["type"] for item in waiting["timeline"]].count("providers") == 1
    assert [item["type"] for item in waiting["timeline"]].count("operation") == 3


def test_invalid_demo_webhook_is_unauthorized(client: TestClient) -> None:
    response = client.post(
        "/api/v1/webhooks/resend",
        content=b"not-json",
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 401
    assert response.json() == {"detail": "Assinatura de webhook inválida."}


def test_oversized_webhook_is_rejected_before_verification(client: TestClient) -> None:
    response = client.post(
        "/api/v1/webhooks/resend",
        content=b"{}",
        headers={"content-length": "1000001"},
    )

    assert response.status_code == 413
    assert response.json() == {"detail": "Webhook excede o limite permitido."}


def test_blank_message_and_incomplete_coordinates_are_rejected(client: TestClient) -> None:
    blank = client.post(
        "/api/v1/conversations",
        json={"message": "   ", "clientMessageId": "blank-message"},
    )
    incomplete_location = client.post(
        "/api/v1/conversations",
        json={
            "message": "Preciso de ajuda",
            "clientMessageId": "incomplete-location",
            "location": {"latitude": -23.5},
        },
    )

    assert blank.status_code == 422
    assert incomplete_location.status_code == 422
