export function mergeSpeechTranscript(baseValue: string, transcript: string) {
  return [baseValue.trim(), transcript.trim()].filter(Boolean).join(" ");
}

export function getMicrophoneErrorMessage(errorName: string) {
  switch (errorName) {
    case "NotAllowedError":
    case "SecurityError":
      return "Permita o acesso ao microfone para usar a voz.";
    case "NotFoundError":
      return "Não encontrei um microfone disponível.";
    case "NotReadableError":
    case "AbortError":
      return "O microfone está sendo usado por outro aplicativo.";
    default:
      return "Não consegui acessar o microfone. Tente novamente.";
  }
}

function audioExtension(audio: Blob): string {
  if (audio.type.includes("mp4")) return "m4a";
  if (audio.type.includes("ogg")) return "ogg";
  return "webm";
}

export async function transcribeRecording(
  audio: Blob,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const formData = new FormData();
  formData.append("audio", audio, `gravacao.${audioExtension(audio)}`);

  let response: Response;
  try {
    response = await fetcher("/api/transcribe", {
      method: "POST",
      body: formData,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("Não foi possível conectar ao serviço de transcrição.");
  }

  let result: { text?: string; error?: string } = {};
  try {
    result = (await response.json()) as typeof result;
  } catch {
    // Fall through to a safe message when the server returns non-JSON.
  }
  if (!response.ok) throw new Error(result.error || "Não consegui transcrever o áudio.");
  return result.text?.trim() || "";
}
