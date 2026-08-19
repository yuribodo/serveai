-- ServeAI initial persistence schema.
-- The frontend never accesses these tables directly. The backend uses service_role.

create extension if not exists pgcrypto;

create table public.service_requests (
    id uuid primary key default gen_random_uuid(),
    status text not null default 'collecting_requirements'
        check (
            status in (
                'collecting_requirements',
                'ready',
                'searching',
                'providers_found',
                'contacting',
                'waiting_for_replies',
                'offer_received',
                'needs_user_input',
                'accepted',
                'booked',
                'failed'
            )
        ),
    request_data jsonb not null default '{}'::jsonb
        check (jsonb_typeof(request_data) = 'object'),
    processed_client_message_ids text[] not null default '{}'::text[],
    processed_inbound_message_ids text[] not null default '{}'::text[],
    pending_offer_id uuid,
    next_sequence bigint not null default 1 check (next_sequence > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (updated_at >= created_at)
);

create table public.messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null
        references public.service_requests (id) on delete cascade,
    client_message_id text,
    role text not null check (role in ('user', 'assistant')),
    content text not null check (length(btrim(content)) > 0),
    sequence bigint not null check (sequence > 0),
    created_at timestamptz not null default now(),
    unique (conversation_id, sequence)
);

-- Creation retries do not yet know the conversation ID, so this key is global.
create unique index messages_client_message_id_unique
    on public.messages (client_message_id)
    where client_message_id is not null;

create index messages_conversation_sequence_idx
    on public.messages (conversation_id, sequence);

create table public.provider_candidates (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null
        references public.service_requests (id) on delete cascade,
    external_id text not null,
    name text not null check (length(btrim(name)) > 0),
    address text not null check (length(btrim(address)) > 0),
    latitude double precision check (latitude between -90 and 90),
    longitude double precision check (longitude between -180 and 180),
    rating numeric(2, 1) check (rating between 0 and 5),
    review_count integer check (review_count >= 0),
    phone text,
    website text,
    email text,
    business_status text,
    rank integer not null default 0 check (rank >= 0),
    created_at timestamptz not null default now(),
    unique (conversation_id, external_id),
    unique (conversation_id, id)
);

create index provider_candidates_conversation_rank_idx
    on public.provider_candidates (conversation_id, rank, id);

create table public.outreaches (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null
        references public.service_requests (id) on delete cascade,
    provider_id uuid not null,
    channel text not null default 'email' check (channel in ('email', 'whatsapp')),
    destination text not null check (length(btrim(destination)) > 0),
    reply_to text check (reply_to is null or reply_to = lower(reply_to)),
    external_message_id text,
    status text not null default 'sent',
    created_at timestamptz not null default now(),
    constraint outreaches_provider_conversation_fk
        foreign key (conversation_id, provider_id)
        references public.provider_candidates (conversation_id, id)
        on delete cascade
);

create index outreaches_conversation_created_idx
    on public.outreaches (conversation_id, created_at, id);

create index outreaches_conversation_provider_idx
    on public.outreaches (conversation_id, provider_id);

create unique index outreaches_reply_to_unique
    on public.outreaches (reply_to)
    where reply_to is not null;

create unique index outreaches_external_message_id_unique
    on public.outreaches (external_message_id)
    where external_message_id is not null;

create table public.provider_offers (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null
        references public.service_requests (id) on delete cascade,
    provider_id uuid not null,
    inbound_message_id text not null,
    status text not null check (status in ('available', 'unavailable', 'question')),
    price numeric(12, 2) check (price >= 0),
    available_at timestamptz,
    question text,
    raw_text text not null,
    within_budget boolean,
    within_availability boolean,
    acceptable boolean not null default false,
    created_at timestamptz not null default now(),
    constraint provider_offers_inbound_message_id_unique unique (inbound_message_id),
    constraint provider_offers_conversation_id_unique unique (conversation_id, id),
    constraint provider_offers_provider_conversation_fk
        foreign key (conversation_id, provider_id)
        references public.provider_candidates (conversation_id, id)
        on delete cascade
);

create index provider_offers_conversation_created_idx
    on public.provider_offers (conversation_id, created_at, id);

create index provider_offers_conversation_provider_idx
    on public.provider_offers (conversation_id, provider_id);

