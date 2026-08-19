import { describe, expect, it } from "vitest";
import { getMicrophoneErrorMessage, mergeSpeechTranscript } from "./speech";

describe("speech helpers", () => {
  it("appends a spoken transcript to text already typed", () => {
    expect(mergeSpeechTranscript("Preciso de", "um chaveiro perto de mim")).toBe(
      "Preciso de um chaveiro perto de mim",
    );
  });

  it("does not add extra whitespace when the composer is empty", () => {
    expect(mergeSpeechTranscript("  ", "  Perdi minha chave  ")).toBe("Perdi minha chave");
  });

  it("returns actionable messages for microphone failures", () => {
    expect(getMicrophoneErrorMessage("NotAllowedError")).toContain("Permita");
    expect(getMicrophoneErrorMessage("NotFoundError")).toContain("microfone");
    expect(getMicrophoneErrorMessage("NotReadableError")).toContain("outro aplicativo");
  });
});
