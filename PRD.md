# FIELD

## Autonomous Local Services Agent

**Version:** Hackathon V1  
**Core use case:** Local service discovery → contact → negotiation → booking  
**Primary demo:** Locksmith / Chaveiro

---

# 1. Product Vision

FIELD is an AI agent that gets local service jobs done on behalf of the user.

Instead of:

> Search Google → open 10 businesses → call/message each one → explain the problem repeatedly → compare prices → find an available time → schedule.

The user says:

> **“Preciso de um chaveiro.”**

FIELD takes over the operational work.

It understands what is needed, collects the user's constraints, searches for suitable professionals nearby, contacts them, understands their responses, selects an option that satisfies the user's constraints and creates the appointment.

### Product promise

**Ask once. FIELD handles the rest.**

---

# 2. Problem

Hiring a local service provider is surprisingly manual.

For something as simple as finding a locksmith, plumber, electrician or technician, the customer normally needs to:

1. Search for professionals.
2. Compare ratings.
3. Find contact information.
4. Contact several providers.
5. Explain the problem repeatedly.
6. Ask about price.
7. Ask about availability.
8. Compare replies.
9. Agree on a time.
10. Add the appointment to the calendar.

Search engines help users **discover** providers.

FIELD should help users **complete the job**.

---

# 3. V1 Product Thesis

FIELD is not:

**“AI that recommends local businesses.”**

FIELD is:

**“AI that hires the local business for you.”**

The difference is action.

```text
Intent
  ↓
Understand requirements
  ↓
Find providers
  ↓
Contact providers
  ↓
Receive responses
  ↓
Evaluate constraints
  ↓
Choose provider
  ↓
Book appointment

```

---

# 4. Primary User Story

### Initial request

User:

> “Preciso de um chaveiro.”

FIELD identifies missing information.

### FIELD

> “Consigo resolver isso para você. Onde você está?”

The user can:

- share current location;
- enter an address;
- enter neighborhood / ZIP code.

Then FIELD asks:

> “O que aconteceu com a fechadura?”

Example:

> “Perdi minha chave e estou trancado para fora.”

FIELD:

> “Quanto você gostaria de gastar?”

User:

> “Entre R$100 e R$200.”

FIELD:

> “Quando você consegue receber o chaveiro?”

User:

> “Hoje entre 14h e 18h.”

FIELD now has enough information to act.

---

# 5. Structured Service Request

The conversation must be converted into structured data.

```ts
ServiceRequest {
  serviceType: "locksmith"

  problem:
    "Customer lost their key and cannot enter the apartment"

  location: {
    address?: string
    neighborhood: string
    city: string
    latitude: number
    longitude: number
  }

  budget: {
    min: 100
    max: 200
    currency: "BRL"
  }

  availability: [
    {
      start: "2026-08-19T14:00:00-03:00"
      end: "2026-08-19T18:00:00-03:00"
    }
  ]

  urgency: "today"
}

```

The LLM should extract as much as possible from the original message and ask only for missing required information.

---

# 6. Required Information

Before FIELD begins searching, the request must contain:


| Field           | Required | Example              |
| --------------- | --------: | -------------------- |
| Service         | Yes      | Chaveiro             |
| Problem         | Yes      | Perdi a chave        |
| Region/location | Yes      | Pinheiros, São Paulo |
| Budget range    | Yes      | R$100–200            |
| Availability    | Yes      | Today, 14:00–18:00   |
| Urgency         | Derived  | Today                |
| Exact address   | Later    | Shared after booking |


FIELD should avoid asking questions when the information can already be inferred from the conversation.

---

# 7. Provider Discovery

Once the request is complete, FIELD searches for local providers.

### Search

Example conceptual query:

```text
"chaveiro perto de Pinheiros São Paulo"

```

Search should use the user's geographic location as a strong constraint.

### Information collected

For each provider:

```ts
Provider {
  id: string

  name: string

  location: {
    address: string
    latitude: number
    longitude: number
  }

  rating?: number
  reviewCount?: number

  phone?: string
  website?: string

  distance?: number

  email?: string
}

```

### Candidate selection

FIELD initially selects approximately **3–5 providers**.

Ranking factors:

```text
service relevance
+
distance
+
rating
+
review volume
+
opening status
+
contactability

```

For the hackathon, the scoring algorithm does not need to be sophisticated.

---

# 8. Important Google Maps Limitation

Google Places should be used for **provider discovery**, not email discovery.

Google Places currently exposes information such as phone number, address, website, location and ratings, but its documented Place fields do not expose a general business-email field.

Therefore the contact pipeline is:

