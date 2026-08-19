# ServeAI

ServeAI is an autonomous local-services assistant. A user describes a need in a chat,
the backend collects the missing constraints, finds nearby providers, contacts the best
matches, interprets their replies and books an acceptable offer in Google Calendar.

The hackathon path is deliberately narrow: **chat → real providers → controlled email
reply → evaluated offer → calendar booking**.

## Architecture

- **FastAPI / Python 3.12** exposes a chat-oriented REST API.
- **LangChain + OpenAI** turn free-form messages into validated Pydantic data.
- **Google Places API (New)** discovers nearby businesses.
- **Resend** sends outreach and delivers inbound replies through a signed webhook.
- **Google Calendar** creates the final appointment.
- **Supabase Postgres** persists conversations and the operational timeline.
- **Vercel** hosts the ASGI application.

The language model extracts information; deterministic domain code owns state
transitions, offer validation and external side effects. See
[the architecture guide](backend/docs/architecture.md) and [the product PRD](PRD.md).

## Run locally

Prerequisites: Python 3.12, [`uv`](https://docs.astral.sh/uv/) and, for the complete
flow, credentials for the services listed above.

```bash
cd backend
cp .env.example .env
uv sync --all-groups
uv run uvicorn app.main:app --reload
```

The API is available at `http://127.0.0.1:8000`; interactive OpenAPI documentation is
at `http://127.0.0.1:8000/docs`.

For local development without Supabase, set `REPOSITORY_BACKEND=memory`. Real
integrations activate only when their corresponding environment variables are set.
Never commit `.env` or place secrets in frontend code.

Start the chat interface in a second terminal:

```bash
cd frontend
cp .env.example .env.local
pnpm install
pnpm dev
```

For a network-free presentation rehearsal, set `DEMO_AUTO_REPLY=true` in the backend.
The API will produce a clearly identified simulated provider response after the polling
delay; `/health` will still report the contact and calendar adapters as `demo`. Leave
this option disabled for any real-service demonstration.

## API contract

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/conversations` | Start a chat with `message` and a stable `clientMessageId`. |
| `POST` | `/api/v1/conversations/{conversationId}/messages` | Continue a conversation idempotently. |
| `GET` | `/api/v1/conversations/{conversationId}` | Read the complete timeline snapshot for polling. |
| `POST` | `/api/v1/webhooks/resend` | Receive signed inbound-email events. |
| `GET` | `/health` | Check application health and configured capabilities. |

The frontend renders `timeline` in order and keys every item by its stable `id`. It
shows a typing indicator while a `POST` is pending and polls again when
`pollAfterMs` is non-null. It disables the composer when `canSendMessage` is false.

Example request:

```json
{
  "message": "Preciso de um chaveiro em Pinheiros hoje entre 14h e 18h, até R$ 200.",
  "clientMessageId": "web-01J5W8QJ77E2J8X5M2J6B51ZQF"
}
```

## Database

The initial migration is
[`backend/supabase/migrations/0001_initial_schema.sql`](backend/supabase/migrations/0001_initial_schema.sql).
Apply it to a dedicated Supabase project through the Supabase migration workflow
(`supabase link`, then `supabase db push`). Every application table has Row Level
Security enabled, no client policy, and privileges revoked from `anon` and
`authenticated`; only the server-side secret/service-role key may access application
data.

Set `REPOSITORY_BACKEND=supabase`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY` only in the
backend runtime. Never expose the service-role key through a `NEXT_PUBLIC_*` variable.
Production also fails fast when OpenAI, Google Places, signed Resend inbound email or
Google Calendar credentials are incomplete; local development keeps deterministic demo
adapters for each missing integration.

## External-service setup

1. Create a restricted OpenAI project key and set `OPENAI_API_KEY` in the backend.
2. Enable Places API (New) and set `GOOGLE_PLACES_API_KEY`.
3. Configure a Resend sending identity, inbound domain and signed webhook pointing to
   `/api/v1/webhooks/resend`.
4. Configure Google OAuth refresh credentials and a dedicated **ServeAI Demo** calendar.
5. Set `DEMO_CONTACT_OVERRIDE` to a team-controlled inbox for the presentation. Search
   results remain real, but unsolicited outreach is not sent to real businesses.
6. Allow the deployed frontend origin through `FRONTEND_ORIGINS`.

The exact residential address is not included in initial outreach. It is requested
before booking and shared only with the selected provider/calendar event.

## Quality checks

```bash
cd backend
uv run ruff check .
uv run ruff format --check .
uv run mypy app
uv run pytest
```

The same checks run in GitHub Actions for changes under `backend/`.

## Deploy

Create a Vercel project whose root directory is `backend`, configure the environment
variables in the Vercel dashboard, then deploy. Vercel discovers the FastAPI instance
through `app/server.py`; `backend/vercel.json` intentionally contains no legacy build
or route override. Set `APP_ENV=production`, `REPOSITORY_BACKEND=supabase`,
`SUPABASE_URL` and `SUPABASE_SECRET_KEY`. The backend refuses to start with in-memory
state on Vercel, because different function instances cannot share it.

Deploy the `frontend` directory as a second Next.js project, set
`NEXT_PUBLIC_SERVEAI_API_URL` to the backend URL, then add the frontend deployment URL
to the backend's `FRONTEND_ORIGINS`. Preview and production values should be configured
independently.

Before a public demo, verify that no secret appears in commits, logs or screenshots.
Any key ever pasted into a chat or issue must be revoked and replaced.

## Demo acceptance path

1. Start a conversation and provide service, location, problem, budget and availability.
2. Observe providers and operation cards appear in the chat timeline.
3. Reply from the controlled provider inbox with a price and time.
4. Observe the signed webhook produce an offer card.
5. Provide the exact address if requested.
6. Confirm a single calendar event and booking card are created.

The email loop must use a controlled inbox; the demonstration must never imply that a
real business replied when it did not.
