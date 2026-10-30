-- Durable API spending reservations and confirmed fund-event reconciliation.
-- Apply with Supabase migrations before deploying the API code that calls these RPCs.

create table if not exists public.humanlayer_spend_reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.humanlayer_agents(agent_id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  amount_raw numeric(78,0) not null check (amount_raw > 0),
  per_task_raw numeric(78,0) not null check (per_task_raw > 0),
  daily_date_utc date not null,
  chain_id bigint not null,
  contract_address text not null check (contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  intent_payload jsonb not null,
  status text not null default 'reserved'
    check (status in ('reserved', 'confirmed', 'released', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  tx_hash text unique check (tx_hash is null or tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  bounty_id numeric(78,0),
  confirmed_at timestamptz,
  unique (agent_id, idempotency_key)
);

create index if not exists humanlayer_spend_reservations_active_idx
  on public.humanlayer_spend_reservations (agent_id, daily_date_utc, expires_at)
  where status = 'reserved';

alter table public.humanlayer_spend_reservations enable row level security;
revoke all on public.humanlayer_spend_reservations from anon, authenticated;
grant select, insert, update, delete on public.humanlayer_spend_reservations to service_role;

create or replace function public.reserve_humanlayer_spend(
  p_agent_id text,
  p_idempotency_key text,
  p_request_hash text,
  p_amount_raw numeric,
  p_per_task_raw numeric,
  p_chain_id bigint,
  p_contract_address text,
  p_intent_payload jsonb,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_agent public.humanlayer_agents%rowtype;
  v_existing public.humanlayer_spend_reservations%rowtype;
  v_per_task_limit numeric;
  v_daily_limit numeric;
  v_total_budget numeric;
  v_daily_used numeric;
  v_total_reserved numeric;
  v_today date := (now() at time zone 'utc')::date;
begin
  select * into v_agent
  from public.humanlayer_agents
  where agent_id = p_agent_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'AGENT_NOT_FOUND');
  end if;

  update public.humanlayer_spend_reservations
  set status = 'expired'
  where agent_id = p_agent_id and status = 'reserved' and expires_at <= now();

  select * into v_existing
  from public.humanlayer_spend_reservations
  where agent_id = p_agent_id and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_hash <> p_request_hash then
      return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
    end if;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'reservation', to_jsonb(v_existing)
    );
  end if;

  if p_amount_raw <= 0 or p_per_task_raw <= 0 or p_expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'INVALID_RESERVATION');
  end if;

  v_per_task_limit := coalesce((v_agent.spending_limits ->> 'perTaskMax')::numeric, 0);
  v_daily_limit := coalesce((v_agent.spending_limits ->> 'dailyLimit')::numeric, 0);
  v_total_budget := coalesce((v_agent.spending_limits ->> 'totalBudget')::numeric, 0);

  if p_per_task_raw > v_per_task_limit then
    return jsonb_build_object('ok', false, 'code', 'EXCEEDS_PER_TASK_LIMIT');
  end if;

  select coalesce(spent_raw, 0) into v_daily_used
  from public.humanlayer_daily_spends
  where agent_id = p_agent_id and date_utc = v_today;
  v_daily_used := coalesce(v_daily_used, 0);

  select coalesce(sum(amount_raw), 0) into v_total_reserved
  from public.humanlayer_spend_reservations
  where agent_id = p_agent_id and daily_date_utc = v_today
    and status = 'reserved' and expires_at > now();

  if v_daily_used + v_total_reserved + p_amount_raw > v_daily_limit then
    return jsonb_build_object('ok', false, 'code', 'EXCEEDS_DAILY_LIMIT');
  end if;

  select coalesce(sum(amount_raw), 0) into v_total_reserved
  from public.humanlayer_spend_reservations
  where agent_id = p_agent_id and status = 'reserved' and expires_at > now();

  if v_agent.total_funded_raw + v_total_reserved + p_amount_raw > v_total_budget then
    return jsonb_build_object('ok', false, 'code', 'EXCEEDS_TOTAL_BUDGET');
  end if;

  insert into public.humanlayer_spend_reservations (
    agent_id, idempotency_key, request_hash, amount_raw, per_task_raw,
    daily_date_utc, chain_id, contract_address, intent_payload, expires_at
  ) values (
    p_agent_id, p_idempotency_key, p_request_hash, p_amount_raw, p_per_task_raw,
    v_today, p_chain_id, p_contract_address, p_intent_payload, p_expires_at
  ) returning * into v_existing;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'reservation', to_jsonb(v_existing)
  );
end;
$$;

create or replace function public.confirm_humanlayer_spend(
  p_agent_id text,
  p_reservation_id uuid,
  p_tx_hash text,
  p_bounty_id numeric,
  p_amount_raw numeric,
  p_block_timestamp timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_agent public.humanlayer_agents%rowtype;
  v_reservation public.humanlayer_spend_reservations%rowtype;
begin
  select * into v_agent from public.humanlayer_agents
  where agent_id = p_agent_id for update;
  if not found then raise exception 'AGENT_NOT_FOUND'; end if;

  select * into v_reservation from public.humanlayer_spend_reservations
  where reservation_id = p_reservation_id and agent_id = p_agent_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  if v_reservation.status = 'confirmed' then
    if v_reservation.tx_hash = p_tx_hash and v_reservation.bounty_id = p_bounty_id
      and v_reservation.amount_raw = p_amount_raw then
      return jsonb_build_object('confirmed', true, 'replayed', true);
    end if;
    raise exception 'RESERVATION_ALREADY_CONFIRMED';
  end if;

  if v_reservation.status not in ('reserved', 'expired') then
    raise exception 'RESERVATION_NOT_CONFIRMABLE';
  end if;
  if v_reservation.amount_raw <> p_amount_raw then raise exception 'AMOUNT_MISMATCH'; end if;
  if p_block_timestamp > v_reservation.expires_at then raise exception 'RESERVATION_EXPIRED_BEFORE_TRANSACTION'; end if;

  update public.humanlayer_spend_reservations
  set status = 'confirmed', tx_hash = p_tx_hash, bounty_id = p_bounty_id,
      confirmed_at = now()
  where reservation_id = p_reservation_id;

  update public.humanlayer_agents
  set total_funded_raw = total_funded_raw + p_amount_raw,
      tasks_created = tasks_created + 1
  where agent_id = p_agent_id;

  insert into public.humanlayer_daily_spends(agent_id, date_utc, spent_raw)
  values (p_agent_id, v_reservation.daily_date_utc, p_amount_raw)
  on conflict (agent_id, date_utc) do update
  set spent_raw = public.humanlayer_daily_spends.spent_raw + excluded.spent_raw;

  return jsonb_build_object('confirmed', true, 'replayed', false);
end;
$$;

create or replace function public.release_humanlayer_spend(
  p_agent_id text,
  p_reservation_id uuid,
  p_tx_hash text,
  p_block_timestamp timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reservation public.humanlayer_spend_reservations%rowtype;
begin
  perform 1 from public.humanlayer_agents where agent_id = p_agent_id for update;
  if not found then raise exception 'AGENT_NOT_FOUND'; end if;
  select * into v_reservation from public.humanlayer_spend_reservations
  where reservation_id = p_reservation_id and agent_id = p_agent_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_reservation.status = 'released' and v_reservation.tx_hash = p_tx_hash then
    return jsonb_build_object('released', true, 'replayed', true);
  end if;
  if v_reservation.status not in ('reserved', 'expired') then raise exception 'RESERVATION_NOT_RELEASABLE'; end if;
  if p_block_timestamp > v_reservation.expires_at then raise exception 'RESERVATION_EXPIRED_BEFORE_FAILURE'; end if;
  update public.humanlayer_spend_reservations
  set status = 'released', tx_hash = p_tx_hash
  where reservation_id = p_reservation_id;
  return jsonb_build_object('released', true, 'replayed', false);
end;
$$;

revoke all on function public.reserve_humanlayer_spend(text,text,text,numeric,numeric,bigint,text,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function public.confirm_humanlayer_spend(text,uuid,text,numeric,numeric,timestamptz) from public, anon, authenticated;
revoke all on function public.release_humanlayer_spend(text,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_humanlayer_spend(text,text,text,numeric,numeric,bigint,text,jsonb,timestamptz) to service_role;
grant execute on function public.confirm_humanlayer_spend(text,uuid,text,numeric,numeric,timestamptz) to service_role;
grant execute on function public.release_humanlayer_spend(text,uuid,text,timestamptz) to service_role;
