"use client";

import {
  ArrowUp, CalendarDays, Check, ChevronDown, Circle, CircleDashed, Clock3,
  KeyRound, LocateFixed, MapPin, Menu, MessageSquare, Mic,
  MoreHorizontal, Paperclip, PanelLeftClose, PencilLine, Plus, Search,
  Settings, Star, UserRound, WalletCards, Wrench,
} from "lucide-react";
import type { ComponentType, FormEvent, KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  bookingResult, fieldFlowReducer, initialFlowState,
  type EditableField, type FlowStage, type ServiceRequest,
} from "@/lib/flow";

const starterSuggestions = [
  { label: "Encontrar um chaveiro perto de mim", hint: "Disponível agora", icon: KeyRound },
  { label: "Perdi minha chave", hint: "Resolver com urgência", icon: LocateFixed },
  { label: "Minha porta está travada", hint: "Buscar assistência", icon: Wrench },
  { label: "Chaveiro hoje à tarde", hint: "Comparar profissionais", icon: CalendarDays },
];

const problemOptions = ["Perdi a chave", "A porta travou", "A chave quebrou", "Outro problema"];
const budgetOptions = ["Até R$150", "Até R$200", "Até R$250", "Valor flexível"];

const fieldMeta: Record<
  EditableField,
  { label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }> }
> = {
  service: { label: "Serviço", icon: Wrench },
  location: { label: "Local", icon: MapPin },
  availability: { label: "Quando", icon: CalendarDays },
  problem: { label: "Problema", icon: KeyRound },
  budget: { label: "Orçamento", icon: WalletCards },
};

const activitySteps = [
  { label: "Pesquisando nas proximidades", detail: "Pinheiros", time: "09:42" },
  { label: "14 profissionais encontrados", detail: "abertos agora", time: "09:42" },
  { label: "3 candidatos selecionados", detail: "melhor compatibilidade", time: "09:43" },
  { label: "Profissionais contatados", detail: "3 mensagens enviadas", time: "09:43" },
  { label: "Aguardando respostas", detail: "", time: "" },
];

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true">F</span>;
}

function Sidebar({ open, onClose, onReset }: { open: boolean; onClose: () => void; onReset: () => void }) {
  return (
    <>
      <button className={`sidebar-backdrop ${open ? "is-visible" : ""}`} type="button" onClick={onClose} aria-label="Fechar menu" tabIndex={open ? 0 : -1} />
      <aside className={`sidebar ${open ? "is-open" : ""}`} aria-label="Navegação principal">
        <div className="sidebar-top">
          <button className="sidebar-brand pressable" type="button" onClick={onReset} aria-label="Ir para o início">
            <BrandMark /><span>FIELD</span>
          </button>
          <button className="icon-button sidebar-close pressable" type="button" onClick={onClose} aria-label="Recolher menu">
            <PanelLeftClose size={18} strokeWidth={1.7} />
          </button>
        </div>

        <button className="new-chat-button pressable" type="button" onClick={onReset}>
          <Plus size={17} strokeWidth={1.8} /><span>Nova solicitação</span><kbd>⌘ K</kbd>
        </button>

        <nav className="sidebar-nav" aria-label="Conversas recentes">
          <p>Recentes</p>
          <button className="history-item is-active" type="button">
            <MessageSquare size={15} strokeWidth={1.6} /><span>Chaveiro em Pinheiros</span><MoreHorizontal className="history-more" size={16} strokeWidth={1.7} />
          </button>
          <button className="history-item" type="button"><MessageSquare size={15} strokeWidth={1.6} /><span>Manutenção do ar-condicionado</span></button>
          <button className="history-item" type="button"><MessageSquare size={15} strokeWidth={1.6} /><span>Orçamento para encanador</span></button>
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-footer-item pressable" type="button"><Settings size={17} strokeWidth={1.6} /><span>Configurações</span></button>
          <button className="account-button pressable" type="button">
            <span className="account-avatar"><UserRound size={16} strokeWidth={1.7} /></span>
            <span><strong>Mario</strong><small>Plano pessoal</small></span><MoreHorizontal size={17} strokeWidth={1.7} />
          </button>
        </div>
      </aside>
    </>
  );
}

