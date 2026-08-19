from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.dependencies import get_orchestrator
from app.api.schemas import (
    AddMessageInput,
    CreateConversationInput,
    WebhookAcknowledgement,
)
from app.application.orchestrator import (
    ConversationOrchestrator,
    ProviderReplyNotFoundError,
)
from app.domain.models import ChatConversation

router = APIRouter()
OrchestratorDependency = Annotated[ConversationOrchestrator, Depends(get_orchestrator)]
MAX_WEBHOOK_BODY_BYTES = 1_000_000


@router.post(
    "/conversations",
    response_model=ChatConversation,
    status_code=status.HTTP_201_CREATED,
)
async def create_conversation(
    body: CreateConversationInput,
    orchestrator: OrchestratorDependency,
) -> ChatConversation:
    return await orchestrator.create_conversation(
        message=body.message,
        client_message_id=body.client_message_id,
        location=body.location,
    )


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=ChatConversation,
)
async def add_message(
    conversation_id: UUID,
    body: AddMessageInput,
    orchestrator: OrchestratorDependency,
) -> ChatConversation:
    return await orchestrator.add_message(
        conversation_id,
        message=body.message,
        client_message_id=body.client_message_id,
    )


@router.get(
    "/conversations/{conversation_id}",
    response_model=ChatConversation,
)
async def get_conversation(
    conversation_id: UUID,
    orchestrator: OrchestratorDependency,
) -> ChatConversation:
    return await orchestrator.get_conversation(conversation_id)


@router.post(
    "/webhooks/resend",
    response_model=WebhookAcknowledgement,
    status_code=status.HTTP_200_OK,
)
async def receive_resend_webhook(
    request: Request,
    orchestrator: OrchestratorDependency,
) -> WebhookAcknowledgement:
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_WEBHOOK_BODY_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Webhook excede o limite permitido.",
        )
    payload = await request.body()
    if len(payload) > MAX_WEBHOOK_BODY_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Webhook excede o limite permitido.",
        )
    try:
        event = orchestrator.verify_resend_webhook(payload, dict(request.headers))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Assinatura de webhook inválida.",
        ) from exc

    try:
        accepted = await orchestrator.process_verified_resend_event(event)
    except ProviderReplyNotFoundError:
        # The signature is valid, but the message is unrelated to an active
        # ServeAI outreach. Acknowledge it so the provider does not retry it.
        accepted = False
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload de webhook inválido.",
        ) from exc
    return WebhookAcknowledgement(accepted=accepted)
