from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timedelta
from email.utils import parseaddr
from uuid import UUID
from zoneinfo import ZoneInfo

from app.application.ports import (
    CalendarGateway,
    ConcurrentConversationWriteError,
    ContactChannel,
    ConversationNotFoundError,
    ConversationRepository,
    OfferInterpreter,
    ProviderDiscovery,
    RequirementsExtractor,
)
from app.application.presenter import present_conversation
from app.domain.aggregate import ConversationAggregate
from app.domain.models import (
    ChatConversation,
    Location,
    OfferStatus,
    ProviderOffer,
    RequestStatus,
)
from app.domain.rules import DEFAULT_BOOKING_DURATION, evaluate_offer, next_question, transition


class ConversationLockedError(RuntimeError):
    pass


MAX_PROVIDER_REPLY_CHARS = 12_000


class ProviderReplyNotFoundError(LookupError):
    pass


class ConversationOrchestrator:
    def __init__(
        self,
        *,
        repository: ConversationRepository,
        requirements_extractor: RequirementsExtractor,
        offer_interpreter: OfferInterpreter,
        provider_discovery: ProviderDiscovery,
        contact_channel: ContactChannel,
        calendar_gateway: CalendarGateway,
        timezone: str = "America/Sao_Paulo",
        demo_auto_reply: bool = False,
        demo_auto_reply_delay_seconds: float = 2.0,
    ) -> None:
        self._repository = repository
        self._requirements_extractor = requirements_extractor
        self._offer_interpreter = offer_interpreter
        self._provider_discovery = provider_discovery
        self._contact_channel = contact_channel
        self._calendar_gateway = calendar_gateway
        self._timezone = ZoneInfo(timezone)
        self._demo_auto_reply = demo_auto_reply
        self._demo_auto_reply_delay = timedelta(seconds=demo_auto_reply_delay_seconds)
        self._create_lock = asyncio.Lock()
        self._conversation_locks: defaultdict[UUID, asyncio.Lock] = defaultdict(asyncio.Lock)

    def now(self) -> datetime:
        return datetime.now(self._timezone)

    async def create_conversation(
        self,
        *,
        message: str,
        client_message_id: str,
        location: Location | None = None,
    ) -> ChatConversation:
        async with self._create_lock:
            existing = await self._repository.find_by_client_message_id(client_message_id)
            if existing is not None:
                return present_conversation(existing)

            now = self.now()
            aggregate = ConversationAggregate(created_at=now, updated_at=now)
            if location is not None:
                aggregate.request.location = location
            aggregate.add_message(
                role="user",
                content=message.strip(),
                client_message_id=client_message_id,
                now=now,
            )
            try:
                await self._repository.save(aggregate)
            except ConcurrentConversationWriteError:
                existing = await self._repository.find_by_client_message_id(client_message_id)
                if existing is not None:
                    return present_conversation(existing)
                raise
            await self._process_user_input(aggregate)
            return present_conversation(aggregate)

    async def add_message(
        self,
        conversation_id: UUID,
        *,
        message: str,
        client_message_id: str,
    ) -> ChatConversation:
        async with self._conversation_locks[conversation_id]:
            aggregate = await self._repository.get(conversation_id)
            if client_message_id in aggregate.processed_client_message_ids:
                return present_conversation(aggregate)
            if aggregate.status not in {
                RequestStatus.COLLECTING_REQUIREMENTS,
                RequestStatus.NEEDS_USER_INPUT,
                RequestStatus.FAILED,
            }:
                raise ConversationLockedError(
                    "O ServeAI está executando esta solicitação; aguarde a próxima atualização."
                )

            now = self.now()
            aggregate.add_message(
                role="user",
                content=message.strip(),
                client_message_id=client_message_id,
                now=now,
            )
            try:
                await self._repository.save(aggregate)
            except ConcurrentConversationWriteError:
                latest = await self._repository.get(conversation_id)
                if client_message_id in latest.processed_client_message_ids:
                    return present_conversation(latest)
                raise
            await self._process_user_input(aggregate)
            return present_conversation(aggregate)

    async def get_conversation(self, conversation_id: UUID) -> ChatConversation:
        async with self._conversation_locks[conversation_id]:
            aggregate = await self._repository.get(conversation_id)
            await self._maybe_advance_demo(aggregate)
            return present_conversation(aggregate)

    def verify_resend_webhook(self, payload: bytes, headers: dict[str, str]) -> dict[str, object]:
        return self._contact_channel.verify_webhook(payload, headers)

    async def process_verified_resend_event(self, event: dict[str, object]) -> bool:
        if event.get("type") != "email.received":
            return False
        data = event.get("data")
        if not isinstance(data, dict):
            raise ValueError("Webhook sem o campo data")

        email_id = str(data.get("email_id") or data.get("emailId") or "").strip()
        if not email_id:
            raise ValueError("Webhook sem email_id")
        recipients_value = data.get("to") or []
        if isinstance(recipients_value, str):
            recipients = [recipients_value]
        elif isinstance(recipients_value, list):
            recipients = [str(value) for value in recipients_value]
        else:
            recipients = []

        reference: tuple[ConversationAggregate, UUID] | None = None
        for recipient in recipients:
            address = parseaddr(recipient)[1] or recipient
            reference = await self._repository.find_by_reply_to(address)
            if reference is not None:
                break
        if reference is None:
            raise ProviderReplyNotFoundError("Resposta não corresponde a um contato do ServeAI")

        aggregate, provider_id = reference
        async with self._conversation_locks[aggregate.id]:
            aggregate = await self._repository.get(aggregate.id)
            if email_id in aggregate.processed_inbound_message_ids:
                return True
            text = await self._contact_channel.fetch_inbound_text(email_id)
            try:
                await self._process_provider_reply(
                    aggregate=aggregate,
                    provider_id=provider_id,
                    inbound_message_id=email_id,
                    text=text,
                )
            except ConcurrentConversationWriteError:
                latest = await self._repository.get(aggregate.id)
                if email_id not in latest.processed_inbound_message_ids:
                    raise
        return True

    async def _process_user_input(self, aggregate: ConversationAggregate) -> None:
        now = self.now()
        try:
            if aggregate.status == RequestStatus.FAILED and aggregate.pending_offer_id is None:
                transition(aggregate, RequestStatus.COLLECTING_REQUIREMENTS, now)

            aggregate.request = await self._requirements_extractor.extract(
                aggregate.request,
                [(message.role, message.content) for message in aggregate.messages],
                now,
            )
            aggregate.updated_at = now

            if aggregate.pending_offer_id is not None:
                if aggregate.request.exact_address:
                    offer = next(
                        (
                            item
                            for item in aggregate.offers
                            if item.id == aggregate.pending_offer_id
                        ),
                        None,
                    )
                    if offer is None:
                        aggregate.pending_offer_id = None
                    else:
                        transition(aggregate, RequestStatus.ACCEPTED, now)
                        await self._repository.save(aggregate)
                        await self._book_offer(aggregate, offer)
                        return
                else:
                    if aggregate.status == RequestStatus.FAILED:
                        transition(aggregate, RequestStatus.NEEDS_USER_INPUT, now)
                    aggregate.add_message(
                        role="assistant",
                        content=(
                            "A opção é compatível. Para concluir a reserva, informe o endereço "
                            "completo, incluindo número e complemento."
                        ),
                        now=now,
                    )
                    await self._repository.save(aggregate)
                    return

            if aggregate.status == RequestStatus.FAILED:
                transition(aggregate, RequestStatus.COLLECTING_REQUIREMENTS, now)

            question = next_question(aggregate.request)
            if question is not None:
                if aggregate.status == RequestStatus.NEEDS_USER_INPUT:
                    transition(aggregate, RequestStatus.COLLECTING_REQUIREMENTS, now)
                aggregate.add_message(role="assistant", content=question, now=now)
                await self._repository.save(aggregate)
                return

            if aggregate.status == RequestStatus.NEEDS_USER_INPUT:
                transition(aggregate, RequestStatus.COLLECTING_REQUIREMENTS, now)
            transition(aggregate, RequestStatus.READY, now)
            aggregate.add_message(
                role="assistant",
                content="Tenho tudo o que preciso. Vou procurar as melhores opções agora.",
                now=now,
            )
            await self._repository.save(aggregate)
            await self._discover_and_contact(aggregate)
        except ConcurrentConversationWriteError:
            raise
        except Exception:
            await self._fail(
                aggregate,
                code="automation_failed",
                message=(
                    "Tive um problema ao executar esta etapa. Você pode tentar novamente sem "
                    "perder o que já informou."
                ),
            )

    async def _discover_and_contact(self, aggregate: ConversationAggregate) -> None:
        now = self.now()
        transition(aggregate, RequestStatus.SEARCHING, now)
        aggregate.add_event(
            "operation",
            {
                "status": RequestStatus.SEARCHING.value,
                "title": f"Procurando {aggregate.request.service_type or 'prestadores'}",
                "detail": (
                    aggregate.request.location.search_text if aggregate.request.location else None
                ),
            },
            now,
        )
        await self._repository.save(aggregate)

        discovered = await self._provider_discovery.search(
            aggregate.id, aggregate.request, limit=10
        )
        eligible = [
            provider
            for provider in discovered
            if (provider.business_status or "OPERATIONAL").upper() == "OPERATIONAL"
        ]
        eligible.sort(
            key=lambda provider: (provider.rating or 0, provider.review_count or 0), reverse=True
        )
        aggregate.providers = eligible[:3]
        for index, provider in enumerate(aggregate.providers, start=1):
            provider.rank = index
        if not aggregate.providers:
            raise RuntimeError("Nenhum prestador disponível")

        now = self.now()
        transition(aggregate, RequestStatus.PROVIDERS_FOUND, now)
        aggregate.add_event(
            "providers",
            {"providerIds": [str(provider.id) for provider in aggregate.providers]},
            now,
        )
        await self._repository.save(aggregate)

        now = self.now()
        transition(aggregate, RequestStatus.CONTACTING, now)
        aggregate.add_event(
            "operation",
            {
                "status": RequestStatus.CONTACTING.value,
                "title": "Contatando prestadores",
                "detail": f"Enviando {len(aggregate.providers)} solicitações em paralelo",
            },
            now,
        )
        await self._repository.save(aggregate)

        selected_provider_ids = {provider.id for provider in aggregate.providers}
        existing_outreach_provider_ids = {
            outreach.provider_id
            for outreach in aggregate.outreaches
            if outreach.provider_id in selected_provider_ids
        }
        providers_to_contact = [
            provider
            for provider in aggregate.providers
            if provider.id not in existing_outreach_provider_ids
        ]
        results = await asyncio.gather(
            *(
                self._contact_channel.send_outreach(provider, aggregate.request, self.now())
                for provider in providers_to_contact
            ),
            return_exceptions=True,
        )
        aggregate.outreaches.extend(
            outreach for outreach in results if not isinstance(outreach, BaseException)
        )
        current_outreaches = [
            outreach
            for outreach in aggregate.outreaches
            if outreach.provider_id in selected_provider_ids
        ]
        if not current_outreaches:
            raise RuntimeError("Não foi possível contatar os prestadores")

        now = self.now()
        transition(aggregate, RequestStatus.WAITING_FOR_REPLIES, now)
        aggregate.add_event(
            "operation",
            {
                "status": RequestStatus.WAITING_FOR_REPLIES.value,
                "title": "Aguardando respostas",
                "detail": f"{len(current_outreaches)} prestadores contatados por e-mail",
            },
            now,
        )
        aggregate.add_message(
            role="assistant",
            content=(
                "Pronto — enviei as solicitações. Atualizarei esta conversa assim que houver "
                "resposta."
            ),
            now=now,
        )
        await self._repository.save(aggregate)

    async def _process_provider_reply(
        self,
        *,
        aggregate: ConversationAggregate,
        provider_id: UUID,
        inbound_message_id: str,
        text: str,
    ) -> None:
        if aggregate.status not in {
            RequestStatus.WAITING_FOR_REPLIES,
            RequestStatus.OFFER_RECEIVED,
            RequestStatus.NEEDS_USER_INPUT,
        }:
            aggregate.processed_inbound_message_ids.add(inbound_message_id)
            await self._repository.save(aggregate)
            return

        now = self.now()
        safe_text = text.replace("\x00", "").strip()[:MAX_PROVIDER_REPLY_CHARS]
        if not safe_text:
            raise ValueError("Resposta do prestador está vazia")
        interpreted = await self._offer_interpreter.interpret(safe_text, now)
        if aggregate.status == RequestStatus.WAITING_FOR_REPLIES:
            transition(aggregate, RequestStatus.OFFER_RECEIVED, now)

        offer = ProviderOffer(
            conversation_id=aggregate.id,
            provider_id=provider_id,
            inbound_message_id=inbound_message_id,
            status=interpreted.status,
            price=interpreted.price,
            available_at=interpreted.available_at,
            question=interpreted.question,
            raw_text=safe_text,
            created_at=now,
        )
        evaluation = evaluate_offer(aggregate.request, offer)
        offer.within_budget = evaluation.within_budget
        offer.within_availability = evaluation.within_availability
        offer.acceptable = interpreted.status == OfferStatus.AVAILABLE and evaluation.acceptable
        aggregate.offers.append(offer)
        aggregate.processed_inbound_message_ids.add(inbound_message_id)
        aggregate.add_event("offer", {"offerId": str(offer.id)}, now)

        provider = next(
            (candidate for candidate in aggregate.providers if candidate.id == provider_id), None
        )
        provider_name = provider.name if provider else "Um prestador"
        if offer.acceptable:
            aggregate.pending_offer_id = offer.id
            if not aggregate.request.exact_address:
                transition(aggregate, RequestStatus.NEEDS_USER_INPUT, now)
                aggregate.add_message(
                    role="assistant",
                    content=(
                        f"{provider_name} enviou uma opção compatível. Para reservar, qual é o "
                        "endereço completo, com número e complemento?"
                    ),
                    now=now,
                )
                await self._repository.save(aggregate)
                return
            transition(aggregate, RequestStatus.ACCEPTED, now)
            await self._repository.save(aggregate)
            await self._book_offer(aggregate, offer)
            return

        replied_provider_ids = {item.provider_id for item in aggregate.offers}
        contacted_provider_ids = {item.provider_id for item in aggregate.outreaches}
        if contacted_provider_ids and contacted_provider_ids <= replied_provider_ids:
            transition(aggregate, RequestStatus.NEEDS_USER_INPUT, now)
            aggregate.add_message(
                role="assistant",
                content=(
                    "Recebi todas as respostas, mas nenhuma atende simultaneamente ao orçamento "
                    "e ao horário. Você quer ajustar algum desses critérios?"
                ),
                now=now,
            )
        else:
            transition(aggregate, RequestStatus.WAITING_FOR_REPLIES, now)
        await self._repository.save(aggregate)

    async def _maybe_advance_demo(self, aggregate: ConversationAggregate) -> None:
        if not self._demo_auto_reply or aggregate.status != RequestStatus.WAITING_FOR_REPLIES:
            return
        waiting_event = next(
            (
                event
                for event in reversed(aggregate.events)
                if event.event_type == "operation"
                and event.payload.get("status") == RequestStatus.WAITING_FOR_REPLIES.value
            ),
            None,
        )
        if (
            waiting_event is None
            or self.now() - waiting_event.created_at < self._demo_auto_reply_delay
        ):
            return
        outreach = next(
            (
                item
                for item in aggregate.outreaches
                if item.provider_id not in {offer.provider_id for offer in aggregate.offers}
            ),
            None,
        )
        if outreach is None or not aggregate.request.availability:
            return
        window = aggregate.request.availability[0]
        available_at = window.start + min(timedelta(minutes=30), (window.end - window.start) / 2)
        maximum = aggregate.request.budget.maximum if aggregate.request.budget else None
        price = min(maximum or 180.0, 180.0)
        reply = (
            f"Consigo atender em {available_at:%d/%m/%Y} às {available_at:%H:%M} "
            f"por R$ {price:.2f}."
        )
        await self._process_provider_reply(
            aggregate=aggregate,
            provider_id=outreach.provider_id,
            inbound_message_id=f"demo-auto-{aggregate.id.hex}-{outreach.provider_id.hex}",
            text=reply,
        )

    async def _book_offer(self, aggregate: ConversationAggregate, offer: ProviderOffer) -> None:
        if aggregate.booking is not None:
            return
        provider = next(
            (candidate for candidate in aggregate.providers if candidate.id == offer.provider_id),
            None,
        )
        if provider is None or offer.available_at is None or offer.price is None:
            raise RuntimeError("Oferta incompleta para reserva")
        address = aggregate.request.exact_address
        if address is None:
            raise RuntimeError("Endereço exato ausente")
        outreach = next(
            (item for item in aggregate.outreaches if item.provider_id == provider.id), None
        )
        attendee_email = outreach.destination if outreach else provider.email
        start = offer.available_at
        end = start + DEFAULT_BOOKING_DURATION
        now = self.now()
        try:
            aggregate.booking = await self._calendar_gateway.create_booking(
                conversation_id=aggregate.id,
                provider=provider,
                offer_id=offer.id,
                start=start,
                end=end,
                price=offer.price,
                address=address,
                attendee_email=attendee_email,
                now=now,
            )
            transition(aggregate, RequestStatus.BOOKED, now)
            aggregate.add_event("booking", {"bookingId": str(aggregate.booking.id)}, now)
            aggregate.add_message(
                role="assistant",
                content=(
                    f"Reserva confirmada com {provider.name} por R$ {offer.price:.2f}. "
                    "O compromisso já foi adicionado ao calendário."
                ),
                now=now,
            )
            await self._repository.save(aggregate)
        except ConcurrentConversationWriteError:
            raise
        except Exception:
            await self._fail(
                aggregate,
                code="booking_failed",
                message=(
                    "A oferta foi aceita, mas não consegui criar o compromisso. "
                    "Tente novamente para concluir a reserva."
                ),
            )

    async def _fail(self, aggregate: ConversationAggregate, *, code: str, message: str) -> None:
        now = self.now()
        if aggregate.status not in {RequestStatus.BOOKED, RequestStatus.FAILED}:
            transition(aggregate, RequestStatus.FAILED, now)
        aggregate.add_event("error", {"code": code, "message": message, "retryable": True}, now)
        aggregate.add_message(role="assistant", content=message, now=now)
        await self._repository.save(aggregate)


__all__ = [
    "ConversationLockedError",
    "ConversationNotFoundError",
    "ConversationOrchestrator",
    "ProviderReplyNotFoundError",
]