function ChatHeader({ stage, onOpenMenu, onReset }: { stage: string; onOpenMenu: () => void; onReset: () => void }) {
  const status = stage === "work" ? "Executando" : stage === "result" ? "Concluído" : "Online";
  const title = stage === "start" ? "FIELD" : "Chaveiro em Pinheiros";
  return (
    <header className="chat-header">
      <div className="chat-header-left">
        <button className="icon-button mobile-menu pressable" type="button" onClick={onOpenMenu} aria-label="Abrir menu"><Menu size={20} strokeWidth={1.7} /></button>
        <div className="chat-title">
          <strong className="header-state-copy" key={title}>{title}</strong>
          <span className={`chat-status is-${stage}`}><i /><span className="header-state-copy" key={status}>{status}</span></span>
        </div>
      </div>
      <button className="header-new-chat pressable" type="button" onClick={onReset}><Plus size={17} strokeWidth={1.8} /><span>Novo chat</span></button>
    </header>
  );
}

function Composer({ value, onChange, onSubmit, placeholder, autoFocus = false, quiet = false }: {
  value: string; onChange: (value: string) => void; onSubmit: () => void; placeholder: string; autoFocus?: boolean; quiet?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
  };
  useEffect(resize, [value]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (value.trim()) onSubmit(); };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (value.trim()) onSubmit(); }
  };

  return (
    <form className={`composer ${quiet ? "is-quiet" : ""}`} onSubmit={handleSubmit}>
      <textarea ref={textareaRef} rows={1} value={value} onChange={(event) => onChange(event.target.value)} onInput={resize} onKeyDown={handleKeyDown} placeholder={placeholder} aria-label={placeholder} autoFocus={autoFocus} />
      <div className="composer-toolbar">
        <div className="composer-tools">
          <button className="composer-icon pressable" type="button" aria-label="Anexar arquivo"><Paperclip size={18} strokeWidth={1.7} /></button>
          <button className="location-pill pressable" type="button" aria-label="Usar localização"><LocateFixed size={15} strokeWidth={1.8} /><span>Localização</span></button>
        </div>
        <div className="composer-actions">
          <button className="composer-icon pressable" type="button" aria-label="Usar microfone"><Mic size={18} strokeWidth={1.7} /></button>
          <button className="composer-submit pressable" type="submit" aria-label="Enviar mensagem" disabled={!value.trim()}><ArrowUp size={18} strokeWidth={2.2} /></button>
        </div>
      </div>
    </form>
  );
}

function ComposerDock({ children }: { children: ReactNode }) {
  return <div className="composer-dock">{children}<p>O FIELD pode cometer erros. Confirme informações importantes.</p></div>;
}

