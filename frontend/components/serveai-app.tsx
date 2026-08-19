"use client";

import {
  AlertTriangle,
  ArrowUp,
  CalendarDays,
  Check,
  CircleDashed,
  ExternalLink,
  KeyRound,
  LocateFixed,
  MapPin,
  Menu,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatComposer } from "@/components/chat-composer";
import type { BrowserLocation } from "@/lib/location";
import {
  createClientMessageId,
  ServeAIAPIError,
  ServeAIClient,
  type BookingCard as BookingCardData,
  type ChatConversation,
  type ErrorCard as ErrorCardData,
  type Location,
  type OfferCard as OfferCardData,
  type OperationCard as OperationCardData,
  type ProvidersCard as ProvidersCardData,
  type RequestStatus,
  type TimelineItem,
} from "@/lib/serveai";
import styles from "./serveai-app.module.css";

const starterSuggestions = [
  { label: "Encontrar um chaveiro perto de mim", hint: "Disponível agora", icon: KeyRound },
  { label: "Perdi minha chave", hint: "Resolver com urgência", icon: LocateFixed },
  { label: "Minha porta está travada", hint: "Buscar assistência", icon: Search },
  { label: "Chaveiro hoje à tarde", hint: "Comparar profissionais", icon: CalendarDays },
];

const statusLabels: Record<RequestStatus, string> = {
  collecting_requirements: "Entendendo a solicitação",
  ready: "Pronto para buscar",
  searching: "Buscando prestadores",
  providers_found: "Prestadores encontrados",
  contacting: "Contatando prestadores",
  waiting_for_replies: "Aguardando respostas",
  offer_received: "Oferta recebida",
  needs_user_input: "Aguardando você",
  accepted: "Confirmando reserva",
  booked: "Reserva concluída",
  failed: "Ação interrompida",
};

const activeOperationStatuses = new Set<RequestStatus>([
  "searching",
  "contacting",
  "waiting_for_replies",
  "accepted",
]);

type SubmitAction =
  | { kind: "create"; message: string; clientMessageId: string; location?: Location }
  | { kind: "message"; conversationId: string; message: string; clientMessageId: string };

interface RequestFailure {
  message: string;
  retryable: boolean;
  action: SubmitAction | { kind: "refresh"; conversationId: string };
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "A combinar";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Horário a combinar";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function safeExternalURL(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function toRequestLocation(location: BrowserLocation): Location {
  const labelParts = location.label
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const hasResolvedLabel = location.label !== "Localização atual";

  return {
    latitude: location.latitude,
    longitude: location.longitude,
    ...(hasResolvedLabel && labelParts.length > 1
      ? { neighborhood: labelParts[0], city: labelParts.slice(1).join(", ") }
      : hasResolvedLabel && labelParts.length === 1
        ? { city: labelParts[0] }
        : {}),
  };
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <img src="/serveai-logo.svg" alt="" />
    </span>
  );
}

function Sidebar({
  open,
  active,
  title,
  onClose,
  onReset,
}: {
  open: boolean;
  active: boolean;
  title: string;
  onClose: () => void;
  onReset: () => void;
}) {
  return (
    <>
      <button
        className={`sidebar-backdrop ${open ? "is-visible" : ""}`}
        type="button"
        onClick={onClose}
        aria-label="Fechar menu"
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
      />
      <aside className={`sidebar ${open ? "is-open" : ""}`} aria-label="Navegação principal">
        <div className="sidebar-top">
          <button className="sidebar-brand pressable" type="button" onClick={onReset} aria-label="Ir para o início">
            <BrandMark /><span>SERVEAI</span>
          </button>
          <button className="icon-button sidebar-close pressable" type="button" onClick={onClose} aria-label="Recolher menu">
            <PanelLeftClose size={18} strokeWidth={1.7} />
          </button>
        </div>

        <button className="new-chat-button pressable" type="button" onClick={onReset}>
          <Plus size={17} strokeWidth={1.8} /><span>Nova solicitação</span><kbd>⌘ K</kbd>
        </button>

        <nav className="sidebar-nav" aria-label="Conversa atual">
          <p>Conversa atual</p>
          {active ? (
            <button className="history-item is-active" type="button" onClick={onClose}>
              <MessageSquare size={15} strokeWidth={1.6} /><span>{title}</span><MoreHorizontal className="history-more" size={16} strokeWidth={1.7} />
            </button>
          ) : (
            <span className={styles.emptyHistory}>Sua próxima solicitação aparecerá aqui.</span>
          )}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-footer-item" type="button" disabled aria-label="Configurações indisponíveis">
            <Settings size={17} strokeWidth={1.6} /><span>Configurações</span>
          </button>
          <div className="account-button">
            <span className="account-avatar"><UserRound size={16} strokeWidth={1.7} /></span>
            <span><strong>ServeAI Online</strong><small>API conectada</small></span>
          </div>
        </div>
      </aside>
    </>
  );
}

