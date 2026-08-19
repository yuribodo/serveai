import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { getMicrophoneErrorMessage, mergeSpeechTranscript, transcribeRecording } from "./speech";

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

  it("uploads only the single final recording and leaves the transcript reviewable", async () => {
    const fetcher = vi.fn(async () => Response.json({ text: "Preciso de um chaveiro" }));

    const transcript = await transcribeRecording(
      new Blob(["audio"], { type: "audio/webm" }),
      undefined,
      fetcher,
    );

    expect(transcript).toBe("Preciso de um chaveiro");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/transcribe",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
  });
});