alter table public.service_requests
    add constraint service_requests_pending_offer_fk
    foreign key (id, pending_offer_id)
    references public.provider_offers (conversation_id, id)
    on delete no action
    deferrable initially deferred;

create index service_requests_pending_offer_idx
    on public.service_requests (pending_offer_id)
    where pending_offer_id is not null;

create table public.bookings (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null
        references public.service_requests (id) on delete cascade,
    provider_id uuid not null,
    offer_id uuid not null,
    start timestamptz not null,
    "end" timestamptz not null,
    price numeric(12, 2) not null check (price >= 0),
    calendar_event_id text not null,
    calendar_event_url text,
    created_at timestamptz not null default now(),
    check ("end" > start),
    constraint bookings_conversation_unique unique (conversation_id),
    constraint bookings_offer_unique unique (offer_id),
    constraint bookings_calendar_event_id_unique unique (calendar_event_id),
    constraint bookings_provider_conversation_fk
        foreign key (conversation_id, provider_id)
        references public.provider_candidates (conversation_id, id)
        on delete cascade,
    constraint bookings_offer_conversation_fk
        foreign key (conversation_id, offer_id)
        references public.provider_offers (conversation_id, id)
        on delete cascade
);

create index bookings_provider_idx
    on public.bookings (provider_id);

create table public.agent_events (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null
        references public.service_requests (id) on delete cascade,
    event_type text not null check (length(btrim(event_type)) > 0),
    payload jsonb not null default '{}'::jsonb
        check (jsonb_typeof(payload) = 'object'),
    sequence bigint not null check (sequence > 0),
    created_at timestamptz not null default now(),
    unique (conversation_id, sequence)
);

create index agent_events_conversation_sequence_idx
    on public.agent_events (conversation_id, sequence);

create index service_requests_status_updated_idx
    on public.service_requests (status, updated_at desc);

-- Persist the aggregate in one short transaction. The advisory lock coordinates
-- independent serverless instances, while updated_at provides optimistic concurrency.
create or replace function public.persist_conversation(
    p_aggregate jsonb,
    p_expected_updated_at timestamptz default null
)
returns timestamptz
language plpgsql
volatile
security invoker
set search_path = ''
set lock_timeout = '3s'
as $$
declare
    v_root jsonb := p_aggregate -> 'root';
    v_conversation_id uuid;
    v_created_at timestamptz;
    v_updated_at timestamptz;
    v_saved_updated_at timestamptz;
    v_processed_client_ids text[];
    v_processed_inbound_ids text[];
