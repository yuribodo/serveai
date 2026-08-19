export type RequestStatus =
  | "collecting_requirements"
  | "ready"
  | "searching"
  | "providers_found"
  | "contacting"
  | "waiting_for_replies"
  | "offer_received"
  | "needs_user_input"
  | "accepted"
  | "booked"
  | "failed";

export interface Location {
  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface Budget {
  minimum?: number | null;
  maximum?: number | null;
  currency: string;
}

export interface AvailabilityWindow {
  start: string;
  end: string;
}

export interface ServiceRequestData {
  serviceType?: string | null;
  problem?: string | null;
  location?: Location | null;
  budget?: Budget | null;
  availability: AvailabilityWindow[];
  urgency?: string | null;
}

interface TimelineItemBase {
  id: string;
  createdAt: string;
}

export interface TextMessage extends TimelineItemBase {
  type: "message";
  role: "user" | "assistant";
  content: string;
}

export interface OperationCard extends TimelineItemBase {
  type: "operation";
  status: RequestStatus;
  title: string;
  detail?: string | null;
}

export interface ProviderSummary {
  id: string;
  name: string;
  address: string;
  rating?: number | null;
  reviewCount?: number | null;
  phone?: string | null;
  website?: string | null;
}

export interface ProvidersCard extends TimelineItemBase {
  type: "providers";
  providers: ProviderSummary[];
}

export interface OfferCard extends TimelineItemBase {
  type: "offer";
  providerId: string;
  providerName: string;
  price?: number | null;
  availableAt?: string | null;
  withinBudget?: boolean | null;
  withinAvailability?: boolean | null;
  acceptable: boolean;
}

export interface BookingCard extends TimelineItemBase {
  type: "booking";
  providerName: string;
  start: string;
  end: string;
  price: number;
  address: string;
  calendarEventUrl?: string | null;
}

export interface ErrorCard extends TimelineItemBase {
  type: "error";
  code: string;
  message: string;
  retryable: boolean;
}

export type TimelineItem =
  | TextMessage
  | OperationCard
  | ProvidersCard
  | OfferCard
  | BookingCard
  | ErrorCard;

export interface ChatConversation {
  conversationId: string;
  status: RequestStatus;
  canSendMessage: boolean;
  pollAfterMs: number | null;
  timeline: TimelineItem[];
  serviceRequest: ServiceRequestData;
  updatedAt: string;
}

export interface CreateConversationInput {
  message: string;
  clientMessageId: string;
  location?: Location;
}

export interface AddMessageInput {
  message: string;
  clientMessageId: string;
}

export class ServeAIAPIError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ServeAIAPIError";
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const requestedAPIURL = process.env.NEXT_PUBLIC_SERVEAI_API_URL?.trim() || null;
const configuredAPIURL =
  process.env.NODE_ENV === "production" &&
  (!requestedAPIURL || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestedAPIURL))
    ? "https://serveai-api.vercel.app"
    : requestedAPIURL;

function errorDetail(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("detail" in payload)) return null;
  const { detail } = payload as { detail: unknown };
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return null;
  const firstMessage = detail.find(
    (item): item is { msg: string } =>
      Boolean(item) && typeof item === "object" && "msg" in item && typeof item.msg === "string",
  );
  return firstMessage?.msg ?? null;
}

/** Removes duplicate timeline entries while preserving the order sent by the API. */
export function normalizeConversation(snapshot: ChatConversation): ChatConversation {
  const seen = new Set<string>();
  return {
    ...snapshot,
    timeline: snapshot.timeline.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
  };
}

export class ServeAIClient {
  private readonly baseURL: string | null;
  private readonly demo: DemoConversationStore | null;

  constructor(
    baseURL: string | null = configuredAPIURL,
    private readonly fetcher: Fetcher = globalThis.fetch.bind(globalThis),
  ) {
    this.baseURL = baseURL?.trim().replace(/\/+$/, "") || null;
    this.demo = this.baseURL ? null : new DemoConversationStore();
  }

