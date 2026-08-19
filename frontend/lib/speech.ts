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
