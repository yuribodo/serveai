import { NextResponse } from "next/server";

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4_400_000;
const MAX_CONCURRENT_REQUESTS = 2;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 6;
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
]);

interface RateLimitEntry {
  count: number;
  resetsAt: number;
}

const rateLimits = new Map<string, RateLimitEntry>();
let activeRequests = 0;

export const runtime = "nodejs";
export const maxDuration = 30;

function json(body: { text: string } | { error: string }, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function requestKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "local";
}

function exceedsRateLimit(request: Request): boolean {
  const now = Date.now();
  const key = requestKey(request);
  const current = rateLimits.get(key);
  if (!current || current.resetsAt <= now) {
    if (rateLimits.size >= 1_000) rateLimits.clear();
    rateLimits.set(key, { count: 1, resetsAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT_REQUESTS;
}

async function transcribe(request: Request, apiKey: string) {
  let requestData: FormData;
  try {
    requestData = await request.formData();
  } catch {
    return json({ error: "A gravação recebida não é válida." }, 400);
  }

  const audio = requestData.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return json({ error: "A gravação recebida está vazia." }, 400);
  }
  if (audio.size > MAX_AUDIO_BYTES) return json({ error: "A gravação é muito longa." }, 413);
  const audioType = audio.type.toLowerCase().split(";", 1)[0];
  if (!ALLOWED_AUDIO_TYPES.has(audioType)) {
    return json({ error: "O formato da gravação não é compatível." }, 415);
  }

  const openAIData = new FormData();
  openAIData.append("file", audio, audio.name || "gravacao.webm");
  openAIData.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe");
  openAIData.append("language", "pt");
  openAIData.append("response_format", "json");

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: openAIData,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
    });
  } catch {
    return json({ error: "O serviço de transcrição está indisponível no momento." }, 502);
  }

  let result: { text?: string } = {};
  try {
    result = (await response.json()) as typeof result;
  } catch {
    // The status-based fallback below remains safe for non-JSON upstream responses.
  }
  if (!response.ok) {
    console.error("Voice transcription failed", response.status);
    const message = response.status === 401
      ? "A chave da transcrição não é válida."
      : "O serviço de transcrição está indisponível no momento.";
    return json({ error: message }, 502);
  }

  return json({ text: result.text?.trim() || "" });
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json({ error: "A transcrição de voz ainda não foi configurada no servidor." }, 503);

  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "Origem não permitida." }, 403);

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ error: "A gravação é muito longa." }, 413);
  }
  if (exceedsRateLimit(request)) {
    return json({ error: "Muitas transcrições em pouco tempo. Aguarde um minuto e tente novamente." }, 429);
  }
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    return json({ error: "O serviço de transcrição está ocupado. Tente novamente em instantes." }, 429);
  }

  activeRequests += 1;
  try {
    return await transcribe(request, apiKey);
  } finally {
    activeRequests -= 1;
  }
}
