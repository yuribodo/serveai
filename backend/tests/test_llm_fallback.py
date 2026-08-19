from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.domain.models import OfferStatus, ServiceRequestData
from app.infrastructure.llm.adapters import (
    RuleBasedOfferInterpreter,
    RuleBasedRequirementsExtractor,
)


@pytest.mark.asyncio
async def test_explicit_date_is_not_mistaken_for_a_time_range() -> None:
    now = datetime(2026, 8, 19, 13, tzinfo=ZoneInfo("America/Sao_Paulo"))

    offer = await RuleBasedOfferInterpreter().interpret(
        "Consigo atender em 19/08/2026 às 14:30 por R$ 180,00.",
        now,
    )

    assert offer.available_at == datetime(2026, 8, 19, 14, 30, tzinfo=ZoneInfo("America/Sao_Paulo"))
    assert offer.price == 180


@pytest.mark.asyncio
async def test_requirements_fallback_preserves_and_completes_portuguese_golden_path() -> None:
    now = datetime(2026, 8, 19, 10, tzinfo=ZoneInfo("America/Sao_Paulo"))
    extractor = RuleBasedRequirementsExtractor()
    request = ServiceRequestData()
    history: list[tuple[str, str]] = []
    turns = (
        "Preciso de um chaveiro.",
        "Pinheiros, São Paulo.",
        "Perdi minha chave e estou trancado pra fora.",
        "Entre R$100 e R$200.",
        "Hoje entre 14h e 18h.",
    )

    for turn in turns:
        history.append(("user", turn))
        request = await extractor.extract(request, history, now)

    assert request.missing_fields() == []
    assert request.service_type == "chaveiro"
    assert request.problem == "Perdi minha chave e estou trancado pra fora."
    assert request.location is not None
    assert request.location.neighborhood == "Pinheiros"
    assert request.location.city == "São Paulo"
    assert request.location.address is None
    assert request.budget is not None
    assert (request.budget.minimum, request.budget.maximum) == (100, 200)
    assert request.availability[0].start == datetime(
        2026, 8, 19, 14, tzinfo=ZoneInfo("America/Sao_Paulo")
    )
    assert request.availability[0].end == datetime(
        2026, 8, 19, 18, tzinfo=ZoneInfo("America/Sao_Paulo")
    )
    assert request.urgency == "today"


@pytest.mark.asyncio
async def test_offer_fallback_prefers_explicit_time_over_greeting_period() -> None:
    now = datetime(2026, 8, 19, 10, tzinfo=ZoneInfo("America/Sao_Paulo"))
    interpreter = RuleBasedOfferInterpreter()

    offer = await interpreter.interpret(
        "Boa tarde. Consigo ir às 15:30. Fica R$180.",
        now,
    )
    question = await interpreter.interpret("Qual é o tipo da fechadura?", now)
    unavailable = await interpreter.interpret("Hoje não consigo, estou sem disponibilidade.", now)

    assert offer.status is OfferStatus.AVAILABLE
    assert offer.available_at == datetime(2026, 8, 19, 15, 30, tzinfo=ZoneInfo("America/Sao_Paulo"))
    assert offer.price == 180
    assert question.status is OfferStatus.QUESTION
    assert question.question == "Qual é o tipo da fechadura?"
    assert unavailable.status is OfferStatus.UNAVAILABLE


@pytest.mark.asyncio
async def test_requirements_understand_urgent_natural_language_in_one_turn() -> None:
    now = datetime(2026, 8, 19, 15, tzinfo=ZoneInfo("America/Sao_Paulo"))

    request = await RuleBasedRequirementsExtractor().extract(
        ServiceRequestData(),
        [
            (
                "user",
                "Quero um chaveiro para agora, minha porta emperrou, quero gastar no máximo 100",
            )
        ],
        now,
    )

    assert request.service_type == "chaveiro"
    assert request.problem is not None
    assert request.budget is not None and request.budget.maximum == 100
    assert request.availability[0].start == now
    assert request.availability[0].end == now + timedelta(hours=4)
    assert request.urgency == "immediate"