function StartScreen({ onStart }: { onStart: (message: string) => void }) {
  const [message, setMessage] = useState("");
  const submit = () => message.trim() && onStart(message);
  return (
    <section className="start-screen stage-panel" aria-labelledby="start-title">
      <div className="start-content">
        <div className="start-brand"><BrandMark /></div>
        <h1 id="start-title">O que vamos resolver hoje?</h1>
        <p>Descreva o que você precisa. Eu encontro, comparo e agendo o melhor profissional para você.</p>
        <div className="start-composer"><Composer value={message} onChange={setMessage} onSubmit={submit} placeholder="Peça qualquer serviço local" autoFocus /></div>
        <div className="suggestion-grid" aria-label="Sugestões">
          {starterSuggestions.map(({ label, hint, icon: Icon }) => (
            <button className="suggestion-card pressable" type="button" key={label} onClick={() => onStart(label)}>
              <span className="suggestion-icon"><Icon size={17} strokeWidth={1.7} /></span>
              <span className="suggestion-copy"><strong>{label}</strong><small>{hint}</small></span>
              <ArrowUp className="suggestion-arrow" size={15} strokeWidth={1.8} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function UserMessage({ children }: { children: ReactNode }) {
  return <div className="user-message-wrap"><div className="user-message">{children}</div></div>;
}

function AgentMessage({ children }: { children: ReactNode }) {
  return <div className="agent-message"><BrandMark /><div className="agent-content">{children}</div></div>;
}

function ParameterRow({ field, value, onChange }: { field: EditableField; value: string; onChange?: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const { label, icon: Icon } = fieldMeta[field];
  useEffect(() => setDraft(value), [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  const save = () => { if (draft.trim()) onChange?.(draft); else setDraft(value); setEditing(false); };

  return (
    <div className={`parameter-row ${!value ? "is-empty" : ""} ${!onChange ? "is-readonly" : ""}`}>
      <span className="parameter-icon"><Icon size={15} strokeWidth={1.7} /></span>
      <span className="parameter-copy"><small>{label}</small>
        <span className="parameter-value-swap" key={editing ? "editing" : "value"}>
          {editing ? (
            <input ref={inputRef} className="parameter-input" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={save} onKeyDown={(event) => {
              if (event.key === "Enter") save();
              if (event.key === "Escape") { setDraft(value); setEditing(false); }
            }} aria-label={`Editar ${label.toLowerCase()}`} />
          ) : <strong>{value || "Ainda não informado"}</strong>}
        </span>
      </span>
      {onChange && <button className="edit-parameter pressable" type="button" onClick={() => setEditing(true)} aria-label={`Alterar ${label.toLowerCase()}`}><PencilLine size={14} strokeWidth={1.7} /></button>}
    </div>
  );
}

function RequestSummary({ request, onUpdate, compact = false }: { request: ServiceRequest; onUpdate?: (field: EditableField, value: string) => void; compact?: boolean }) {
  if (compact) return (
    <div className="compact-request" aria-label="Resumo da solicitação">
      <span><MapPin size={14} />{request.location}</span><span><Clock3 size={14} />{request.availability}</span><span><WalletCards size={14} />{request.budget}</span>
    </div>
  );
  return (
    <section className="request-card" aria-labelledby="request-title">
      <div className="card-heading"><div><span className="card-kicker">SOLICITAÇÃO</span><h2 id="request-title">Detalhes entendidos</h2></div><span className="understood-badge"><Check size={13} strokeWidth={2.2} />Atualizado</span></div>
      <div className="parameter-list">{(Object.keys(fieldMeta) as EditableField[]).map((field) => (
        <ParameterRow key={field} field={field} value={request[field]} onChange={onUpdate ? (value) => onUpdate(field, value) : undefined} />
      ))}</div>
    </section>
  );
}

function OptionChips({ options, onSelect }: { options: string[]; onSelect: (value: string) => void }) {
  return <div className="option-chips">{options.map((option) => <button className="option-chip pressable" type="button" onClick={() => onSelect(option)} key={option}>{option}</button>)}</div>;
}

type ActiveStage = Exclude<FlowStage, "start">;
type CollectionQuestion = "problem" | "budget" | "ready";

function CollectContent({ request, question, historical, onUpdate, onAnswer, onBegin }: {
  request: ServiceRequest;
  question: CollectionQuestion;
  historical: boolean;
  onUpdate: (field: EditableField, value: string) => void;
  onAnswer: (value: string) => void;
  onBegin: () => void;
}) {
  return (
    <>
      <AgentMessage>
        <p>Entendi. Já organizei as informações que vieram na sua mensagem.</p>
        <p className="muted-copy">Você pode revisar e editar qualquer detalhe antes de eu começar.</p>
        <RequestSummary request={request} onUpdate={historical ? undefined : onUpdate} />
      </AgentMessage>
      {request.problem && <div className="thread-append"><UserMessage>{request.problem}</UserMessage></div>}
      {question === "problem" && <div className="thread-append"><AgentMessage><p>O que aconteceu com a fechadura?</p><p className="muted-copy">Isso me ajuda a encontrar o profissional certo.</p><OptionChips options={problemOptions} onSelect={onAnswer} /></AgentMessage></div>}
      {question === "budget" && <div className="thread-append"><AgentMessage><p>Perfeito. Quanto você gostaria de gastar?</p><OptionChips options={budgetOptions} onSelect={onAnswer} /></AgentMessage></div>}
      {request.budget && <div className="thread-append"><UserMessage>{request.budget}</UserMessage></div>}
      {question === "ready" && (
        <div className="thread-append">
          <AgentMessage>
            <p>Ótimo, tenho tudo o que preciso.</p>
            <p className="muted-copy">Posso comparar os profissionais disponíveis e cuidar do agendamento para você.</p>
            <div className="ready-actions">
              <span className="ready-state-swap" key={historical ? "started" : "ready"}>
                {historical ? <span className="search-started"><Check size={14} strokeWidth={2.1} />Busca iniciada</span> : (
                  <button className="primary-button pressable" type="button" onClick={onBegin}>
                    <Search size={16} strokeWidth={1.9} />
                    Começar busca
                  </button>
                )}
              </span>
              <span>Preço, disponibilidade e avaliações serão considerados.</span>
            </div>
          </AgentMessage>
        </div>
      )}
    </>
  );
}

function ActivityIcon({ status }: { status: "done" | "active" | "pending" }) {
  return (
    <span className="activity-icon-swap" key={status}>
      {status === "done" && <Check size={14} strokeWidth={2.2} />}
      {status === "active" && <CircleDashed className="activity-spinner" size={16} strokeWidth={1.8} />}
      {status === "pending" && <Circle size={13} strokeWidth={1.5} />}
    </span>
  );
}

function WorkContent({ request, phase, complete, onAdjust }: { request: ServiceRequest; phase: number; complete: boolean; onAdjust: () => void }) {
  const visiblePhase = complete ? activitySteps.length : phase;
  const currentLabel = complete ? "Busca concluída" : activitySteps[Math.min(phase, activitySteps.length - 1)].label;
  return (
    <AgentMessage>
      <p id="work-title">Pode deixar. Estou encontrando o melhor chaveiro para você.</p>
      <RequestSummary request={request} compact />
      <div className="activity-card" aria-live="polite" aria-label={`Progresso: ${currentLabel}`}>
        <div className="activity-heading"><span className={`work-icon ${complete ? "is-complete" : ""}`}>{complete ? <Check size={17} strokeWidth={2} /> : <Search size={17} strokeWidth={1.8} />}</span><div><strong>{complete ? "Busca concluída" : "Buscando profissionais"}</strong><small>{complete ? "Etapas finalizadas" : "Execução em tempo real"}</small></div><span className={`live-pill ${complete ? "is-complete" : ""}`}><i />{complete ? "CONCLUÍDO" : "AO VIVO"}</span></div>
        <div className="activity-list">{activitySteps.map((step, index) => {
          const status = index < visiblePhase ? "done" : index === visiblePhase ? "active" : "pending";
          return <div className={`activity-row is-${status}`} key={step.label}><span className="activity-status"><ActivityIcon status={status} /></span><div className="activity-copy"><span>{step.label}</span>{step.detail && <small>{step.detail}</small>}</div><time>{status === "done" && step.time && <span className="activity-time-copy" key={step.time}>{step.time}</span>}</time></div>;
        })}</div>
        <div className="activity-footer"><span>{complete ? "Busca finalizada e melhor opção selecionada." : "Você pode sair — eu aviso quando concluir."}</span>{!complete && <button type="button" onClick={onAdjust}>Ajustar pedido</button>}</div>
      </div>
    </AgentMessage>
  );
}

function ResultContent({ request, detailsOpen, onToggleDetails }: { request: ServiceRequest; detailsOpen: boolean; onToggleDetails: () => void }) {
  return (
    <AgentMessage>
      <div className="result-message-heading result-reveal"><span className="success-mark"><Check size={18} strokeWidth={2.3} /></span><div><span className="card-kicker">CONCLUÍDO</span><h1 id="result-title">Encontrei e reservei uma ótima opção.</h1></div></div>
      <p className="muted-copy result-reveal">O profissional confirmou o serviço dentro do seu orçamento e horário.</p>
      <article className="booking-card result-reveal">
        <div className="provider-heading"><span className="provider-icon"><KeyRound size={21} strokeWidth={1.8} /></span><div className="provider-copy"><div className="provider-name-line"><h2>{bookingResult.provider}</h2><span className="verified-badge"><Check size={10} strokeWidth={2.5} /></span></div><p><Star size={13} fill="currentColor" />{bookingResult.rating} <span>({bookingResult.reviewCount} avaliações) · {bookingResult.distance}</span></p></div><span className="confirmed-pill"><Check size={12} />Confirmado</span></div>
        <div className="booking-numbers"><div><span>PREÇO</span><strong>{bookingResult.price}</strong></div><div><span>CHEGADA</span><strong>{bookingResult.arrival}</strong></div><div><span>LOCAL</span><strong>Pinheiros</strong></div></div>
        <div className="compatibility-list"><span><Check size={14} />Dentro do seu orçamento</span><span><Check size={14} />Disponível hoje</span><span><Check size={14} />Prestador verificado</span></div>
        <button className="booking-action pressable" type="button" aria-expanded={detailsOpen} onClick={onToggleDetails}><span><CalendarDays size={16} />Ver compromisso</span><ChevronDown className={detailsOpen ? "is-rotated" : ""} size={17} /></button>
        {detailsOpen && <div className="appointment-details"><span><CalendarDays size={16} /><span><small>DATA E HORÁRIO</small>Hoje · 15:30–16:30</span></span><span><MapPin size={16} /><span><small>LOCAL</small>{request.location}</span></span></div>}
      </article>
      <div className="confirmation-card result-reveal"><span><Check size={15} /></span><div><strong>Tudo certo por aqui.</strong><p>Compromisso adicionado ao Google Calendar e confirmação enviada ao profissional.</p></div></div>
    </AgentMessage>
  );
}

function ActiveRequestScreen({ stage, originalRequest, request, phase, onUpdate, onBegin, onAdjust, onReset }: {
  stage: ActiveStage;
  originalRequest: string;
  request: ServiceRequest;
  phase: number;
  onUpdate: (field: EditableField, value: string) => void;
  onBegin: () => void;
  onAdjust: () => void;
  onReset: () => void;
}) {
  const [reply, setReply] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const followsLatestRef = useRef(true);
  const autoScrollingRef = useRef(false);
  const question: CollectionQuestion = !request.problem ? "problem" : !request.budget ? "budget" : "ready";
  const answer = (value: string) => {
    followsLatestRef.current = true;
    if (question === "problem") onUpdate("problem", value);
    if (question === "budget") onUpdate("budget", value);
    setReply("");
  };
  const submitReply = () => reply.trim() && question !== "ready" && answer(reply);
  const dockKey = stage === "collect" && question !== "ready" ? "collect-input" : `${stage}-${question}`;

  useEffect(() => {
    if (stage !== "result") setDetailsOpen(false);
  }, [stage]);

  useEffect(() => {
    const updateFollowState = () => {
      if (autoScrollingRef.current) return;
      const distanceFromBottom = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      followsLatestRef.current = distanceFromBottom < 180;
    };

    window.addEventListener("scroll", updateFollowState, { passive: true });
    return () => window.removeEventListener("scroll", updateFollowState);
  }, []);

  useEffect(() => {
    if (!followsLatestRef.current) return;

    let settleTimer = 0;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        autoScrollingRef.current = true;
        const anchor = transcriptEndRef.current;
        if (!anchor) {
          autoScrollingRef.current = false;
          return;
        }
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        anchor.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "end" });
        settleTimer = window.setTimeout(() => {
          autoScrollingRef.current = false;
        }, reduceMotion ? 0 : 420);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimer);
      autoScrollingRef.current = false;
    };
  }, [stage, question, detailsOpen]);

  return (
    <section className={`conversation-screen active-flow-screen stage-panel ${stage === "result" ? "result-screen" : ""}`} aria-label="Conversa">
      <div className="conversation-thread">
        <UserMessage>{originalRequest}</UserMessage>
        <div className="flow-transcript">
          <div className="thread-stage-entry is-collect">
            <CollectContent request={request} question={question} historical={stage !== "collect"} onUpdate={onUpdate} onAnswer={answer} onBegin={() => { followsLatestRef.current = true; onBegin(); }} />
          </div>
          {stage !== "collect" && (
            <div className="thread-stage-entry is-work">
              <WorkContent request={request} phase={phase} complete={stage === "result"} onAdjust={onAdjust} />
            </div>
          )}
          {stage === "result" && (
            <div className="thread-stage-entry is-result">
              <ResultContent request={request} detailsOpen={detailsOpen} onToggleDetails={() => { followsLatestRef.current = true; setDetailsOpen((open) => !open); }} />
            </div>
          )}
          <div className="transcript-end" ref={transcriptEndRef} aria-hidden="true" />
        </div>
      </div>
      <ComposerDock>
        <div className="dock-state" key={dockKey}>
          {stage === "collect" && question !== "ready" && <Composer value={reply} onChange={setReply} onSubmit={submitReply} placeholder="Responda ao FIELD" quiet />}
          {stage === "collect" && question === "ready" && <div className="ready-dock"><Check size={15} />Revise os detalhes ou comece a busca acima</div>}
          {stage === "work" && <div className="waiting-composer"><CircleDashed className="activity-spinner" size={16} />FIELD está trabalhando na sua solicitação</div>}
          {stage === "result" && <button className="new-request-cta pressable" type="button" onClick={onReset}><Plus size={17} />Fazer nova solicitação</button>}
        </div>
      </ComposerDock>
    </section>
  );
}

export function FieldApp() {
  const [state, dispatch] = useReducer(fieldFlowReducer, initialFlowState);
  const [activityPhase, setActivityPhase] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (state.stage !== "work") return;
    setActivityPhase(0);
    const timers = [
      window.setTimeout(() => setActivityPhase(1), 700), window.setTimeout(() => setActivityPhase(2), 1400),
      window.setTimeout(() => setActivityPhase(3), 2150), window.setTimeout(() => setActivityPhase(4), 3000),
      window.setTimeout(() => dispatch({ type: "SHOW_RESULT" }), 4300),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [state.stage]);

  const stageLabel = useMemo(() => ({ start: "Início", collect: "Coleta", work: "Execução", result: "Resultado" })[state.stage], [state.stage]);
  const reset = () => { dispatch({ type: "RESET" }); setSidebarOpen(false); };

  return (
    <div className="field-app">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onReset={reset} />
      <div className="chat-shell">
        <ChatHeader stage={state.stage} onOpenMenu={() => setSidebarOpen(true)} onReset={reset} />
        <main className="app-main">
          <span className="sr-only" aria-live="polite">Etapa atual: {stageLabel}</span>
          {state.stage === "start" && <StartScreen onStart={(message) => dispatch({ type: "START_REQUEST", message })} />}
          {state.stage !== "start" && <ActiveRequestScreen stage={state.stage} originalRequest={state.originalRequest} request={state.request} phase={activityPhase} onUpdate={(field, value) => dispatch({ type: "UPDATE_FIELD", field, value })} onBegin={() => dispatch({ type: "BEGIN_WORK" })} onAdjust={() => dispatch({ type: "RETURN_TO_COLLECTION" })} onReset={reset} />}
        </main>
      </div>
    </div>
  );
}
