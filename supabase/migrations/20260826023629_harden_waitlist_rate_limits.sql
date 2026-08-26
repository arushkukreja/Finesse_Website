-- Durable, atomic rate limiting for the public waitlist endpoint.
-- The browser never receives access to this table or function. The Vercel
-- Function calls it with the server-only service role / secret key.

create table if not exists public.waitlist_rate_limits (
  ip_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts smallint not null default 1,
  updated_at timestamptz not null default now(),
  constraint waitlist_rate_limits_ip_hash_format
    check (length(ip_hash) = 64 and ip_hash ~ '^[0-9a-f]+$'),
  constraint waitlist_rate_limits_attempts_positive
    check (attempts > 0)
);

alter table public.waitlist_rate_limits enable row level security;
alter table public.waitlist_rate_limits force row level security;

revoke all on table public.waitlist_rate_limits from public, anon, authenticated;
grant select, insert, update on table public.waitlist_rate_limits to service_role;

create or replace function public.consume_waitlist_rate_limit(
  p_ip_hash text,
  p_limit smallint default 3,
  p_window_seconds integer default 600
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_allowed boolean;
begin
  if length(p_ip_hash) <> 64 or p_ip_hash !~ '^[0-9a-f]+$' then
    raise exception 'invalid rate-limit key';
  end if;

  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate-limit configuration';
  end if;

  insert into public.waitlist_rate_limits as rate_limit (
    ip_hash,
    window_started_at,
    attempts,
    updated_at
  )
  values (p_ip_hash, v_now, 1, v_now)
  on conflict (ip_hash) do update
  set
    window_started_at = case
      when rate_limit.window_started_at <= v_now - make_interval(secs => p_window_seconds)
        then v_now
      else rate_limit.window_started_at
    end,
    attempts = case
      when rate_limit.window_started_at <= v_now - make_interval(secs => p_window_seconds)
        then 1
      else rate_limit.attempts + 1
    end,
    updated_at = v_now
  where
    rate_limit.window_started_at <= v_now - make_interval(secs => p_window_seconds)
    or rate_limit.attempts < p_limit
  returning true into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;

revoke all on function public.consume_waitlist_rate_limit(text, smallint, integer)
  from public, anon, authenticated;
grant execute on function public.consume_waitlist_rate_limit(text, smallint, integer)
  to service_role;

comment on table public.waitlist_rate_limits is
  'One rolling waitlist submission window per privacy-preserving IP hash.';
comment on function public.consume_waitlist_rate_limit(text, smallint, integer) is
  'Atomically consumes one waitlist submission attempt and returns whether it is allowed.';

notify pgrst, 'reload schema';
