from __future__ import annotations

from app.application.orchestrator import ConversationOrchestrator
from app.container import get_container


def get_orchestrator() -> ConversationOrchestrator:
    return get_container().orchestrator
