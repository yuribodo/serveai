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
  type EditableField, type ServiceRequest,
} from "@/lib/flow";
import { getMicrophoneErrorMessage, mergeSpeechTranscript } from "@/lib/speech";

type VoiceState = "idle" | "connecting" | "recording" | "finishing";

const MAX_RECORDING_MS = 30_000;
const NO_SPEECH_TIMEOUT_MS = 10_000;
const SILENCE_TO_STOP_MS = 1_400;
const PREVIEW_SEGMENT_MS = 2_500;

function supportedRecordingOptions(): MediaRecorderOptions | undefined {
  const mimeTypes = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
  const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
  return mimeType ? { mimeType } : undefined;
}

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
  return (
    <span className="brand-mark" aria-hidden="true">
      <img src="/serveai-logo.png" alt="" />
    </span>
  );
}

function Sidebar({ open, onClose, onReset }: { open: boolean; onClose: () => void; onReset: () => void }) {
  return (
    <>
      <button className={`sidebar-backdrop ${open ? "is-visible" : ""}`} type="button" onClick={onClose} aria-label="Fechar menu" tabIndex={open ? 0 : -1} />
      <aside className={`sidebar ${open ? "is-open" : ""}`} aria-label="Navegação principal">
        <div className="sidebar-top">
          <button className="sidebar-brand pressable" type="button" onClick={onReset} aria-label="Ir para o início">
            <BrandMark /><span>ServeAI</span>
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
  return (
    <header className="chat-header">
      <div className="chat-header-left">
        <button className="icon-button mobile-menu pressable" type="button" onClick={onOpenMenu} aria-label="Abrir menu"><Menu size={20} strokeWidth={1.7} /></button>
        <div className="chat-title"><strong>{stage === "start" ? "ServeAI" : "Chaveiro em Pinheiros"}</strong><span className={`chat-status is-${stage}`}><i />{status}</span></div>
      </div>
      <button className="header-new-chat pressable" type="button" onClick={onReset}><Plus size={17} strokeWidth={1.8} /><span>Novo chat</span></button>
    </header>
  );
}

function Composer({ value, onChange, onSubmit, placeholder, autoFocus = false, quiet = false }: {
  value: string; onChange: (value: string) => void; onSubmit: () => void; placeholder: string; autoFocus?: boolean; quiet?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mainRecorderRef = useRef<MediaRecorder | null>(null);
  const previewRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const monitorTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const noSpeechTimerRef = useRef<number | null>(null);
  const finalRequestRef = useRef<AbortController | null>(null);
  const previewRequestsRef = useRef(new Set<AbortController>());
  const baseValueRef = useRef("");
  const previewResultsRef = useRef(new Map<number, string>());
  const previewIndexRef = useRef(0);
  const sessionRef = useRef(0);
  const activeRef = useRef(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState("");
  const [supportsVoice, setSupportsVoice] = useState(true);

  const resize = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
  };
  useEffect(resize, [value]);

  const clearVoiceTimers = () => {
    [previewTimerRef, maxTimerRef, noSpeechTimerRef].forEach((timerRef) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    });
    if (monitorTimerRef.current !== null) window.clearInterval(monitorTimerRef.current);
    monitorTimerRef.current = null;
  };

  const closeVoiceSession = () => {
    clearVoiceTimers();
    activeRef.current = false;
    previewRequestsRef.current.forEach((controller) => controller.abort());
    previewRequestsRef.current.clear();
    finalRequestRef.current?.abort();
    finalRequestRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    previewStreamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    previewStreamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    mainRecorderRef.current = null;
    previewRecorderRef.current = null;
  };

  useEffect(() => {
    setSupportsVoice(
      "mediaDevices" in navigator
      && "MediaRecorder" in window
      && "AudioContext" in window,
    );
    return () => {
      sessionRef.current += 1;
      closeVoiceSession();
    };
  }, []);

  const audioExtension = (audio: Blob) => audio.type.includes("mp4") ? "m4a" : "webm";

  const requestTranscript = async (audio: Blob, controller: AbortController) => {
    const formData = new FormData();
    formData.append("audio", audio, `gravacao.${audioExtension(audio)}`);
    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    const result = (await response.json()) as { text?: string; error?: string };
    if (!response.ok) throw new Error(result.error || "Não consegui transcrever o áudio.");
    return result.text?.trim() || "";
  };

  const updatePreview = async (audio: Blob, index: number, session: number) => {
    if (audio.size === 0) return;
    const controller = new AbortController();
    previewRequestsRef.current.add(controller);
    try {
      const transcript = await requestTranscript(audio, controller);
      if (!activeRef.current || sessionRef.current !== session || !transcript) return;
      previewResultsRef.current.set(index, transcript);
      const ordered: string[] = [];
      for (let position = 0; previewResultsRef.current.has(position); position += 1) {
        ordered.push(previewResultsRef.current.get(position) as string);
      }
      onChange(mergeSpeechTranscript(baseValueRef.current, ordered.join(" ")));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.warn("Live transcription preview failed", error);
      }
    } finally {
      previewRequestsRef.current.delete(controller);
    }
  };

  const startPreviewSegment = (stream: MediaStream, session: number) => {
    if (!activeRef.current || sessionRef.current !== session) return;
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, supportedRecordingOptions());
    const index = previewIndexRef.current;
    previewIndexRef.current += 1;
    previewRecorderRef.current = recorder;
    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
    recorder.onstop = () => {
      const audio = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      if (!activeRef.current || sessionRef.current !== session) return;
      void updatePreview(audio, index, session);
      startPreviewSegment(stream, session);
    };
    recorder.start();
    previewTimerRef.current = window.setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, PREVIEW_SEGMENT_MS);
  };

  const finishRecording = () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    clearVoiceTimers();
    setVoiceState("finishing");
    if (previewRecorderRef.current?.state !== "inactive") previewRecorderRef.current?.stop();
    if (mainRecorderRef.current?.state !== "inactive") mainRecorderRef.current?.stop();
  };

  const startVoice = async () => {
    setVoiceError("");
    setVoiceState("connecting");
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const previewStream = new MediaStream(stream.getAudioTracks().map((track) => track.clone()));
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, supportedRecordingOptions());
      streamRef.current = stream;
      previewStreamRef.current = previewStream;
      mainRecorderRef.current = recorder;
      baseValueRef.current = value;
      previewResultsRef.current.clear();
      previewIndexRef.current = 0;
      activeRef.current = true;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onerror = () => {
        closeVoiceSession();
        setVoiceState("idle");
        setVoiceError("Ocorreu um erro durante a gravação. Tente novamente.");
      };
      recorder.onstop = async () => {
        const audio = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        previewRequestsRef.current.forEach((controller) => controller.abort());
        previewRequestsRef.current.clear();
        stream.getTracks().forEach((track) => track.stop());
        previewStream.getTracks().forEach((track) => track.stop());
        void audioContextRef.current?.close();
        audioContextRef.current = null;
        const controller = new AbortController();
        finalRequestRef.current = controller;
        try {
          const transcript = await requestTranscript(audio, controller);
          if (sessionRef.current !== session) return;
          if (!transcript) throw new Error("Não ouvi nenhuma fala. Toque no microfone e tente novamente.");
          onChange(mergeSpeechTranscript(baseValueRef.current, transcript));
          setVoiceError("");
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setVoiceError(error instanceof Error ? error.message : "Não consegui transcrever o áudio.");
          }
        } finally {
          if (sessionRef.current === session) setVoiceState("idle");
          finalRequestRef.current = null;
        }
      };

      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      let heardSpeech = false;
      let lastSpeechAt = performance.now();
      analyser.fftSize = 512;
      const levels = new Uint8Array(analyser.fftSize);
      source.connect(analyser);
      audioContextRef.current = audioContext;
      monitorTimerRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(levels);
        let energy = 0;
        for (const level of levels) energy += ((level - 128) / 128) ** 2;
        const volume = Math.sqrt(energy / levels.length);
        const now = performance.now();
        if (volume > 0.018) {
          heardSpeech = true;
          lastSpeechAt = now;
          if (noSpeechTimerRef.current !== null) window.clearTimeout(noSpeechTimerRef.current);
          noSpeechTimerRef.current = null;
        } else if (heardSpeech && now - lastSpeechAt >= SILENCE_TO_STOP_MS) {
          finishRecording();
        }
      }, 100);

      recorder.start();
      startPreviewSegment(previewStream, session);
      setVoiceState("recording");
      maxTimerRef.current = window.setTimeout(finishRecording, MAX_RECORDING_MS);
      noSpeechTimerRef.current = window.setTimeout(finishRecording, NO_SPEECH_TIMEOUT_MS);
    } catch (error) {
      closeVoiceSession();
      setVoiceState("idle");
      const errorName = error instanceof DOMException ? error.name : "";
      setVoiceError(
        error instanceof Error && !(error instanceof DOMException) ? error.message : getMicrophoneErrorMessage(errorName),
      );
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value.trim() && voiceState === "idle") onSubmit();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (value.trim() && voiceState === "idle") onSubmit();
    }
  };

  const toggleVoice = () => {
    if (!supportsVoice) {
      setVoiceError("A gravação de voz não está disponível neste navegador.");
      return;
    }
    if (voiceState === "recording") finishRecording();
    if (voiceState === "idle") void startVoice();
  };

  const voiceFeedback = voiceError
    || (voiceState === "connecting" && "Conectando ao microfone…")
    || (voiceState === "recording" && "Ouvindo e transcrevendo… paro quando você terminar de falar.")
    || (voiceState === "finishing" && "Finalizando transcrição…");

  return (
    <form className={`composer ${quiet ? "is-quiet" : ""} ${voiceState !== "idle" ? "is-listening" : ""}`} onSubmit={handleSubmit}>
      <textarea ref={textareaRef} rows={1} value={value} onChange={(event) => { setVoiceError(""); onChange(event.target.value); }} onInput={resize} onKeyDown={handleKeyDown} placeholder={voiceState === "recording" ? "Pode falar…" : placeholder} aria-label={placeholder} autoFocus={autoFocus} disabled={voiceState !== "idle"} />
      {voiceFeedback && <p className={`voice-feedback ${voiceError ? "is-error" : ""}`} role={voiceError ? "alert" : "status"}>{voiceFeedback}</p>}
      <div className="composer-toolbar">
        <div className="composer-tools">
          <button className="composer-icon pressable" type="button" aria-label="Anexar arquivo"><Paperclip size={18} strokeWidth={1.7} /></button>
          <button className="location-pill pressable" type="button" aria-label="Usar localização"><LocateFixed size={15} strokeWidth={1.8} /><span>Localização</span></button>
        </div>
        <div className="composer-actions">
          <button className="composer-icon voice-button pressable" type="button" aria-label={voiceState === "recording" ? "Parar gravação" : "Usar microfone"} aria-pressed={voiceState !== "idle"} onClick={toggleVoice} disabled={voiceState === "connecting" || voiceState === "finishing"}><span className="voice-pulse" aria-hidden="true" /><Mic size={18} strokeWidth={1.7} /></button>
          <button className="composer-submit pressable" type="submit" aria-label="Enviar mensagem" disabled={!value.trim() || voiceState !== "idle"}><ArrowUp size={18} strokeWidth={2.2} /></button>
        </div>
      </div>
    </form>
  );
}

