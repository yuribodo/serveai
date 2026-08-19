"use client";

import {
  ArrowUp,
  CalendarDays,
  Check,
  ChevronDown,
  Circle,
  CircleDashed,
  Clock3,
  KeyRound,
  LocateFixed,
  MapPin,
  Mic,
  PencilLine,
  RotateCcw,
  Search,
  Star,
  WalletCards,
  Wrench,
} from "lucide-react";
import type { ComponentType, FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  bookingResult,
  fieldFlowReducer,
  initialFlowState,
  isRequestReady,
  type EditableField,
  type ServiceRequest,
} from "@/lib/flow";

const starterSuggestions = [
  { label: "Chaveiro perto de mim", icon: KeyRound },
  { label: "Perdi minha chave", icon: LocateFixed },
  { label: "Chaveiro hoje à tarde", icon: Clock3 },
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
  { label: "Encontrados 14 profissionais", detail: "abertos agora", time: "09:42" },
  { label: "Selecionados 3 bons candidatos", detail: "melhor compatibilidade", time: "09:43" },
  { label: "Entramos em contato com 3", detail: "por e-mail", time: "09:43" },
  { label: "Aguardando respostas", detail: "", time: "" },
];

function Header({ stage, onReset }: { stage: string; onReset: () => void }) {
  return (
    <header className="app-header">
      <div className="header-inner">
        <button className="wordmark pressable" type="button" onClick={onReset} aria-label="Ir para o início">
          FIELD
        </button>
        <div className="header-context" aria-label={`Etapa atual: ${stage}`}>
          {stage === "start" ? "AGENTE PARA SERVIÇOS LOCAIS" : "TAREFA EM ANDAMENTO"}
        </div>
        {stage !== "start" ? (
          <button className="new-task pressable" type="button" onClick={onReset}>
            <RotateCcw size={15} strokeWidth={1.7} aria-hidden="true" />
            <span>Nova solicitação</span>
          </button>
        ) : (
          <span className="header-status"><span aria-hidden="true" />Disponível</span>
        )}
      </div>
    </header>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus = false,
  onEnterKey,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  autoFocus?: boolean;
  onEnterKey?: () => void;
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") onEnterKey?.();
  };

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
      />
      <button className="composer-utility pressable" type="button" aria-label="Usar microfone">
        <Mic size={18} strokeWidth={1.6} aria-hidden="true" />
      </button>
      <button
        className="composer-submit pressable"
        type="submit"
        aria-label="Enviar mensagem"
        disabled={!value.trim()}
      >
        <ArrowUp size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    </form>
  );
}

