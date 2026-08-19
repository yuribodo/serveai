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

const defaultAPIURL = process.env.NEXT_PUBLIC_SERVEAI_API_URL?.trim() || "http://localhost:8000";

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
  private readonly baseURL: string;

  constructor(baseURL = defaultAPIURL, private readonly fetcher: Fetcher = fetch) {
    this.baseURL = baseURL.trim().replace(/\/+$/, "");
  }

  createConversation(input: CreateConversationInput): Promise<ChatConversation> {
    return this.request("/api/v1/conversations", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  addMessage(conversationId: string, input: AddMessageInput): Promise<ChatConversation> {
    return this.request(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getConversation(conversationId: string): Promise<ChatConversation> {
    return this.request(`/api/v1/conversations/${encodeURIComponent(conversationId)}`);
  }

  private async request(path: string, init?: RequestInit): Promise<ChatConversation> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseURL}${path}`, {
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

export function createClientMessageId(): string {
  return crypto.randomUUID();
}