```text
Google Places
       ↓
websiteUri
       ↓
Provider website
       ↓
Find public contact email
       ↓
Email provider

```

### V1 fallback

If no email can be discovered:

```text
email found
   → candidate eligible

no email found
   → skip candidate

```

Future FIELD versions could fall back to:

```text
WhatsApp
phone call
contact form
SMS

```

But those are outside the hackathon V1.

---

# 9. Outreach

Once FIELD has candidate providers, the AI contacts them automatically.

Example email:

**Subject**

```text
Solicitação de serviço — Chaveiro hoje

```

**Body**

```text
Olá!

Tenho um cliente procurando um chaveiro na região de
Pinheiros para hoje.

Serviço:
Cliente perdeu a chave e precisa de abertura de porta.

Região:
Pinheiros — São Paulo

Disponibilidade:
Hoje entre 14h e 18h.

Orçamento:
Até R$200.

Você consegue realizar o serviço?

Se sim, responda com o valor e o horário disponível.

FIELD

```

Important:

The exact residential address should not need to be exposed during the initial discovery stage.

Initially FIELD can share only the approximate service area.

The precise address becomes part of the booking after the provider is selected.

---

# 10. Parallel Outreach

FIELD should not wait for providers sequentially.

Instead:

```text
Provider A ───── email ─────→
Provider B ───── email ─────→
Provider C ───── email ─────→

```

UI:

```text
Finding locksmiths nearby...

✓ 8 locksmiths found

Contacting the best matches...

✓ Chaveiro Pinheiros
✓ Chaveiro 24 Horas SP
✓ Central das Chaves

Waiting for replies...

```

This state is important because it proves that the agent is actively working.

---

# 11. Receiving Provider Responses

The email must use a reply address associated with the request.

Example:

```text
request+req_8127@reply.field.ai

```

When the provider replies, FIELD receives the incoming email.

Resend currently supports inbound email and can fire an `email.received` webhook when a response arrives, which makes this asynchronous loop viable without repeatedly polling an inbox.

Example provider response:

> “Boa tarde. Consigo ir às 15:30. Fica R$180.”

FIELD converts this into:

```ts
ProviderOffer {
  providerId: "provider_123"

  price: 180

  availableAt:
    "2026-08-19T15:30:00-03:00"

  status: "available"
}

```

---

# 12. AI Response Interpretation

The provider is not required to use any special system.

They simply reply naturally to the email.

Examples:

```text
"Consigo às 16:00 por 150."

```

```text
"Hoje só depois das 19."

```

```text
"Faço por 250 reais."

```

```text
"Que tipo de fechadura é?"

```

The AI interprets those responses.

---

# 13. Decision Engine

FIELD compares the provider response against the constraints established by the user.

User:

```text
Budget: R$100–200
Availability: 14:00–18:00

```

Provider:

```text
Price: R$180
Time: 15:30

```

Result:

```text
✓ Budget compatible
✓ Schedule compatible
✓ Correct service

→ ACCEPTABLE OFFER

```

---

# 14. Autonomous Booking Rule

FIELD can book automatically when all previously authorized constraints are satisfied.

Example:

```text
price <= user's maximum budget
AND
appointment ∈ user's availability
AND
provider offers requested service

```

Then FIELD does not need to ask:

> “Posso marcar?”

The user already defined the boundaries.

This is an important part of making FIELD feel like an **agent rather than a chatbot**.

---

# 15. When FIELD Must Ask the User

Provider:

> “Consigo às 18:30 por R$230.”

User's constraints:

```text
until 18:00
max R$200

```

FIELD must not accept automatically.

Instead:

> O Chaveiro Central consegue te atender hoje às 18:30 por R$230. É R$30 acima do seu orçamento e 30 minutos depois do horário que você informou. Quer que eu aceite?

The user remains in control whenever an agent needs to exceed an explicit constraint.

---

# 16. Provider Questions

A provider may respond:

> “Qual é o modelo da fechadura?”

FIELD first checks whether it already knows the answer.

If yes:

```text
FIELD → responds automatically

```

If no:

```text
Provider
   ↓
FIELD
   ↓
User

```

Example:

> O chaveiro perguntou qual é o tipo da sua fechadura. Você sabe dizer se ela é tetra, multiponto ou comum?

User:

> “É uma fechadura comum.”

FIELD replies to the provider automatically.

---

# 17. Calendar Booking

Once an offer is accepted, FIELD creates the appointment.

```text
Chaveiro — Abertura de porta

Today
15:30–16:30

Chaveiro Pinheiros

Address:
Rua Example, 123

Estimated price:
R$180

```

Google Calendar supports creating events and adding other people as attendees.

### User

FIELD creates the event in the user's connected calendar.

