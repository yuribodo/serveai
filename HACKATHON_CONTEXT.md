# ServeAI Hackathon Context

This file is the implementation guardrail for the hackathon. It records the product
intent, constraints and demo rules supplied to the backend team so that scope remains
clear under the three-hour timebox.

## Goal

Prove that ServeAI can move a user's local-service request from **intent to booked**
without leaving a ChatGPT-like conversation. The primary demo is a locksmith request.
The difficult primitives must be real: structured understanding, provider discovery,
outbound email, inbound webhook interpretation, deterministic constraint evaluation
and calendar creation.

## Team responsibility and timebox

- This repository/team is responsible for the backend contract and integrations.
- The implementation window is three hours; favor one reliable golden path over breadth.
- Code must be organized, typed, testable and readable because the implementation will
  be inspected during judging.
- New work must be attributable through clear commits and documentation.
- Existing user and repository data must not be overwritten or exposed.

## P0 scope

- Chat conversation endpoints with complete, polling-friendly timeline snapshots.
- Idempotent client messages using `clientMessageId`.
- Extraction of service, problem, region, budget and availability.
- Explicit, deterministic request state machine.
- Real Google Places results and deterministic candidate ranking.
- Operation, provider, offer, booking and recoverable-error cards in the chat timeline.
- Parallel email outreach through Resend and signed inbound webhook handling.
- Natural-language offer extraction followed by deterministic budget/time validation.
- Exact-address collection before booking.
- Idempotent Google Calendar event creation and final confirmation in chat.
- Supabase persistence protected by RLS and server-only credentials.

## Product and engineering rules

- The product name is **ServeAI** everywhere.
- The LLM may interpret language but may not directly mutate state or execute side
  effects. Application services validate transitions and call external adapters.
- APIs use camelCase externally and typed Pydantic models internally.
- Timeline item IDs are stable; retries and polling may not duplicate messages, offers
  or bookings.
- The frontend is a single chat screen. No dashboard, token streaming, WebSocket or SSE
  is required for V1.
- Polling is the asynchronous update mechanism; the backend communicates the next delay
  through `pollAfterMs`.
- User-visible integration failures become safe error events; logs must not contain
  secrets, raw credentials or unnecessary personal information.
- Time-dependent language is interpreted in `America/Sao_Paulo`.

## Demo integrity and safety

- Provider discovery uses real public Places data.
- Outreach in the demo is redirected by `DEMO_CONTACT_OVERRIDE` to an inbox controlled
  by the team. The UI and documentation must not claim that listed businesses received
  or answered those messages.
- Do not send cold WhatsApp, SMS or automated calls. WhatsApp/Twilio is stretch scope
  only for a controlled, opted-in sandbox number.
- Search public business sites only for explicitly published contact details; use short
  timeouts and do not scrape private or authenticated content.
- Share only an approximate region during discovery. The exact address is requested
  only when an acceptable offer is ready to book.
- Any API key exposed in chat, source control, logs or a screenshot is compromised and
  must be revoked. Only replacement keys stored in backend environment secrets may be
  used.

## Explicitly out of scope

- Authentication, provider accounts and a provider dashboard.
- Payments, Pix, invoices or marketplace settlement.
- Production-grade ranking, pricing prediction or multi-job orchestration.
- Native mobile applications, push notifications and real-time transports.
- Cold phone, SMS or WhatsApp outreach and fragile contact-form automation.
- Direct writes to an external provider's calendar without their authorization.

## Success criteria

The demo succeeds when a user starts with a natural-language request, completes any
missing constraints in chat, sees real nearby candidates, triggers email to the
controlled inbox, receives a parsed compatible offer and ends with exactly one real
Google Calendar event plus a `booking` item in the timeline.

Failures, late replies and out-of-constraint offers must remain safe: they are recorded
and explained, but they never create an unauthorized booking.
