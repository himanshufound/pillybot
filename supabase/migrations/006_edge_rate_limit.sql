create table if not exists public.edge_rate_limits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  function_name text not null,
  window_start timestamptz not null,
  count integer not null default 1 check (count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, function_name, window_start)
);

create index if not exists edge_rate_limits_function_window_idx
  on public.edge_rate_limits (function_name, window_start desc);

alter table public.edge_rate_limits enable row level security;

create or replace function public.enforce_edge_rate_limit(
  p_user_id uuid,
  p_function_name text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
  window_bucket timestamptz;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if p_function_name is null or length(trim(p_function_name)) = 0 then
    raise exception 'p_function_name is required';
  end if;

  if p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'p_limit and p_window_seconds must be positive';
  end if;

  window_bucket := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.edge_rate_limits (
    user_id,
    function_name,
    window_start,
    count,
    updated_at
  ) values (
    p_user_id,
    trim(p_function_name),
    window_bucket,
    1,
    now()
  )
  on conflict (user_id, function_name, window_start)
  do update
    set count = edge_rate_limits.count + 1,
        updated_at = now()
  returning count into current_count;

  delete from public.edge_rate_limits
  where window_start < now() - interval '2 days';

  return current_count <= p_limit;
end;
$$;