### Provider

If the provider has connected FIELD:

```text
FIELD → create directly in provider calendar

```

If the provider is external:

```text
FIELD → add provider email as attendee

```

The provider receives the calendar invitation.

Therefore, for V1, **“both calendars” means guaranteed write access to the user's calendar plus an attendee invitation for an external provider**. Direct writes to both independent calendars require authorization from both accounts.

---

# 18. Final User Experience

The conversation becomes:

### User

> Preciso de um chaveiro.

### FIELD

> Claro. Onde você está?

### User

> Pinheiros, São Paulo.

### FIELD

> O que aconteceu?

### User

> Perdi minha chave e estou trancado pra fora.

### FIELD

> Qual faixa de valor você quer gastar?

### User

> Até R$200.

### FIELD

> Qual seu horário disponível?

### User

> Hoje entre 14h e 18h.

### FIELD

> Entendi. Vou procurar chaveiros próximos que consigam atender dentro desse horário e orçamento.

Then the interface transitions from conversation to operation:

```text
SEARCHING

12 locksmiths nearby

```

↓

```text
CONTACTING

3 providers contacted

```

↓

```text
WAITING FOR REPLIES

```

↓

A provider replies.

```text
NEW OFFER

Chaveiro Pinheiros
★ 4.8

15:30
R$180

✓ Within budget
✓ Within availability

```

↓

```text
BOOKED ✓

```

FIELD:

> **Resolvido. O Chaveiro Pinheiros confirmou por R$180 e chega às 15:30. Já coloquei o compromisso na sua agenda e enviei a confirmação para ele.**

That is the V1 wow moment.

---

# 19. State Machine

Every service request has an explicit state.

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

```

Primary golden path:

```text
COLLECTING_REQUIREMENTS
          ↓
        READY
          ↓
      SEARCHING
          ↓
   PROVIDERS_FOUND
          ↓
      CONTACTING
          ↓
 WAITING_FOR_REPLIES
          ↓
   OFFER_RECEIVED
          ↓
       ACCEPTED
          ↓
        BOOKED

```

---

# 20. Agent Tools

The AI should interact with deterministic application tools instead of pretending actions occurred.

### `create_service_request`

Creates the structured request.

```ts
create_service_request({
  service,
  problem,
  location,
  budget,
  availability
})

```

### `search_providers`

```ts
search_providers({
  serviceType,
  latitude,
  longitude,
  radius
})

```

### `find_provider_contact`

```ts
find_provider_contact({
  providerId,
  website
})

```

### `contact_providers`

```ts
contact_providers({
  requestId,
  providerIds
})

```

### `evaluate_offer`

```ts
evaluate_offer({
  requestId,
  providerId,
  price,
  time
})

```

### `reply_to_provider`

```ts
reply_to_provider({
  threadId,
  message
})

```

### `book_service`

```ts
book_service({
  requestId,
  providerId,
  startTime,
  endTime,
  price
})

```

### `notify_user`

```ts
notify_user({
  requestId,
  message
})

```

The LLM understands language.

The application controls side effects.

---

# 21. Main Entities

## ServiceRequest

Represents what the user wants.

## Provider

Local business returned from discovery.

## ProviderCandidate

Provider selected for outreach.

## Outreach

Email/thread between FIELD and provider.

## ProviderOffer

Structured interpretation of a provider response.

## Booking

Final agreement.

## AgentEvent

Every action FIELD performs.

Example:

```ts
AgentEvent {
  type: "provider_contacted"
  timestamp: "..."
  metadata: {}
}

```

---

# 22. UI

V1 should still primarily feel like a chat.

But the key differentiator is that **actions appear inside the conversation**.

Example:

```text
┌──────────────────────────────────────┐

 FIELD

 Preciso de um chaveiro.

 Claro. Onde você está?

 [conversation...]

 ┌──────────────────────────────────┐
 │ Searching nearby                 │
 │                                  │
 │ ✓ 12 locksmiths found            │
 │ ✓ 3 selected                     │
 └──────────────────────────────────┘

 ┌──────────────────────────────────┐
 │ Contacting providers             │
 │                                  │
 │ ✓ Chaveiro Pinheiros             │
 │ ✓ Central das Chaves             │
 │ ✓ Chaveiro Express               │
 │                                  │
 │ Waiting for responses...         │
 └──────────────────────────────────┘

             ● ● ●

 ┌──────────────────────────────────┐
 │ OFFER RECEIVED                   │
 │                                  │
 │ Chaveiro Pinheiros     ★ 4.8     │
 │                                  │
 │ R$180          Today · 15:30     │
 │                                  │
 │ ✓ Within your preferences        │
 └──────────────────────────────────┘

 Resolvido.

 O chaveiro chega às 15:30.
 Já coloquei na sua agenda.