function StartScreen({
  onStart,
  onKeyboardStart,
}: {
  onStart: (message: string) => void;
  onKeyboardStart: () => void;
}) {
  const [message, setMessage] = useState("");

  const submit = () => {
    if (message.trim()) onStart(message);
  };

  return (
    <section className="start-screen stage-panel" aria-labelledby="start-title">
      <div className="start-copy">
        <p className="overline">PEÇA UMA VEZ. O FIELD RESOLVE.</p>
        <h1 id="start-title">O que você precisa?</h1>
        <p>
          Descreva o serviço. Nós encontramos, entramos em contato e cuidamos do agendamento.
        </p>
      </div>

      <div className="start-actions">
        <Composer
          value={message}
          onChange={setMessage}
          onSubmit={submit}
          onEnterKey={onKeyboardStart}
          placeholder="Conte ao FIELD o que você precisa..."
          autoFocus
        />
        <button
          className="location-action pressable"
          type="button"
          onClick={() => setMessage("Preciso de um chaveiro em Pinheiros hoje à tarde")}
        >
          <LocateFixed size={16} strokeWidth={1.7} aria-hidden="true" />
          Usar minha localização
        </button>
      </div>

      <div className="suggestion-section" aria-labelledby="suggestions-title">
        <p id="suggestions-title">EXPERIMENTE</p>
        <div className="suggestion-grid">
          {starterSuggestions.map(({ label, icon: Icon }) => (
            <button className="suggestion-card pressable" type="button" key={label} onClick={() => onStart(label)}>
              <span className="suggestion-icon"><Icon size={17} strokeWidth={1.6} aria-hidden="true" /></span>
              <span>{label}</span>
              <ArrowUp className="suggestion-arrow" size={15} strokeWidth={1.7} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ParameterRow({
  field,
  value,
  onChange,
}: {
  field: EditableField;
  value: string;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const { label, icon: Icon } = fieldMeta[field];

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = () => {
    if (draft.trim()) onChange(draft);
    else setDraft(value);
    setEditing(false);
  };

  return (
    <div className={`parameter-row ${!value ? "is-empty" : ""}`}>
      <Icon size={16} strokeWidth={1.6} aria-hidden="true" />
      <span className="parameter-label">{label}</span>
      {editing ? (
        <input
          ref={inputRef}
          className="parameter-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
            if (event.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
          aria-label={`Editar ${label.toLowerCase()}`}
        />
      ) : (
        <span className="parameter-value">{value || "Ainda não informado"}</span>
      )}
      <button
        className="edit-parameter pressable"
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Alterar ${label.toLowerCase()}`}
      >
        <PencilLine size={14} strokeWidth={1.7} aria-hidden="true" />
        <span>Alterar</span>
      </button>
    </div>
  );
}

function RequestSummary({
  request,
  onUpdate,
  compact = false,
}: {
  request: ServiceRequest;
  onUpdate?: (field: EditableField, value: string) => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="compact-request" aria-label="Resumo da solicitação">
        <div><MapPin size={15} strokeWidth={1.6} aria-hidden="true" /><span>{request.location}</span></div>
        <div><Clock3 size={15} strokeWidth={1.6} aria-hidden="true" /><span>{request.availability}</span></div>
        <div><WalletCards size={15} strokeWidth={1.6} aria-hidden="true" /><span>{request.budget}</span></div>
        <div><KeyRound size={15} strokeWidth={1.6} aria-hidden="true" /><span>{request.service}</span></div>
      </div>
    );
  }

  return (
    <section className="request-card" aria-labelledby="request-title">
      <div className="card-heading">
        <div>
          <p className="card-kicker">SOLICITAÇÃO</p>
          <h2 id="request-title">O que entendemos</h2>
        </div>
        <span className="understood-badge"><Check size={13} strokeWidth={2} aria-hidden="true" />Em edição</span>
      </div>
      <div className="parameter-list">
        {(Object.keys(fieldMeta) as EditableField[]).map((field) => (
          <ParameterRow
            key={field}
            field={field}
            value={request[field]}
            onChange={(value) => onUpdate?.(field, value)}
          />
        ))}
      </div>
    </section>
  );
}

function OptionChips({ options, onSelect }: { options: string[]; onSelect: (value: string) => void }) {
  return (
    <div className="option-chips">
      {options.map((option) => (
        <button className="option-chip pressable" type="button" onClick={() => onSelect(option)} key={option}>
          {option}
        </button>
      ))}
    </div>
  );
}

function CollectScreen({
  originalRequest,
  request,
  onUpdate,
  onBegin,
}: {
  originalRequest: string;
  request: ServiceRequest;
  onUpdate: (field: EditableField, value: string) => void;
  onBegin: () => void;
}) {
  const [reply, setReply] = useState("");
  const question = !request.problem ? "problem" : !request.budget ? "budget" : "ready";

  const answer = (value: string) => {
    if (question === "problem") onUpdate("problem", value);
    if (question === "budget") onUpdate("budget", value);
    setReply("");
  };

  const submitReply = () => {
    if (reply.trim() && question !== "ready") answer(reply);
  };

  return (
    <section className="conversation-screen stage-panel" aria-label="Coleta de informações">
      <div className="conversation-thread">
        <div className="user-message-wrap">
          <div className="user-message">{originalRequest}</div>
          <span className="message-time">AGORA</span>
        </div>

        <div className="agent-message">
          <p>Entendi. Organizei o que você já informou.</p>
          <span>Confira os detalhes — você pode ajustar qualquer item.</span>
        </div>

        <RequestSummary request={request} onUpdate={onUpdate} />

        <div className="agent-question" aria-live="polite">
          {question === "problem" && (
            <>
              <p className="question-count">SÓ MAIS DUAS INFORMAÇÕES</p>
              <h2>O que aconteceu com a fechadura?</h2>
              <OptionChips options={problemOptions} onSelect={answer} />
            </>
          )}
          {question === "budget" && (
            <>
              <p className="question-count">ÚLTIMA INFORMAÇÃO</p>
              <h2>Quanto você gostaria de gastar?</h2>
              <OptionChips options={budgetOptions} onSelect={answer} />
            </>
          )}
          {question === "ready" && (
            <div className="ready-block">
              <span className="ready-icon"><Check size={18} strokeWidth={2} aria-hidden="true" /></span>
              <div>
                <h2>Tenho tudo o que preciso.</h2>
                <p>Vou procurar profissionais que atendam dentro dessas condições.</p>
              </div>
              <button className="primary-button pressable" type="button" onClick={onBegin}>
                Encontrar chaveiro
                <Search size={17} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>

      {question !== "ready" && (
        <div className="sticky-composer">
          <Composer
            value={reply}
            onChange={setReply}
            onSubmit={submitReply}
            placeholder="Responda aqui..."
          />
          <p>O FIELD pode cometer erros. Confirme informações importantes.</p>
        </div>
      )}
    </section>
  );
}

function ActivityIcon({ status }: { status: "done" | "active" | "pending" }) {
  if (status === "done") return <Check size={15} strokeWidth={2.1} aria-hidden="true" />;
  if (status === "active") return <CircleDashed className="activity-spinner" size={16} strokeWidth={1.7} aria-hidden="true" />;
  return <Circle size={14} strokeWidth={1.5} aria-hidden="true" />;
}

function WorkScreen({
  request,
  phase,
  onAdjust,
}: {
  request: ServiceRequest;
  phase: number;
  onAdjust: () => void;
}) {
  const currentLabel = activitySteps[Math.min(phase, activitySteps.length - 1)].label;

  return (
    <section className="work-screen stage-panel" aria-labelledby="work-title">
      <RequestSummary request={request} compact />

      <div className="work-heading">
        <span className="work-icon"><Search size={19} strokeWidth={1.7} aria-hidden="true" /></span>
        <div>
          <p className="card-kicker">FIELD ESTÁ TRABALHANDO</p>
          <h1 id="work-title">Encontrando um chaveiro</h1>
          <p>Buscando profissionais verificados que atendam às suas condições.</p>
        </div>
      </div>

      <div className="activity-card" aria-live="polite" aria-label={`Progresso: ${currentLabel}`}>
        {activitySteps.map((step, index) => {
          const status = index < phase ? "done" : index === phase ? "active" : "pending";
          return (
            <div className={`activity-row is-${status}`} key={step.label}>
              <span className="activity-status"><ActivityIcon status={status} /></span>
              <div className="activity-copy">
                <span>{step.label}</span>
                {step.detail && <small>{step.detail}</small>}
              </div>
              <time>{status === "done" ? step.time : ""}</time>
            </div>
          );
        })}
      </div>

      <div className="autonomy-note">
        <p>Você não precisa ficar aqui.</p>
        <span>Avisaremos assim que alguém responder.</span>
      </div>

      <button className="secondary-button pressable" type="button" onClick={onAdjust}>
        <PencilLine size={15} strokeWidth={1.7} aria-hidden="true" />
        Ajustar solicitação
      </button>
    </section>
  );
}

function ResultScreen({ onReset }: { onReset: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <section className="result-screen stage-panel" aria-labelledby="result-title">
      <div className="result-intro">
        <span className="success-mark"><Check size={23} strokeWidth={2.2} aria-hidden="true" /></span>
        <p className="card-kicker">RESOLVIDO</p>
        <h1 id="result-title">Reservado com sucesso.</h1>
        <p>Encontramos uma opção dentro das suas preferências e cuidamos do agendamento.</p>
      </div>

      <article className="booking-card">
        <div className="provider-heading">
          <span className="provider-icon"><KeyRound size={23} strokeWidth={1.7} aria-hidden="true" /></span>
          <div>
            <div className="provider-name-line">
              <h2>{bookingResult.provider}</h2>
              <span className="verified-badge" aria-label="Prestador verificado"><Check size={11} strokeWidth={2.3} /></span>
            </div>
            <p><Star size={14} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />{bookingResult.rating} <span>({bookingResult.reviewCount} avaliações)</span></p>
            <small>{bookingResult.distance} de você</small>
          </div>
        </div>

        <div className="booking-numbers">
          <div><span>PREÇO</span><strong>{bookingResult.price}</strong></div>
          <div><span>CHEGADA</span><strong>{bookingResult.arrival}</strong></div>
          <div><span>AVALIAÇÃO</span><strong>{bookingResult.rating} <Star size={15} fill="currentColor" /></strong></div>
        </div>

        <div className="compatibility-list">
          <div><Check size={15} strokeWidth={2} aria-hidden="true" /><span>Dentro do seu orçamento</span></div>
          <div><Check size={15} strokeWidth={2} aria-hidden="true" /><span>Dentro da sua disponibilidade</span></div>
          <div><Check size={15} strokeWidth={2} aria-hidden="true" /><span>Serviço confirmado pelo profissional</span></div>
        </div>

        <button
          className="primary-button booking-action pressable"
          type="button"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          Ver compromisso
          <ChevronDown className={detailsOpen ? "is-rotated" : ""} size={17} strokeWidth={1.8} aria-hidden="true" />
        </button>

        {detailsOpen && (
          <div className="appointment-details">
            <div><CalendarDays size={16} strokeWidth={1.7} /><span><small>DATA E HORÁRIO</small>Hoje · 15:30–16:30</span></div>
            <div><MapPin size={16} strokeWidth={1.7} /><span><small>LOCAL</small>Pinheiros, São Paulo</span></div>
          </div>
        )}
      </article>

      <div className="confirmation-card">
        <span className="confirmation-icon"><Check size={16} strokeWidth={2} aria-hidden="true" /></span>
        <div>
          <strong>Tudo certo por aqui.</strong>
          <p>Compromisso adicionado ao Google Calendar.</p>
          <p>O Chaveiro Pinheiros recebeu a confirmação.</p>
        </div>
      </div>

      <button className="text-button pressable" type="button" onClick={onReset}>
        Fazer nova solicitação
      </button>
    </section>
  );
}

export function FieldApp() {
  const [state, dispatch] = useReducer(fieldFlowReducer, initialFlowState);
  const [activityPhase, setActivityPhase] = useState(0);
  const [instantTransition, setInstantTransition] = useState(false);

  useEffect(() => {
    if (state.stage !== "work") return;

    setActivityPhase(0);
    const timers = [
      window.setTimeout(() => setActivityPhase(1), 700),
      window.setTimeout(() => setActivityPhase(2), 1400),
      window.setTimeout(() => setActivityPhase(3), 2150),
      window.setTimeout(() => setActivityPhase(4), 3000),
      window.setTimeout(() => dispatch({ type: "SHOW_RESULT" }), 4300),
    ];

    return () => timers.forEach(window.clearTimeout);
  }, [state.stage]);

  const stageLabel = useMemo(
    () => ({ start: "Início", collect: "Coleta", work: "Execução", result: "Resultado" })[state.stage],
    [state.stage],
  );

  const reset = () => {
    setInstantTransition(false);
    dispatch({ type: "RESET" });
  };

  return (
    <div className="field-app">
      <Header stage={state.stage} onReset={reset} />
      <main className="app-main" data-instant={instantTransition || undefined}>
        <span className="sr-only" aria-live="polite">Etapa atual: {stageLabel}</span>
        {state.stage === "start" && (
          <StartScreen
            onKeyboardStart={() => setInstantTransition(true)}
            onStart={(message) => dispatch({ type: "START_REQUEST", message })}
          />
        )}
        {state.stage === "collect" && (
          <CollectScreen
            originalRequest={state.originalRequest}
            request={state.request}
            onUpdate={(field, value) => dispatch({ type: "UPDATE_FIELD", field, value })}
            onBegin={() => {
              setInstantTransition(false);
              dispatch({ type: "BEGIN_WORK" });
            }}
          />
        )}
        {state.stage === "work" && (
          <WorkScreen
            request={state.request}
            phase={activityPhase}
            onAdjust={() => dispatch({ type: "RETURN_TO_COLLECTION" })}
          />
        )}
        {state.stage === "result" && <ResultScreen onReset={reset} />}
      </main>
    </div>
  );
}
