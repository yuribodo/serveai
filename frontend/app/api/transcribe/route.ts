import { NextResponse } from "next/server";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "A transcrição de voz ainda não foi configurada no servidor." },
      { status: 503 },
    );
  }

  try {
    const requestData = await request.formData();
    const audio = requestData.get("audio");

    if (!(audio instanceof File) || audio.size === 0) {
      return NextResponse.json({ error: "A gravação recebida está vazia." }, { status: 400 });
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "A gravação é muito longa." }, { status: 413 });
    }

    const openAIData = new FormData();
    openAIData.append("file", audio, audio.name || "gravacao.webm");
    openAIData.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe");
    openAIData.append("language", "pt");
    openAIData.append("response_format", "json");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: openAIData,
    });
    const result = (await response.json()) as {
      text?: string;
      error?: { message?: string };
    };

    if (!response.ok) {
      console.error("Voice transcription failed", response.status, result.error?.message);
      const message = response.status === 401
        ? "A chave da transcrição não é válida."
        : "O serviço de transcrição está indisponível no momento.";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    return NextResponse.json({ text: result.text?.trim() || "" });
  } catch (error) {
    console.error("Voice transcription request failed", error);
    return NextResponse.json(
      { error: "Não foi possível processar a gravação." },
      { status: 500 },
    );
  }
}