└──────────────────────────────────────┘

```

**No separate dashboard is required for V1.**

The operational state lives inside the chat.

---

# 23. User Notifications

The user does not need to keep FIELD open.

If FIELD is waiting for a provider:

```text
WAITING_FOR_REPLIES

```

and a response arrives later:

```text
email.received
       ↓
parse response
       ↓
evaluate offer
       ↓
update request
       ↓
notify user

```

Hackathon V1 only needs the in-app notification.

Push notifications, SMS and WhatsApp are future extensions.

---

# 24. P0 — Hackathon Requirements

The hackathon version is considered successful when this full loop works:

- User requests a service through chat.
- AI determines missing requirements.
- AI collects location.
- AI collects problem/context.
- AI collects budget.
- AI collects availability.
- Request becomes structured data.
- Real local providers are searched.
- Provider candidates appear in the UI.
- FIELD sends an actual email.
- Provider can reply to that email.
- FIELD receives the response.
- AI extracts price and availability from natural language.
- FIELD compares the offer with user constraints.
- Matching offer is accepted.
- Calendar event is created.
- User receives final confirmation in chat.

That is the entire hackathon.

---

# 25. Explicitly Out of Scope

Do **not** build these before the core flow works:

- Pix payment
- NF-e / NFS-e
- Voice calling
- WhatsApp outreach
- Provider application
- Provider accounts
- Full authentication system
- Review system
- Complex routing
- Real-time price prediction
- Marketplace payments
- Multiple simultaneous jobs
- Production-grade ranking
- Native mobile application

All of those are potential FIELD features.

None proves the core hypothesis better than the main loop.

---

# 26. Hackathon Demo Strategy

Do not depend on a random real-world locksmith replying during the presentation.

The discovery stage should use real search results.

The **email interaction should use a controlled provider inbox** operated by the team.

Demo:

```text
User
 ↓
FIELD Chat
 ↓
Google Places
 ↓
real providers appear
 ↓
FIELD sends outreach
 ↓
controlled provider inbox
 ↓
teammate replies:
"Consigo às 15:30 por R$180"
 ↓
inbound webhook
 ↓
AI parses response
 ↓
constraints verified
 ↓
Google Calendar event
 ↓
BOOKED

```

This proves every difficult technical primitive without making the presentation dependent on whether a real locksmith happens to answer an unsolicited email during a three-minute demo.

---

# 27. V1 Technical Architecture

```text
                     ┌─────────────────┐
                     │     USER        │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │   FIELD CHAT    │
                     │    Next.js      │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │    AI AGENT     │
                     │  + Tool Calls   │
                     └────────┬────────┘
                              │
           ┌──────────────────┼─────────────────┐
           │                  │                 │
           ▼                  ▼                 ▼
     Google Places         Email            Calendar
                           Provider
           │                  │                 │
           ▼                  ▼                 ▼
      Providers           Outreach          Booking
                              │
                              ▼
                      Inbound Webhook
                              │
                              ▼
                       AI evaluates
                           response
                              │
                              ▼
                         FIELD Chat

```

---

# 28. V1 Recommended Stack

### Frontend

```text
Next.js
TypeScript
Tailwind
shadcn/ui

```

### Agent

```text
OpenAI
Tool/function calling

```

### Provider discovery

```text
Google Places API

```

Google Places provides Text Search for natural-language place discovery and location-biased queries.

### Email

```text
Resend

```

Use:

```text
Outbound Email
+
Inbound Email
+
email.received webhook

```

Resend supports receiving messages through a receiving domain and forwarding inbound email events to a webhook.

### Calendar

```text
Google Calendar API

```

### Persistence

For the hackathon:

```text
service_requests
providers
outreach
offers
bookings

```

Keep persistence minimal.

---

# 29. Success Criteria

The V1 hypothesis is proven if a user can start with:

> **“Preciso de um chaveiro.”**

and without leaving FIELD eventually reach:

> **“Resolvido. O chaveiro chega às 15:30 por R$180. O compromisso já está na sua agenda.”**

while the application has actually:

```text
understood the request
searched providers
contacted someone
received a real response
interpreted it
validated constraints
and created a real calendar event

```

---

# 30. North Star

The core product metric should eventually be:

## **Intent → Booked**

Not:

```text
messages sent

```

Not:

```text
AI conversations

```

Not:

```text
searches

```

FIELD succeeds when the user's problem goes from:

```text
"I need someone."

```

to:

```text
"It's handled."

```

# Product tagline

**FIELD — Say what you need. Consider it handled.**