function ComposerDock({ children }: { children: ReactNode }) {
  return <div className="composer-dock">{children}<p>O ServeAI pode cometer erros. Confirme informações importantes.</p></div>;
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

function ParameterRow({ field, value, onChange }: { field: EditableField; value: string; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const { label, icon: Icon } = fieldMeta[field];
  useEffect(() => setDraft(value), [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  const save = () => { if (draft.trim()) onChange(draft); else setDraft(value); setEditing(false); };

  return (
    <div className={`parameter-row ${!value ? "is-empty" : ""}`}>
      <span className="parameter-icon"><Icon size={15} strokeWidth={1.7} /></span>
      <span className="parameter-copy"><small>{label}</small>
        {editing ? (
          <input ref={inputRef} className="parameter-input" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={save} onKeyDown={(event) => {
            if (event.key === "Enter") save();
            if (event.key === "Escape") { setDraft(value); setEditing(false); }
          }} aria-label={`Editar ${label.toLowerCase()}`} />
        ) : <strong>{value || "Ainda não informado"}</strong>}
      </span>
      <button className="edit-parameter pressable" type="button" onClick={() => setEditing(true)} aria-label={`Alterar ${label.toLowerCase()}`}><PencilLine size={14} strokeWidth={1.7} /></button>
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
        <ParameterRow key={field} field={field} value={request[field]} onChange={(value) => onUpdate?.(field, value)} />
      ))}</div>
    </section>
  );
}

function OptionChips({ options, onSelect }: { options: string[]; onSelect: (value: string) => void }) {
  return <div className="option-chips">{options.map((option) => <button className="option-chip pressable" type="button" onClick={() => onSelect(option)} key={option}>{option}</button>)}</div>;
}

function CollectScreen({ originalRequest, request, onUpdate, onBegin }: { originalRequest: string; request: ServiceRequest; onUpdate: (field: EditableField, value: string) => void; onBegin: () => void }) {
  const [reply, setReply] = useState("");
  const question = !request.problem ? "problem" : !request.budget ? "budget" : "ready";
  const answer = (value: string) => { if (question === "problem") onUpdate("problem", value); if (question === "budget") onUpdate("budget", value); setReply(""); };
  const submitReply = () => reply.trim() && question !== "ready" && answer(reply);
  return (
    <section className="conversation-screen stage-panel" aria-label="Conversa">
      <div className="conversation-thread">
        <UserMessage>{originalRequest}</UserMessage>
        <AgentMessage>
          <p>Entendi. Já organizei as informações que vieram na sua mensagem.</p>
          <p className="muted-copy">Você pode revisar e editar qualquer detalhe antes de eu começar.</p>
          <RequestSummary request={request} onUpdate={onUpdate} />
        </AgentMessage>
        {request.problem && <UserMessage>{request.problem}</UserMessage>}
        {question === "problem" && <AgentMessage><p>O que aconteceu com a fechadura?</p><p className="muted-copy">Isso me ajuda a encontrar o profissional certo.</p><OptionChips options={problemOptions} onSelect={answer} /></AgentMessage>}
        {question === "budget" && <AgentMessage><p>Perfeito. Quanto você gostaria de gastar?</p><OptionChips options={budgetOptions} onSelect={answer} /></AgentMessage>}
        {request.budget && <UserMessage>{request.budget}</UserMessage>}
        {question === "ready" && (
          <AgentMessage>
            <p>Ótimo, tenho tudo o que preciso.</p>
            <p className="muted-copy">Posso comparar os profissionais disponíveis e cuidar do agendamento para você.</p>
            <div className="ready-actions">
              <button className="primary-button pressable" type="button" onClick={onBegin}>
                <Search size={16} strokeWidth={1.9} />
                Começar busca
              </button>
              <span>Preço, disponibilidade e avaliações serão considerados.</span>
            </div>
          </AgentMessage>
        )}
      </div>
      {question !== "ready" && <ComposerDock><Composer value={reply} onChange={setReply} onSubmit={submitReply} placeholder="Responda ao ServeAI" quiet /></ComposerDock>}
    </section>
  );
}

function ActivityIcon({ status }: { status: "done" | "active" | "pending" }) {
  if (status === "done") return <Check size={14} strokeWidth={2.2} />;
  if (status === "active") return <CircleDashed className="activity-spinner" size={16} strokeWidth={1.8} />;
  return <Circle size={13} strokeWidth={1.5} />;
}

function WorkScreen({ originalRequest, request, phase, onAdjust }: { originalRequest: string; request: ServiceRequest; phase: number; onAdjust: () => void }) {
  const currentLabel = activitySteps[Math.min(phase, activitySteps.length - 1)].label;
  return (
    <section className="conversation-screen stage-panel" aria-labelledby="work-title">
      <div className="conversation-thread">
        <UserMessage>{originalRequest}</UserMessage>
        <AgentMessage>
          <p id="work-title">Pode deixar. Estou encontrando o melhor chaveiro para você.</p>
          <RequestSummary request={request} compact />
          <div className="activity-card" aria-live="polite" aria-label={`Progresso: ${currentLabel}`}>
            <div className="activity-heading"><span className="work-icon"><Search size={17} strokeWidth={1.8} /></span><div><strong>Buscando profissionais</strong><small>Execução em tempo real</small></div><span className="live-pill"><i />AO VIVO</span></div>
            <div className="activity-list">{activitySteps.map((step, index) => {
              const status = index < phase ? "done" : index === phase ? "active" : "pending";
              return <div className={`activity-row is-${status}`} key={step.label}><span className="activity-status"><ActivityIcon status={status} /></span><div className="activity-copy"><span>{step.label}</span>{step.detail && <small>{step.detail}</small>}</div><time>{status === "done" ? step.time : ""}</time></div>;
            })}</div>
            <div className="activity-footer"><span>Você pode sair — eu aviso quando concluir.</span><button type="button" onClick={onAdjust}>Ajustar pedido</button></div>
          </div>
        </AgentMessage>
      </div>
      <ComposerDock><div className="waiting-composer"><CircleDashed className="activity-spinner" size={16} />ServeAI está trabalhando na sua solicitação</div></ComposerDock>
    </section>
  );
}

function ResultScreen({ originalRequest, request, onReset }: { originalRequest: string; request: ServiceRequest; onReset: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <section className="conversation-screen result-screen stage-panel" aria-labelledby="result-title">
      <div className="conversation-thread">
        <UserMessage>{originalRequest}</UserMessage>
        <AgentMessage>
          <div className="result-message-heading"><span className="success-mark"><Check size={18} strokeWidth={2.3} /></span><div><span className="card-kicker">CONCLUÍDO</span><h1 id="result-title">Encontrei e reservei uma ótima opção.</h1></div></div>
          <p className="muted-copy">O profissional confirmou o serviço dentro do seu orçamento e horário.</p>
          <article className="booking-card">
            <div className="provider-heading"><span className="provider-icon"><KeyRound size={21} strokeWidth={1.8} /></span><div className="provider-copy"><div className="provider-name-line"><h2>{bookingResult.provider}</h2><span className="verified-badge"><Check size={10} strokeWidth={2.5} /></span></div><p><Star size={13} fill="currentColor" />{bookingResult.rating} <span>({bookingResult.reviewCount} avaliações) · {bookingResult.distance}</span></p></div><span className="confirmed-pill"><Check size={12} />Confirmado</span></div>
            <div className="booking-numbers"><div><span>PREÇO</span><strong>{bookingResult.price}</strong></div><div><span>CHEGADA</span><strong>{bookingResult.arrival}</strong></div><div><span>LOCAL</span><strong>Pinheiros</strong></div></div>
            <div className="compatibility-list"><span><Check size={14} />Dentro do seu orçamento</span><span><Check size={14} />Disponível hoje</span><span><Check size={14} />Prestador verificado</span></div>
            <button className="booking-action pressable" type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}><span><CalendarDays size={16} />Ver compromisso</span><ChevronDown className={detailsOpen ? "is-rotated" : ""} size={17} /></button>
            {detailsOpen && <div className="appointment-details"><span><CalendarDays size={16} /><span><small>DATA E HORÁRIO</small>Hoje · 15:30–16:30</span></span><span><MapPin size={16} /><span><small>LOCAL</small>{request.location}</span></span></div>}
          </article>
          <div className="confirmation-card"><span><Check size={15} /></span><div><strong>Tudo certo por aqui.</strong><p>Compromisso adicionado ao Google Calendar e confirmação enviada ao profissional.</p></div></div>
        </AgentMessage>
      </div>
      <ComposerDock><button className="new-request-cta pressable" type="button" onClick={onReset}><Plus size={17} />Fazer nova solicitação</button></ComposerDock>
    </section>
  );
}

export function ServeAIApp() {
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
    <div className="serveai-app">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onReset={reset} />
      <div className="chat-shell">
        <ChatHeader stage={state.stage} onOpenMenu={() => setSidebarOpen(true)} onReset={reset} />
        <main className="app-main">
          <span className="sr-only" aria-live="polite">Etapa atual: {stageLabel}</span>
          {state.stage === "start" && <StartScreen onStart={(message) => dispatch({ type: "START_REQUEST", message })} />}
          {state.stage === "collect" && <CollectScreen originalRequest={state.originalRequest} request={state.request} onUpdate={(field, value) => dispatch({ type: "UPDATE_FIELD", field, value })} onBegin={() => dispatch({ type: "BEGIN_WORK" })} />}
          {state.stage === "work" && <WorkScreen originalRequest={state.originalRequest} request={state.request} phase={activityPhase} onAdjust={() => dispatch({ type: "RETURN_TO_COLLECTION" })} />}
          {state.stage === "result" && <ResultScreen originalRequest={state.originalRequest} request={state.request} onReset={reset} />}
        </main>
      </div>
    </div>
  );
}