  createConversation(input: CreateConversationInput): Promise<ChatConversation> {
    if (this.demo) return this.demo.createConversation(input);
    return this.request("/api/v1/conversations", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  addMessage(conversationId: string, input: AddMessageInput): Promise<ChatConversation> {
    if (this.demo) return this.demo.addMessage(conversationId, input);
    return this.request(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * Continues a chat across ephemeral serverless instances. The normal endpoint is
   * attempted first; a missing in-memory conversation is rebuilt with its complete
   * text context so the user never loses the demo flow.
   */
  async continueConversation(
    previous: ChatConversation,
    input: AddMessageInput,
  ): Promise<ChatConversation> {
    try {
      return await this.addMessage(previous.conversationId, input);
    } catch (error) {
      if (!(error instanceof ServeAIAPIError) || error.status !== 404) throw error;

      const transcript = previous.timeline
        .filter((item): item is TextMessage => item.type === "message")
        .map((item) => `${item.role === "user" ? "Usuário" : "ServeAI"}: ${item.content}`)
        .join("\n");
      const rebuilt = await this.createConversation({
        clientMessageId: input.clientMessageId,
        message: [
          "Continue esta conversa preservando todo o contexto abaixo.",
          transcript,
          `Nova mensagem do usuário: ${input.message}`,
        ].join("\n\n"),
      });
      const rebuiltTimeline = rebuilt.timeline.map((item) =>
        item.type === "message" && item.role === "user"
          ? { ...item, content: input.message }
          : item,
      );
      return normalizeConversation({
        ...rebuilt,
        timeline: [...previous.timeline, ...rebuiltTimeline],
      });
    }
  }

  getConversation(conversationId: string): Promise<ChatConversation> {
    if (this.demo) return this.demo.getConversation(conversationId);
    return this.request(`/api/v1/conversations/${encodeURIComponent(conversationId)}`);
  }

  private async request(path: string, init?: RequestInit): Promise<ChatConversation> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseURL ?? ""}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
    } catch {
      throw new ServeAIAPIError(
        "Não foi possível conectar ao ServeAI. Verifique sua conexão e tente novamente.",
        null,
        true,
      );
    }

    if (!response.ok) {
      let detail = "O ServeAI não conseguiu concluir esta ação.";
      try {
        detail = errorDetail(await response.json()) ?? detail;
      } catch {
        // Keep the safe, user-facing fallback above for non-JSON responses.
      }
      const retryable =
        response.status === 408 ||
        response.status === 409 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;
      throw new ServeAIAPIError(detail, response.status, retryable);
    }

    return normalizeConversation((await response.json()) as ChatConversation);
  }
}

class DemoConversationStore {
  private conversation: ChatConversation | null = null;
  private readonly clientMessageIds = new Set<string>();
  private sequence = 0;

  async createConversation(input: CreateConversationInput): Promise<ChatConversation> {
    if (this.conversation && this.clientMessageIds.has(input.clientMessageId)) {
      return structuredClone(this.conversation);
    }

    const now = new Date();
    const conversationId = crypto.randomUUID();
    this.clientMessageIds.add(input.clientMessageId);
    this.conversation = {
      conversationId,
      status: "needs_user_input",
      canSendMessage: true,
      pollAfterMs: null,
      timeline: [
        this.message("user", input.message, now),
        this.message(
          "assistant",
          "Para eu comparar as opções, informe seu orçamento máximo, o melhor horário e o endereço completo.",
          new Date(now.getTime() + 100),
        ),
      ],
      serviceRequest: {
        serviceType: inferDemoService(input.message),
        problem: input.message,
        location: input.location ?? { neighborhood: "Pinheiros", city: "São Paulo" },
        availability: [],
      },
      updatedAt: now.toISOString(),
    };
    return structuredClone(this.conversation);
  }

