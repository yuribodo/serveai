import { describe, expect, it, vi } from "vitest";
import { normalizeConversation, ServeAIClient, type ChatConversation } from "./serveai";

const snapshot: ChatConversation = {
  conversationId: "conversation-1",
  status: "collecting_requirements",
  canSendMessage: true,
  pollAfterMs: null,
  timeline: [
    {
      id: "message-1",
      type: "message",
      role: "user",
      content: "Preciso de um chaveiro",
      createdAt: "2026-08-19T12:00:00Z",
    },
  ],
  serviceRequest: { availability: [] },
  updatedAt: "2026-08-19T12:00:00Z",
};

describe("ServeAIClient", () => {
  it("creates a conversation using the camelCase contract", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(snapshot), { status: 201 }));
    const client = new ServeAIClient("http://localhost:8000/", fetcher);

    await client.createConversation({
      message: "Preciso de um chaveiro",
      clientMessageId: "client-1",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/conversations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          message: "Preciso de um chaveiro",
          clientMessageId: "client-1",
        }),
      }),
    );
  });

  it("uses the message and polling endpoints", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(snapshot), { status: 200 }),
    );
    const client = new ServeAIClient("https://api.serveai.test", fetcher);

    await client.addMessage("conversation/1", { message: "Até R$ 200", clientMessageId: "client-2" });
    await client.getConversation("conversation/1");

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.serveai.test/api/v1/conversations/conversation%2F1/messages",
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://api.serveai.test/api/v1/conversations/conversation%2F1",
    );
  });

  it("deduplicates stable timeline IDs in backend order", () => {
    const duplicated = { ...snapshot, timeline: [...snapshot.timeline, snapshot.timeline[0]] };
    expect(normalizeConversation(duplicated).timeline).toHaveLength(1);
  });

  it("turns connection failures into a recoverable error", async () => {
    const client = new ServeAIClient("https://api.serveai.test", async () => {
      throw new TypeError("offline");
    });

    await expect(client.getConversation("conversation-1")).rejects.toMatchObject({
      name: "ServeAIAPIError",
      status: null,
      retryable: true,
    });
  });

  it("surfaces FastAPI validation details without exposing the whole payload", async () => {
    const client = new ServeAIClient("https://api.serveai.test", async () =>
      new Response(JSON.stringify({ detail: [{ loc: ["body", "message"], msg: "Campo obrigatório" }] }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(client.getConversation("conversation-1")).rejects.toMatchObject({
      message: "Campo obrigatório",
      status: 422,
      retryable: false,
    });
  });

  it("marks a conversation lock as recoverable", async () => {
    const client = new ServeAIClient("https://api.serveai.test///", async () =>
      new Response(JSON.stringify({ detail: "A solicitação ainda está em execução." }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(client.getConversation("conversation-1")).rejects.toMatchObject({
      status: 409,
      retryable: true,
    });
  });
});