begin
    if pg_catalog.jsonb_typeof(p_aggregate) is distinct from 'object'
        or pg_catalog.jsonb_typeof(v_root) is distinct from 'object' then
        raise exception using
            errcode = '22023',
            message = 'persist_conversation requires an aggregate object';
    end if;

    v_conversation_id := nullif(v_root ->> 'id', '')::uuid;
    v_created_at := nullif(v_root ->> 'created_at', '')::timestamptz;
    v_updated_at := nullif(v_root ->> 'updated_at', '')::timestamptz;
    if v_conversation_id is null or v_created_at is null or v_updated_at is null then
        raise exception using
            errcode = '22023',
            message = 'persist_conversation requires id, created_at and updated_at';
    end if;

    select coalesce(pg_catalog.array_agg(client_id), '{}'::text[])
    into v_processed_client_ids
    from pg_catalog.jsonb_array_elements_text(
        coalesce(v_root -> 'processed_client_message_ids', '[]'::jsonb)
    ) as client_ids(client_id);

    select coalesce(pg_catalog.array_agg(inbound_id), '{}'::text[])
    into v_processed_inbound_ids
    from pg_catalog.jsonb_array_elements_text(
        coalesce(v_root -> 'processed_inbound_message_ids', '[]'::jsonb)
    ) as inbound_ids(inbound_id);

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_conversation_id::text, 0)
    );

    if p_expected_updated_at is null then
        insert into public.service_requests (
            id,
            status,
            request_data,
            processed_client_message_ids,
            processed_inbound_message_ids,
            pending_offer_id,
            next_sequence,
            created_at,
            updated_at
        )
        values (
            v_conversation_id,
            v_root ->> 'status',
            coalesce(v_root -> 'request_data', '{}'::jsonb),
            v_processed_client_ids,
            v_processed_inbound_ids,
            null,
            (v_root ->> 'next_sequence')::bigint,
            v_created_at,
            v_updated_at
        )
        on conflict (id) do nothing
        returning updated_at into v_saved_updated_at;

        if v_saved_updated_at is null then
            select updated_at
            into v_saved_updated_at
            from public.service_requests
            where id = v_conversation_id
            for update;

            if not found or v_saved_updated_at is distinct from v_updated_at then
                raise exception using
                    errcode = '40001',
                    message = 'conversation was created concurrently';
            end if;
        end if;
    else
        v_saved_updated_at := greatest(
            v_updated_at,
            p_expected_updated_at + interval '1 microsecond',
            pg_catalog.clock_timestamp()
        );
        update public.service_requests
        set
            status = v_root ->> 'status',
            request_data = coalesce(v_root -> 'request_data', '{}'::jsonb),
            processed_client_message_ids = v_processed_client_ids,
            processed_inbound_message_ids = v_processed_inbound_ids,
            next_sequence = (v_root ->> 'next_sequence')::bigint,
            updated_at = v_saved_updated_at
        where id = v_conversation_id
            and updated_at = p_expected_updated_at
        returning updated_at into v_saved_updated_at;

        if not found then
            raise exception using
                errcode = '40001',
                message = 'conversation changed concurrently';
        end if;
    end if;

    insert into public.messages (
        id,
        conversation_id,
        client_message_id,
        role,
        content,
        sequence,
        created_at
    )
    select
        (item ->> 'id')::uuid,
        (item ->> 'conversation_id')::uuid,
        item ->> 'client_message_id',
        item ->> 'role',
        item ->> 'content',
        (item ->> 'sequence')::bigint,
        (item ->> 'created_at')::timestamptz
    from pg_catalog.jsonb_array_elements(
        coalesce(p_aggregate -> 'messages', '[]'::jsonb)
    ) as message_rows(item)
    on conflict (id) do nothing;

    insert into public.agent_events (
        id,
        conversation_id,
        event_type,
        payload,
        sequence,
        created_at
    )
    select
        (item ->> 'id')::uuid,
        (item ->> 'conversation_id')::uuid,
        item ->> 'event_type',
        coalesce(item -> 'payload', '{}'::jsonb),
        (item ->> 'sequence')::bigint,
        (item ->> 'created_at')::timestamptz
    from pg_catalog.jsonb_array_elements(
        coalesce(p_aggregate -> 'agent_events', '[]'::jsonb)
    ) as event_rows(item)
    on conflict (id) do nothing;

    insert into public.provider_candidates (
        id,
        conversation_id,
        external_id,
        name,
        address,
        latitude,
        longitude,
        rating,
        review_count,
        phone,
        website,
        email,
        business_status,
        rank
    )
    select
        (item ->> 'id')::uuid,
        (item ->> 'conversation_id')::uuid,
        item ->> 'external_id',
        item ->> 'name',
        item ->> 'address',
        nullif(item ->> 'latitude', '')::double precision,
        nullif(item ->> 'longitude', '')::double precision,
        nullif(item ->> 'rating', '')::numeric,
        nullif(item ->> 'review_count', '')::integer,
        item ->> 'phone',
        item ->> 'website',
        item ->> 'email',
        item ->> 'business_status',
        (item ->> 'rank')::integer
    from pg_catalog.jsonb_array_elements(
        coalesce(p_aggregate -> 'provider_candidates', '[]'::jsonb)
    ) as provider_rows(item)
    on conflict (id) do nothing;

    insert into public.outreaches (
        id,
        conversation_id,
        provider_id,
        channel,
        destination,
        reply_to,
        external_message_id,
        status,
        created_at
    )
    select
        (item ->> 'id')::uuid,
        (item ->> 'conversation_id')::uuid,
        (item ->> 'provider_id')::uuid,
        item ->> 'channel',
        item ->> 'destination',
        pg_catalog.lower(item ->> 'reply_to'),
        item ->> 'external_message_id',
        item ->> 'status',
        (item ->> 'created_at')::timestamptz
    from pg_catalog.jsonb_array_elements(
        coalesce(p_aggregate -> 'outreaches', '[]'::jsonb)
    ) as outreach_rows(item)
    on conflict (id) do nothing;

    insert into public.provider_offers (
        id,
        conversation_id,
        provider_id,
        inbound_message_id,
        status,
        price,
        available_at,
        question,
        raw_text,
        within_budget,
        within_availability,
        acceptable,
        created_at
    )
    select
        (item ->> 'id')::uuid,
        (item ->> 'conversation_id')::uuid,
        (item ->> 'provider_id')::uuid,
        item ->> 'inbound_message_id',
        item ->> 'status',
        nullif(item ->> 'price', '')::numeric,
        nullif(item ->> 'available_at', '')::timestamptz,
        item ->> 'question',
        item ->> 'raw_text',
        nullif(item ->> 'within_budget', '')::boolean,
        nullif(item ->> 'within_availability', '')::boolean,
        (item ->> 'acceptable')::boolean,
        (item ->> 'created_at')::timestamptz
    from pg_catalog.jsonb_array_elements(
        coalesce(p_aggregate -> 'provider_offers', '[]'::jsonb)
    ) as offer_rows(item)
    on conflict (id) do nothing;

    insert into public.bookings (
        id,
        conversation_id,
        provider_id,
        offer_id,
        start,
        "end",
        price,
        calendar_event_id,
        calendar_event_url,
        created_at
    )
    select
        (item ->> 'id')::uuid,
        (item ->> 'conversation_id')::uuid,
        (item ->> 'provider_id')::uuid,
        (item ->> 'offer_id')::uuid,
        (item ->> 'start')::timestamptz,
        (item ->> 'end')::timestamptz,
        (item ->> 'price')::numeric,
        item ->> 'calendar_event_id',
        item ->> 'calendar_event_url',
        (item ->> 'created_at')::timestamptz
    from pg_catalog.jsonb_array_elements(
        coalesce(p_aggregate -> 'bookings', '[]'::jsonb)
    ) as booking_rows(item)
    on conflict (id) do nothing;

    update public.service_requests
    set pending_offer_id = nullif(v_root ->> 'pending_offer_id', '')::uuid
    where id = v_conversation_id;

    return v_saved_updated_at;
