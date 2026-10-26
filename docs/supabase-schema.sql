-- HumanLayer persistent Agent API storage for Supabase Postgres.
-- Run this entire file once in Supabase Dashboard -> SQL Editor.
-- The API uses only the server-side SUPABASE_SERVICE_ROLE_KEY; never put it in VITE_* variables.

create table if not exists public.humanlayer_agents (
  agent_id text primary key,
  name text not null,
  description text not null default '',
  owner_wallet text not null,
  owner_wallet_lower text not null unique,
  api_key_hash text not null unique,
  supported_categories jsonb not null default '[]'::jsonb,
  spending_limits jsonb not null,
  total_funded_raw numeric(78, 0) not null default 0 check (total_funded_raw >= 0),
  total_spent_raw numeric(78, 0) not null default 0 check (total_spent_raw >= 0),
  tasks_created integer not null default 0 check (tasks_created >= 0),
  reputation integer not null default 50 check (reputation between 0 and 100),
  registered_at bigint not null,
  is_demo boolean not null default false
);

create table if not exists public.humanlayer_daily_spends (
  agent_id text not null references public.humanlayer_agents(agent_id) on delete cascade,
  date_utc date not null,
  spent_raw numeric(78, 0) not null default 0 check (spent_raw >= 0),
  primary key (agent_id, date_utc)
);

alter table public.humanlayer_agents enable row level security;
alter table public.humanlayer_daily_spends enable row level security;

revoke all on public.humanlayer_agents from anon, authenticated;
revoke all on public.humanlayer_daily_spends from anon, authenticated;
grant select, insert, update, delete on public.humanlayer_agents to service_role;
grant select, insert, update, delete on public.humanlayer_daily_spends to service_role;

-- Atomic counters avoid read-modify-write races when multiple serverless
-- invocations update the same agent at the same time.
create or replace function public.increment_humanlayer_tasks_created(
  p_agent_id text,
  p_reward_raw numeric
)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.humanlayer_agents
  set tasks_created = tasks_created + 1,
      total_funded_raw = total_funded_raw + p_reward_raw
  where agent_id = p_agent_id;
$$;

create or replace function public.record_humanlayer_agent_spend(
  p_agent_id text,
  p_spent_raw numeric
)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.humanlayer_agents
  set total_spent_raw = total_spent_raw + p_spent_raw
  where agent_id = p_agent_id;
$$;

create or replace function public.record_humanlayer_daily_spend(
  p_agent_id text,
  p_date_utc date,
  p_spent_raw numeric
)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.humanlayer_daily_spends (agent_id, date_utc, spent_raw)
  values (p_agent_id, p_date_utc, p_spent_raw)
  on conflict (agent_id, date_utc)
  do update set spent_raw = public.humanlayer_daily_spends.spent_raw + excluded.spent_raw;
$$;

revoke all on function public.increment_humanlayer_tasks_created(text, numeric) from public, anon, authenticated;
revoke all on function public.record_humanlayer_agent_spend(text, numeric) from public, anon, authenticated;
revoke all on function public.record_humanlayer_daily_spend(text, date, numeric) from public, anon, authenticated;
grant execute on function public.increment_humanlayer_tasks_created(text, numeric) to service_role;
grant execute on function public.record_humanlayer_agent_spend(text, numeric) to service_role;
grant execute on function public.record_humanlayer_daily_spend(text, date, numeric) to service_role;