  async addMessage(
    conversationId: string,
    input: AddMessageInput,
  ): Promise<ChatConversation> {
    const conversation = this.requireConversation(conversationId);
    if (this.clientMessageIds.has(input.clientMessageId)) return structuredClone(conversation);

    this.clientMessageIds.add(input.clientMessageId);
    const now = new Date();
    const start = new Date(now.getTime() + 2 * 60 * 60 * 1_000);
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1_000);
    conversation.serviceRequest = {
      ...conversation.serviceRequest,
      budget: { maximum: 250, currency: "BRL" },
      availability: [{ start: start.toISOString(), end: end.toISOString() }],
      location: {
        ...conversation.serviceRequest.location,
        address: "Endereço informado na conversa (demonstração)",
      },
    };
    conversation.timeline.push(
      this.message("user", input.message, now),
      this.message(
        "assistant",
        "Tenho tudo o que preciso. Vou demonstrar a busca e o contato agora.",
        new Date(now.getTime() + 100),
      ),
      this.operation("searching", "Procurando prestadores", "Pinheiros, São Paulo", now),
      {
        id: this.id("providers"),
        type: "providers",
        providers: [
          {
            id: "demo-provider-1",
            name: "Chaveiro Pinheiros Demo",
            address: "Atendimento demonstrativo em Pinheiros",
            rating: 4.9,
            reviewCount: 214,
          },
          {
            id: "demo-provider-2",
            name: "Chaves Express Demo",
            address: "Atendimento demonstrativo em São Paulo",
            rating: 4.8,
            reviewCount: 138,
          },
          {
            id: "demo-provider-3",
            name: "Chaveiro Central Demo",
            address: "Atendimento demonstrativo na região",
            rating: 4.7,
            reviewCount: 89,
          },
        ],
        createdAt: new Date(now.getTime() + 200).toISOString(),
      },
      this.operation("contacting", "Contatando prestadores", "Simulação segura", now),
      this.operation("waiting_for_replies", "Aguardando respostas", "Modo demonstração", now),
    );
    conversation.status = "waiting_for_replies";
    conversation.canSendMessage = false;
    conversation.pollAfterMs = 1_000;
    conversation.updatedAt = now.toISOString();
    return structuredClone(conversation);
  }

  async getConversation(conversationId: string): Promise<ChatConversation> {
    const conversation = this.requireConversation(conversationId);
    if (conversation.status !== "waiting_for_replies") return structuredClone(conversation);

    const now = new Date();
    const start = new Date(now.getTime() + 2 * 60 * 60 * 1_000);
    const end = new Date(start.getTime() + 60 * 60 * 1_000);
    const calendarURL = new URL("https://calendar.google.com/calendar/render");
    calendarURL.search = new URLSearchParams({
      action: "TEMPLATE",
      text: "ServeAI Demo — Chaveiro Pinheiros",
      details: "Compromisso simulado pela demonstração da ServeAI.",
      location: "Endereço informado na conversa (demonstração)",
    }).toString();
    conversation.timeline.push(
      {
        id: this.id("offer"),
        type: "offer",
        providerId: "demo-provider-1",
        providerName: "Chaveiro Pinheiros Demo",
        price: 180,
        availableAt: start.toISOString(),
        withinBudget: true,
        withinAvailability: true,
        acceptable: true,
        createdAt: now.toISOString(),
      },
      {
        id: this.id("booking"),
        type: "booking",
        providerName: "Chaveiro Pinheiros Demo",
        start: start.toISOString(),
        end: end.toISOString(),
        price: 180,
        address: "Endereço informado na conversa (demonstração)",
        calendarEventUrl: calendarURL.toString(),
        createdAt: new Date(now.getTime() + 100).toISOString(),
      },
      this.message(
        "assistant",
        "Demonstração concluída — a resposta do prestador e o agendamento acima são simulados. Configure a URL do backend para ativar o fluxo real.",
        new Date(now.getTime() + 200),
      ),
    );
    conversation.status = "booked";
    conversation.canSendMessage = false;
    conversation.pollAfterMs = null;
    conversation.updatedAt = now.toISOString();
    return structuredClone(conversation);
  }

  private requireConversation(conversationId: string): ChatConversation {
    if (!this.conversation || this.conversation.conversationId !== conversationId) {
      throw new ServeAIAPIError("Conversa de demonstração não encontrada.", 404, false);
    }
    return this.conversation;
  }

  private id(prefix: string): string {
    this.sequence += 1;
    return `demo-${prefix}-${this.sequence}`;
  }

  private message(
    role: TextMessage["role"],
    content: string,
    createdAt: Date,
  ): TextMessage {
    return {
      id: this.id("message"),
      type: "message",
      role,
      content,
      createdAt: createdAt.toISOString(),
    };
  }

  private operation(
    status: RequestStatus,
    title: string,
    detail: string,
    createdAt: Date,
  ): OperationCard {
    return {
      id: this.id("operation"),
      type: "operation",
      status,
      title,
      detail,
      createdAt: createdAt.toISOString(),
    };
  }
}

function inferDemoService(message: string): string {
  const normalized = message.toLocaleLowerCase("pt-BR");
  if (normalized.includes("encan")) return "encanador";
  if (normalized.includes("eletric")) return "eletricista";
  if (normalized.includes("limpeza") || normalized.includes("faxina")) return "limpeza";
  return "chaveiro";
}

export function createClientMessageId(): string {
  return crypto.randomUUID();
}