end;
$$;

alter table public.service_requests enable row level security;
alter table public.messages enable row level security;
alter table public.provider_candidates enable row level security;
alter table public.outreaches enable row level security;
alter table public.provider_offers enable row level security;
alter table public.bookings enable row level security;
alter table public.agent_events enable row level security;

alter table public.service_requests force row level security;
alter table public.messages force row level security;
alter table public.provider_candidates force row level security;
alter table public.outreaches force row level security;
alter table public.provider_offers force row level security;
alter table public.bookings force row level security;
alter table public.agent_events force row level security;

revoke all privileges on table public.service_requests from public, anon, authenticated;
revoke all privileges on table public.messages from public, anon, authenticated;
revoke all privileges on table public.provider_candidates from public, anon, authenticated;
revoke all privileges on table public.outreaches from public, anon, authenticated;
revoke all privileges on table public.provider_offers from public, anon, authenticated;
revoke all privileges on table public.bookings from public, anon, authenticated;
revoke all privileges on table public.agent_events from public, anon, authenticated;

grant select, insert, update, delete on table public.service_requests to service_role;
grant select, insert, update, delete on table public.messages to service_role;
grant select, insert, update, delete on table public.provider_candidates to service_role;
grant select, insert, update, delete on table public.outreaches to service_role;
grant select, insert, update, delete on table public.provider_offers to service_role;
grant select, insert, update, delete on table public.bookings to service_role;
grant select, insert, update, delete on table public.agent_events to service_role;

revoke execute on function public.persist_conversation(jsonb, timestamptz)
    from public, anon, authenticated;
grant execute on function public.persist_conversation(jsonb, timestamptz)
    to service_role;

comment on table public.service_requests is
    'ServeAI conversation aggregate root; server-side access only.';
comment on column public.messages.client_message_id is
    'Frontend-generated idempotency key, globally unique when present.';
comment on column public.provider_offers.inbound_message_id is
    'Inbound provider message idempotency key.';
