import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

function audioRequest() {
  const body = new FormData();
  body.append("audio", new File(["audio"], "gravacao.webm", { type: "audio/webm" }));
  return new Request("http://localhost/api/transcribe", { method: "POST", body });
}

describe("voice transcription route", () => {
  it("explains when the server has no transcription key", async () => {
    delete process.env.OPENAI_API_KEY;

    const response = await POST(audioRequest());
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error).toContain("não foi configurada");
  });

  it("forwards the recording and returns only the transcript", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    let forwardedBody: FormData | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      forwardedBody = init?.body as FormData;
      return Response.json({ text: "Preciso de um chaveiro" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(audioRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "Preciso de um chaveiro" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(forwardedBody?.get("language")).toBe("pt");
    expect(forwardedBody?.get("model")).toBe("gpt-4o-mini-transcribe");
  });
});