function ChatHeader({
  status,
  active,
  title,
  onOpenMenu,
  onReset,
}: {
  status?: RequestStatus;
  active: boolean;
  title: string;
  onOpenMenu: () => void;
  onReset: () => void;
}) {
  const label = status ? statusLabels[status] : "Online";
  const working = status ? activeOperationStatuses.has(status) : false;
  return (
    <header className="chat-header">
      <div className="chat-header-left">
        <button className="icon-button mobile-menu pressable" type="button" onClick={onOpenMenu} aria-label="Abrir menu">
          <Menu size={20} strokeWidth={1.7} />
        </button>
        <div className="chat-title">
          <strong>{active ? title : "ServeAI"}</strong>
          <span className={`chat-status ${working ? "is-work" : ""} ${status === "failed" ? "is-failed" : ""}`}>
            <i />{label}
          </span>
        </div>
      </div>
      <button className="header-new-chat pressable" type="button" onClick={onReset}>
        <Plus size={17} strokeWidth={1.8} /><span>Novo chat</span>
      </button>
    </header>
  );
}

function StartScreen({
  onStart,
  initialMessage,
  location,
  onLocation,
}: {
  onStart: (message: string) => void;
  initialMessage: string;
  location?: BrowserLocation;
  onLocation: (location: BrowserLocation) => void;
}) {
  const [message, setMessage] = useState(initialMessage);

  return (
    <section className="start-screen stage-panel" aria-labelledby="start-title">
      <div className="start-content">
        <div className="start-brand"><BrandMark /></div>
        <h1 id="start-title">O que vamos resolver hoje?</h1>
        <p>Descreva o que você precisa. Eu encontro, comparo e agendo o melhor profissional para você.</p>
        <div className="start-composer">
          <ChatComposer
            value={message}
            onChange={setMessage}
            onSubmit={() => onStart(message)}
            placeholder="Peça qualquer serviço local"
            autoFocus
            location={location}
            onLocation={onLocation}
          />
        </div>
        <div className="suggestion-grid">
          {starterSuggestions.map(({ label, hint, icon: Icon }) => (
            <button className="suggestion-card pressable" type="button" key={label} onClick={() => onStart(label)}>
              <span className="suggestion-icon"><Icon size={17} strokeWidth={1.7} aria-hidden="true" /></span>
              <span className="suggestion-copy"><strong>{label}</strong><small>{hint}</small></span>
              <ArrowUp className="suggestion-arrow" size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function OperationItem({ item, currentStatus }: { item: OperationCardData; currentStatus?: RequestStatus }) {
  const active = item.status === currentStatus && activeOperationStatuses.has(item.status);
  return (
    <article className={styles.operationCard} aria-label={item.title}>
      <span className={styles.operationIcon}>
        {active ? (
          <CircleDashed className="activity-spinner" size={18} strokeWidth={1.7} aria-hidden="true" />
        ) : (
          <Check size={17} strokeWidth={2} aria-hidden="true" />
        )}
      </span>
      <div>
        <strong>{item.title}</strong>
        {item.detail && <p>{item.detail}</p>}
      </div>
    </article>
  );
}

function ProvidersItem({ item }: { item: ProvidersCardData }) {
  return (
    <article className={styles.timelineCard}>
      <div className={styles.cardTitle}>
        <div className="provider-copy">
          <p className="card-kicker">CANDIDATOS SELECIONADOS</p>
          <h2>{item.providers.length} prestadores encontrados</h2>
        </div>
        <Search size={19} strokeWidth={1.7} aria-hidden="true" />
      </div>
      <div className={styles.providerList}>
        {item.providers.map((provider, index) => {
          const website = safeExternalURL(provider.website);
          const phone = provider.phone?.replace(/[^+\d]/g, "") || null;
          return (
            <div className={styles.providerRow} key={provider.id}>
              <span className={styles.providerRank}>{index + 1}</span>
              <div className={styles.providerCopy}>
                <strong>{provider.name}</strong>
                <p><MapPin size={12} strokeWidth={1.6} />{provider.address}</p>
                {provider.rating != null && (
                  <small><Star size={12} fill="currentColor" />{provider.rating.toFixed(1)}{provider.reviewCount != null ? ` (${provider.reviewCount})` : ""}</small>
                )}
              </div>
              <div className={styles.providerLinks}>
                {phone && <a href={`tel:${phone}`} aria-label={`Ligar para ${provider.name}`}>Ligar</a>}
                {website && <a href={website} target="_blank" rel="noreferrer" aria-label={`Abrir site de ${provider.name}`}>Site</a>}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function Compatibility({ ok, label }: { ok: boolean | null | undefined; label: string }) {
  return (
    <div className={ok === false ? styles.incompatible : ok == null ? styles.unverified : undefined}>
      {ok === false ? (
        <AlertTriangle size={15} aria-hidden="true" />
      ) : ok === true ? (
        <Check size={15} strokeWidth={2} aria-hidden="true" />
      ) : (
        <CircleDashed size={15} aria-hidden="true" />
      )}
      <span>{label}</span>
    </div>
  );
}

function OfferItem({ item }: { item: OfferCardData }) {
  return (
    <article className={styles.timelineCard}>
      <div className={styles.cardTitle}>
        <div>
          <p className="card-kicker">OFERTA RECEBIDA</p>
          <h2>{item.providerName}</h2>
        </div>
        <span className={item.acceptable ? styles.acceptedBadge : styles.reviewBadge}>
          {item.acceptable ? "Compatível" : "Fora dos critérios"}
        </span>
      </div>
      <div className={styles.offerNumbers}>
        <div><span>PREÇO</span><strong>{formatCurrency(item.price)}</strong></div>
        <div><span>DISPONIBILIDADE</span><strong>{formatDateTime(item.availableAt)}</strong></div>
      </div>
      <div className="compatibility-list">
        <Compatibility ok={item.withinBudget} label="Compatibilidade com o orçamento" />
        <Compatibility ok={item.withinAvailability} label="Compatibilidade com a disponibilidade" />
      </div>
    </article>
  );
}

function BookingItem({ item }: { item: BookingCardData }) {
  const calendarEventURL = safeExternalURL(item.calendarEventUrl);
  return (
    <article className="booking-card">
      <div className="provider-heading">
        <span className="provider-icon"><KeyRound size={23} strokeWidth={1.7} aria-hidden="true" /></span>
        <div className="provider-copy">
          <div className="provider-name-line">
            <h2>{item.providerName}</h2>
            <span className="verified-badge" aria-label="Reserva confirmada"><Check size={11} strokeWidth={2.3} /></span>
          </div>
          <small>Prestador confirmado pelo ServeAI</small>
        </div>
      </div>

      <div className={styles.bookingFacts}>
        <div><CalendarDays size={16} /><span><small>DATA E HORÁRIO</small>{formatDateTime(item.start)}–{new Date(item.end).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></div>
        <div><MapPin size={16} /><span><small>LOCAL</small>{item.address}</span></div>
        <div><span className={styles.currencyMark}>R$</span><span><small>PREÇO</small>{formatCurrency(item.price)}</span></div>
      </div>

      {calendarEventURL && (
        <a className={`primary-button ${styles.calendarLink}`} href={calendarEventURL} target="_blank" rel="noreferrer">
          Ver compromisso <ExternalLink size={16} />
        </a>
      )}
    </article>
  );
}

function ErrorItem({ item, onRetry }: { item: ErrorCardData; onRetry: () => void }) {
  return (
    <article className={styles.errorCard} role="alert">
      <span><AlertTriangle size={18} strokeWidth={1.8} aria-hidden="true" /></span>
      <div>
        <strong>Não conseguimos concluir esta etapa</strong>
        <p>{item.message}</p>
      </div>
      {item.retryable && (
        <button className="secondary-button pressable" type="button" onClick={onRetry}>
          <RefreshCw size={14} />Tentar novamente
        </button>
      )}
    </article>
  );
}

function TimelineItemView({
  item,
  currentStatus,
  onRetry,
}: {
  item: TimelineItem;
  currentStatus?: RequestStatus;
  onRetry: () => void;
}) {
  switch (item.type) {
    case "message":
      return item.role === "user" ? (
        <div className="user-message-wrap">
          <div className="user-message">{item.content}</div>
        </div>
      ) : (
        <div className="agent-message">
          <BrandMark />
          <div className="agent-content"><p className={styles.agentBubble}>{item.content}</p></div>
        </div>
      );
    case "operation":
      return <OperationItem item={item} currentStatus={currentStatus} />;
    case "providers":
      return <ProvidersItem item={item} />;
    case "offer":
      return <OfferItem item={item} />;
    case "booking":
      return <BookingItem item={item} />;
    case "error":
      return <ErrorItem item={item} onRetry={onRetry} />;
  }
}

function ThinkingIndicator() {
  return (
    <div className={styles.thinking} role="status" aria-live="polite">
      <span aria-hidden="true"><i /><i /><i /></span>
      ServeAI está pensando...
    </div>
  );
}

function isToolResult(item: TimelineItem): boolean {
  return item.type === "operation" || item.type === "providers" || item.type === "offer" || item.type === "booking";
}

function ConversationScreen({
  conversation,
  pendingMessage,
  isPosting,
  draft,
  onDraftChange,
  onSubmit,
  failure,
  onRetry,
}: {
  conversation: ChatConversation | null;
  pendingMessage: string | null;
  isPosting: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  failure: RequestFailure | null;
  onRetry: () => void;
}) {
  const threadEnd = useRef<HTMLDivElement>(null);
  const scheduledToolIds = useRef(new Set<string>());
  const revealTimers = useRef<number[]>([]);
  const nextRevealAt = useRef(0);
  const [revealedToolIds, setRevealedToolIds] = useState<Set<string>>(() => new Set());
  const timeline = conversation?.timeline ?? [];

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversation?.updatedAt, failure, isPosting, revealedToolIds.size]);

  useEffect(() => {
    const now = Date.now();
    for (const item of timeline) {
      if (!isToolResult(item) || scheduledToolIds.current.has(item.id)) continue;
      scheduledToolIds.current.add(item.id);
      const delay = Math.max(350, nextRevealAt.current - now);
      nextRevealAt.current = now + delay + 900;
      const timer = window.setTimeout(() => {
        setRevealedToolIds((current) => new Set(current).add(item.id));
      }, delay);
      revealTimers.current.push(timer);
    }
  }, [timeline]);

  useEffect(() => () => {
    for (const timer of revealTimers.current) window.clearTimeout(timer);
  }, []);

  const canSend = Boolean(conversation?.canSendMessage) && !isPosting;
  const placeholder = !conversation
    ? "Iniciando conversa..."
    : conversation.status === "booked"
      ? "Solicitação concluída"
      : conversation.canSendMessage
        ? "Responda ao ServeAI..."
        : "O ServeAI está cuidando desta etapa...";

  return (
    <section className={`conversation-screen stage-panel ${styles.conversation}`} aria-label="Conversa com o ServeAI">
      <div className={`conversation-thread ${styles.thread}`} aria-live="polite">
        {timeline.map((item) => {
          if (isToolResult(item) && !revealedToolIds.has(item.id)) return null;
          if (isToolResult(item)) {
            return (
              <div className={styles.toolReveal} key={item.id}>
                <TimelineItemView
                  item={item}
                  currentStatus={conversation?.status}
                  onRetry={onRetry}
                />
              </div>
            );
          }
          return (
            <TimelineItemView
              key={item.id}
              item={item}
              currentStatus={conversation?.status}
              onRetry={onRetry}
            />
          );
        })}
        {pendingMessage && (
          <div className="user-message-wrap">
            <div className="user-message">{pendingMessage}</div>
          </div>
        )}
        {isPosting && <ThinkingIndicator />}
        {failure && (
          <article className={styles.requestError} role="alert">
            <AlertTriangle size={18} />
            <div><strong>Algo não saiu como esperado.</strong><p>{failure.message}</p></div>
            {failure.retryable && (
              <button className="secondary-button pressable" type="button" onClick={onRetry}>
                <RefreshCw size={14} />Tentar novamente
              </button>
            )}
          </article>
        )}
        <div ref={threadEnd} />
      </div>

      <div className={`composer-dock ${styles.chatComposer}`}>
        <ChatComposer
          value={draft}
          onChange={onDraftChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
          disabled={!canSend}
          busy={isPosting}
        />
        <p>O ServeAI pode cometer erros. Confirme informações importantes.</p>
      </div>
    </section>
  );
}

export function ServeAIApp({ initialMessage = "" }: { initialMessage?: string }) {
  const initialDraft = useRef(initialMessage.trim().slice(0, 4_000)).current;
  const client = useMemo(() => new ServeAIClient(), []);
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  const [failure, setFailure] = useState<RequestFailure | null>(null);
  const [location, setLocation] = useState<BrowserLocation>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pollRevision, setPollRevision] = useState(0);
  const session = useRef(0);

  const runSubmit = useCallback(async (action: SubmitAction) => {
    const currentSession = session.current;
    setFailure(null);
    setPendingMessage(action.message);
    setIsPosting(true);
    try {
      const snapshot = action.kind === "create"
        ? await client.createConversation({
            message: action.message,
            clientMessageId: action.clientMessageId,
            ...(action.location ? { location: action.location } : {}),
          })
        : await client.continueConversation(conversation!, {
            message: action.message,
            clientMessageId: action.clientMessageId,
          });
      if (session.current !== currentSession) return;
      setConversation(snapshot);
      setPendingMessage(null);
    } catch (error) {
      if (session.current !== currentSession) return;
      const apiError = error instanceof ServeAIAPIError ? error : null;
      setFailure({
        action,
        message: apiError?.message ?? "Não foi possível concluir esta ação.",
        retryable: apiError?.retryable ?? true,
      });
    } finally {
      if (session.current === currentSession) setIsPosting(false);
    }
  }, [client, conversation]);

  const refresh = useCallback(async (conversationId: string) => {
    const currentSession = session.current;
    setFailure(null);
    try {
      const snapshot = await client.getConversation(conversationId);
      if (session.current === currentSession) {
        setConversation(snapshot);
        // Keep polling even when a snapshot has the same updatedAt value.
        setPollRevision((revision) => revision + 1);
      }
    } catch (error) {
      if (session.current !== currentSession) return;
      const apiError = error instanceof ServeAIAPIError ? error : null;
      setFailure({
        action: { kind: "refresh", conversationId },
        message: apiError?.message ?? "Não foi possível atualizar a conversa.",
        retryable: apiError?.retryable ?? true,
      });
    }
  }, [client]);

  useEffect(() => {
    if (!conversation?.pollAfterMs || isPosting || failure) return;
    const timer = window.setTimeout(() => void refresh(conversation.conversationId), conversation.pollAfterMs);
    return () => window.clearTimeout(timer);
  }, [conversation?.conversationId, conversation?.pollAfterMs, failure, isPosting, pollRevision, refresh]);

  const start = (message: string) => {
    const cleanMessage = message.trim();
    if (!cleanMessage || isPosting) return;
    setDraft("");
    void runSubmit({
      kind: "create",
      message: cleanMessage,
      clientMessageId: createClientMessageId(),
      ...(location ? { location: toRequestLocation(location) } : {}),
    });
  };

  const sendMessage = () => {
    const cleanMessage = draft.trim();
    if (!conversation || !conversation.canSendMessage || !cleanMessage || isPosting) return;
    setDraft("");
    void runSubmit({
      kind: "message",
      conversationId: conversation.conversationId,
      message: cleanMessage,
      clientMessageId: createClientMessageId(),
    });
  };

  const retry = () => {
    if (!failure) {
      if (conversation?.status === "failed" && conversation.canSendMessage) {
        void runSubmit({
          kind: "message",
          conversationId: conversation.conversationId,
          message: "Tentar novamente",
          clientMessageId: createClientMessageId(),
        });
      } else if (conversation) {
        void refresh(conversation.conversationId);
      }
      return;
    }
    if (failure.action.kind === "refresh") void refresh(failure.action.conversationId);
    else void runSubmit(failure.action);
  };

  const reset = useCallback(() => {
    session.current += 1;
    setConversation(null);
    setDraft("");
    setPendingMessage(null);
    setIsPosting(false);
    setFailure(null);
    setLocation(undefined);
    setSidebarOpen(false);
    setPollRevision(0);
  }, []);

  useEffect(() => {
    const startNewConversation = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        reset();
      }
    };
    window.addEventListener("keydown", startNewConversation);
    return () => window.removeEventListener("keydown", startNewConversation);
  }, [reset]);

  const active = Boolean(conversation || pendingMessage);
  const requestLocation = conversation?.serviceRequest.location;
  const locationLabel = requestLocation?.neighborhood ?? requestLocation?.city;
  const serviceLabel = conversation?.serviceRequest.serviceType;
  const conversationTitle = serviceLabel
    ? `${serviceLabel}${locationLabel ? ` em ${locationLabel}` : ""}`
    : active ? "Nova solicitação" : "ServeAI";

  return (
    <div className="serveai-app">
      <Sidebar
        open={sidebarOpen}
        active={active}
        title={conversationTitle}
        onClose={() => setSidebarOpen(false)}
        onReset={reset}
      />
      <div className="chat-shell">
        <ChatHeader
          status={conversation?.status}
          active={active}
          title={conversationTitle}
          onOpenMenu={() => setSidebarOpen(true)}
          onReset={reset}
        />
        <main className="app-main">
          {!active ? (
            <StartScreen
              onStart={start}
              initialMessage={initialDraft}
              location={location}
              onLocation={setLocation}
            />
          ) : (
            <ConversationScreen
              conversation={conversation}
              pendingMessage={pendingMessage}
              isPosting={isPosting}
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={sendMessage}
              failure={failure}
              onRetry={retry}
            />
          )}
        </main>
      </div>
    </div>
  );
}
