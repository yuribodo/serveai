# ServeAI Backend Architecture

## Design goals

The backend serves a single chat interface while coordinating asynchronous, real-world
work. The HTTP layer remains thin; deterministic application and domain layers own
workflow decisions; integrations sit behind explicit ports. This keeps the judged code
easy to read and makes external services replaceable in tests.

```mermaid
flowchart LR
    UI[Next.js chat] -->|REST + polling| API[FastAPI API]
    API --> ORCH[Conversation orchestrator]
    ORCH --> DOMAIN[Domain state machine<br/>and offer rules]
    ORCH --> LLM[LangChain structured extraction]
    ORCH --> PLACES[Google Places discovery]
    ORCH --> MAIL[Resend email adapter]
    ORCH --> CAL[Google Calendar adapter]
    ORCH --> REPO[Conversation repository]
    REPO --> DB[(Supabase Postgres)]
    MAIL -->|signed inbound webhook| API
```

Dependency direction is inward: `api` and `infrastructure` depend on application ports
and domain models, while domain code does not import FastAPI, Supabase, LangChain or a
Google SDK.

## Golden path

```mermaid
sequenceDiagram
    actor User
    participant UI as Chat UI
    participant API as FastAPI
    participant Agent as Orchestrator
    participant Places as Google Places
    participant Email as Resend
    participant Provider as Controlled inbox
    participant Calendar as Google Calendar
    participant DB as Supabase

    User->>UI: Describes a service need
    UI->>API: POST conversation/message
    API->>Agent: Handle idempotent message
    Agent->>DB: Save message and extracted request
    Agent-->>UI: Ask one missing requirement
    loop Until required fields are complete
        User->>UI: Adds a constraint
        UI->>API: POST message
        API->>Agent: Merge structured requirements
    end
    Agent->>Places: Search nearby providers
    Places-->>Agent: Public business results
    Agent->>Email: Send outreach in parallel
    Agent->>DB: Save providers, outreach and events
    API-->>UI: Timeline snapshot + pollAfterMs
    Provider->>Email: Replies with price and time
    Email->>API: Signed email.received webhook
    API->>Agent: Interpret and evaluate offer
    Agent->>DB: Save offer exactly once
    alt Compatible offer and exact address known
        Agent->>Calendar: Create idempotent event
        Calendar-->>Agent: Event ID and URL
        Agent->>DB: Save booking exactly once
    else Exact address missing
        Agent->>DB: Set needs_user_input and add question
    else Offer exceeds a constraint
        Agent->>DB: Keep offer without booking
    end
    UI->>API: GET conversation
    API-->>UI: Updated offer/booking timeline
```

## State machine

The LLM never selects a status. Application code validates every transition.

```mermaid
stateDiagram-v2
    [*] --> collecting_requirements
    collecting_requirements --> ready: required data complete
    ready --> searching
    searching --> providers_found
    providers_found --> contacting
    contacting --> waiting_for_replies
    waiting_for_replies --> offer_received: inbound offer
    offer_received --> accepted: constraints satisfied
    offer_received --> waiting_for_replies: incompatible/declined
    offer_received --> needs_user_input: address or decision required
    needs_user_input --> accepted: user supplies address/approval
    needs_user_input --> collecting_requirements: request data still missing
    accepted --> booked: calendar event created
    collecting_requirements --> failed
    ready --> failed
    searching --> failed
    providers_found --> failed
    contacting --> failed
    waiting_for_replies --> failed
    offer_received --> failed
    needs_user_input --> failed
    accepted --> failed
    failed --> collecting_requirements: retry request workflow
    failed --> accepted: retry idempotent booking
    failed --> needs_user_input: accepted offer still needs address
```

`booked` is terminal. A `failed` request can be retried explicitly and then returns to
requirement collection without losing prior fields. While waiting for an external reply,
`canSendMessage` is false and `pollAfterMs` is normally `2000`. When user input is
required, `canSendMessage` becomes true and polling stops.

## Frontend timeline contract

All public JSON uses camelCase. A conversation response is a complete snapshot:

```ts
type RequestStatus =
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

type TimelineItem =
  | TextMessage
  | OperationCard
  | ProvidersCard
  | OfferCard
  | BookingCard
  | ErrorCard;

interface ChatConversation {
  conversationId: string;
  status: RequestStatus;
  canSendMessage: boolean;
  pollAfterMs: number | null;
  timeline: TimelineItem[];
  serviceRequest: ServiceRequest;
  updatedAt: string;
}
```

Every timeline item has `id`, a discriminator `type`, and `createdAt`. The variants add:

| `type` | Data rendered by the chat |
| --- | --- |
| `message` | `role` and `content` for a user/assistant bubble. |
| `operation` | Current `status`, `title` and optional `detail`. |
| `providers` | A `providers` array with name, address, rating and public contact metadata. |
| `offer` | Provider, price, proposed time and budget/availability compatibility. |
| `booking` | Provider, start/end, price, address and optional calendar event URL. |
| `error` | Safe `code`, user-facing `message` and `retryable` flag. |

The frontend must preserve API order, use `item.id` as the React key and replace its
local snapshot after each successful response. It must not infer workflow state from
text. `clientMessageId` is generated once per composer submission and reused on network
retry; the server returns the existing conversation instead of duplicating the message.

## Persistence and idempotency

The aggregate is persisted across seven tables. Messages and agent events share a
monotonic per-conversation sequence, which produces a stable merged timeline. Database
constraints guard global client-message retries, inbound email replay and duplicate
calendar bookings.

```mermaid
erDiagram
    service_requests ||--o{ messages : contains
    service_requests ||--o{ provider_candidates : discovers
    service_requests ||--o{ outreaches : sends
    service_requests ||--o{ provider_offers : receives
    service_requests ||--o| bookings : creates
    service_requests ||--o{ agent_events : records
    provider_candidates ||--o{ outreaches : targeted_by
    provider_candidates ||--o{ provider_offers : replies_with
    provider_candidates ||--o| bookings : fulfills
    provider_offers ||--o| bookings : accepted_as
```

The database is not a public frontend API. RLS is enabled without client policies;
`anon` and `authenticated` have no table privileges. Only the backend's Supabase
`service_role` accesses these records.

## Failure and privacy boundaries

- External calls use bounded timeouts and safe retries; idempotency is checked before
  repeating an email, offer insert or booking.
- Every Resend outreach carries a stable provider/conversation idempotency key, so a
  network retry cannot send the same request twice within Resend's protection window.
- Webhook processing starts by validating the Svix signature over the raw request body.
- Unknown or replayed inbound IDs do not create another offer.
- Logs carry correlation IDs and state transitions, never API keys or full credentials.
- Discovery outreach contains an approximate region, not the residential address.
- The demo contact override routes messages to a controlled inbox and is explicit in
  the operational timeline/documentation.
- Vercel preview and production runtimes require Supabase; process-local memory is
  accepted only for local development and tests.
