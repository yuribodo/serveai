"use client";

import { ArrowUp, Check, LocateFixed, Mic, Paperclip } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  requestBrowserLocation,
  resolveLocationName,
  type BrowserLocation,
} from "@/lib/location";
import {
  getMicrophoneErrorMessage,
  mergeSpeechTranscript,
  transcribeRecording,
} from "@/lib/speech";

type VoiceState = "idle" | "connecting" | "recording" | "finishing";
type LocationState = "idle" | "loading" | "success" | "error";

const MAX_RECORDING_MS = 30_000;

function supportedRecordingOptions(): MediaRecorderOptions | undefined {
  const mimeTypes = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg", "audio/webm"];
  const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
  return mimeType ? { mimeType } : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  autoFocus?: boolean;
  location?: BrowserLocation;
  onLocation?: (location: BrowserLocation) => void;
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  busy = false,
  autoFocus = false,
  location,
  onLocation,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const transcriptRequestRef = useRef<AbortController | null>(null);
  const voiceSessionRef = useRef(0);
  const locationRequestRef = useRef(0);
  const mountedRef = useRef(false);
  const baseValueRef = useRef("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState("");
  const [supportsVoice, setSupportsVoice] = useState(false);
  const [locationState, setLocationState] = useState<LocationState>(location ? "success" : "idle");
  const [locationError, setLocationError] = useState("");
  const [locationResolved, setLocationResolved] = useState(false);

  const resize = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
  };

  useEffect(resize, [value]);

  const clearRecordingTimer = () => {
    if (maxTimerRef.current !== null) window.clearTimeout(maxTimerRef.current);
    maxTimerRef.current = null;
  };

  const closeVoiceSession = () => {
    clearRecordingTimer();
    transcriptRequestRef.current?.abort();
    transcriptRequestRef.current = null;
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Its media stream may already have ended while unmounting.
        }
      }
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    streamRef.current = null;
  };

  useEffect(() => {
    mountedRef.current = true;
    setSupportsVoice(
      typeof navigator.mediaDevices?.getUserMedia === "function"
      && "MediaRecorder" in window,
    );
    return () => {
      mountedRef.current = false;
      locationRequestRef.current += 1;
      voiceSessionRef.current += 1;
      closeVoiceSession();
    };
  }, []);

  useEffect(() => {
    setLocationState(location ? "success" : "idle");
    if (location) setLocationError("");
  }, [location]);

  const finishRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    clearRecordingTimer();
    setVoiceState("finishing");
    recorder.stop();
  };

  const startVoice = async () => {
    setVoiceError("");
    setVoiceState("connecting");
    const session = voiceSessionRef.current + 1;
    voiceSessionRef.current = session;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!mountedRef.current || voiceSessionRef.current !== session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const chunks: Blob[] = [];
      const options = supportedRecordingOptions();
      const recorder = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
      baseValueRef.current = value;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onerror = () => {
        closeVoiceSession();
        if (!mountedRef.current || voiceSessionRef.current !== session) return;
        setVoiceState("idle");
        setVoiceError("Ocorreu um erro durante a gravação. Tente novamente.");
      };
      recorder.onstop = async () => {
        clearRecordingTimer();
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const audio = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const controller = new AbortController();
        transcriptRequestRef.current = controller;
        try {
          if (audio.size === 0) throw new Error("A gravação ficou vazia. Toque no microfone e tente novamente.");
          const transcript = await transcribeRecording(audio, controller.signal);
          if (!mountedRef.current || voiceSessionRef.current !== session) return;
          if (!transcript) throw new Error("Não ouvi nenhuma fala. Toque no microfone e tente novamente.");
          onChange(mergeSpeechTranscript(baseValueRef.current, transcript));
          setVoiceError("");
        } catch (error) {
          if (mountedRef.current && voiceSessionRef.current === session && !isAbortError(error)) {
            setVoiceError(error instanceof Error ? error.message : "Não consegui transcrever o áudio.");
          }
        } finally {
          if (voiceSessionRef.current === session) {
            transcriptRequestRef.current = null;
            recorderRef.current = null;
          }
          if (mountedRef.current && voiceSessionRef.current === session) setVoiceState("idle");
        }
      };

      recorder.start();
      setVoiceState("recording");
      maxTimerRef.current = window.setTimeout(finishRecording, MAX_RECORDING_MS);
    } catch (error) {
      closeVoiceSession();
      if (!mountedRef.current || voiceSessionRef.current !== session) return;
      setVoiceState("idle");
      const errorName = error instanceof DOMException ? error.name : "";
      setVoiceError(
        error instanceof Error && !(error instanceof DOMException)
          ? error.message
          : getMicrophoneErrorMessage(errorName),
      );
    }
  };

  const useCurrentLocation = useCallback(async () => {
    if (!onLocation || disabled) return;
    const requestId = locationRequestRef.current + 1;
    locationRequestRef.current = requestId;
    setLocationState("loading");
    setLocationError("");
    setLocationResolved(false);
    try {
      const coordinates = await requestBrowserLocation(navigator.geolocation);
      let selectedLocation = coordinates;
      let resolved = false;
      try {
        selectedLocation = await resolveLocationName(coordinates);
        resolved = true;
      } catch {
        // Coordinates are still useful to the backend when reverse geocoding is unavailable.
      }
      if (!mountedRef.current || locationRequestRef.current !== requestId) return;
      onLocation(selectedLocation);
      setLocationResolved(resolved);
      setLocationState("success");
    } catch (error) {
      if (!mountedRef.current || locationRequestRef.current !== requestId) return;
      setLocationError(error instanceof Error ? error.message : "Não foi possível acessar sua localização.");
      setLocationState("error");
    }
  }, [disabled, onLocation]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!disabled && voiceState === "idle" && value.trim()) onSubmit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!disabled && voiceState === "idle" && value.trim()) onSubmit();
    }
  };

  const toggleVoice = () => {
    if (disabled) return;
    if (!supportsVoice) {
      setVoiceError("A gravação de voz não está disponível neste navegador.");
      return;
    }
    if (voiceState === "recording") finishRecording();
    else if (voiceState === "idle") void startVoice();
  };

  const voiceFeedback = voiceError
    || (voiceState === "connecting" && "Conectando ao microfone…")
    || (voiceState === "recording" && "Gravando… toque novamente para parar. O áudio será enviado à OpenAI para transcrição.")
    || (voiceState === "finishing" && "Finalizando transcrição…");
  const inputDisabled = disabled || voiceState !== "idle";
  const locationLabel = location?.label || "Localização";

  return (
    <form
      className={`composer ${voiceState !== "idle" ? "is-listening" : ""}`}
      onSubmit={submit}
      aria-busy={busy || voiceState === "connecting" || voiceState === "finishing" || undefined}
    >
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(event) => { setVoiceError(""); onChange(event.target.value); }}
        onInput={resize}
        onKeyDown={handleKeyDown}
        placeholder={voiceState === "recording" ? "Pode falar…" : placeholder}
        aria-label={placeholder}
        disabled={inputDisabled}
        autoFocus={autoFocus}
      />
      {voiceFeedback && (
        <p className={`voice-feedback ${voiceError ? "is-error" : ""}`} role={voiceError ? "alert" : "status"}>
          {voiceFeedback}
        </p>
      )}
      {locationError && <p className="location-feedback is-error" role="alert">{locationError}</p>}
      {locationResolved && (
        <p className="location-attribution">
          Localização aproximada · ©{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
        </p>
      )}
      <div className="composer-toolbar">
        <div className="composer-tools">
          <button className="composer-icon" type="button" aria-label="Anexos indisponíveis" disabled>
            <Paperclip size={18} strokeWidth={1.7} />
          </button>
          {onLocation && (
            <button
              className={`location-pill pressable is-${locationState}`}
              type="button"
              aria-label={location ? `Localização usada: ${locationLabel}` : "Usar localização atual"}
              aria-pressed={Boolean(location)}
              onClick={() => void useCurrentLocation()}
              disabled={disabled || locationState === "loading"}
            >
              {location ? <Check size={15} strokeWidth={2} /> : <LocateFixed size={15} strokeWidth={1.8} />}
              <span>{locationState === "loading" ? "Obtendo…" : locationLabel}</span>
            </button>
          )}
        </div>
        <div className="composer-actions">
          <button
            className="composer-icon voice-button pressable"
            type="button"
            aria-label={voiceState === "recording" ? "Parar gravação" : "Usar microfone"}
            aria-pressed={voiceState !== "idle"}
            onClick={toggleVoice}
            disabled={disabled || voiceState === "connecting" || voiceState === "finishing"}
          >
            <span className="voice-pulse" aria-hidden="true" />
            <Mic size={18} strokeWidth={1.7} />
          </button>
          <button
            className="composer-submit pressable"
            type="submit"
            aria-label="Enviar mensagem"
            disabled={inputDisabled || !value.trim()}
          >
            <ArrowUp size={18} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </form>
  );
}
