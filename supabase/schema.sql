-- Shared records without user accounts. Run in the Supabase SQL editor.
-- Visitors can read and use the two write functions, not erase tables/visits.
begin;
create table if not exists public.playgrounds (
  id text primary key check (id ~ '^(node|way|relation)/[0-9]+$'),
  name text not null check (length(name) between 1 and 250),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  address text not null default '' check (length(address) <= 500),
  kind text not null default 'playground' check (kind in ('playground', 'fitness_station')),
  equipment jsonb not null default '[]'::jsonb check (jsonb_typeof(equipment) = 'array' and jsonb_array_length(equipment) <= 30 and pg_column_size(equipment) <= 4000),
  access text not null default '' check (length(access) <= 100),
  wheelchair text not null default '' check (length(wheelchair) <= 50),
  variety integer check (variety between 0 and 10),
  climbability integer check (climbability between 0 and 10),
  pull_ups integer check (pull_ups between 0 and 10),
  rated_at timestamptz,
  constraint complete_rating check (
    (variety is null and climbability is null and pull_ups is null and rated_at is null)
    or (variety is not null and climbability is not null and pull_ups is not null and rated_at is not null)
  )
);
create table if not exists public.playground_visits (
  id uuid primary key default gen_random_uuid(),
  playground_id text not null references public.playgrounds(id) on delete cascade,
  visited_at timestamptz not null check (visited_at >= '2000-01-01T00:00:00Z'::timestamptz),
  created_at timestamptz not null default now()
);
create index if not exists playground_visits_place_date on public.playground_visits (playground_id, visited_at desc);
alter table public.playgrounds enable row level security;
alter table public.playground_visits enable row level security;
revoke all on public.playgrounds, public.playground_visits from anon, authenticated;
grant select on public.playgrounds, public.playground_visits to anon, authenticated;
drop policy if exists "Public can read playgrounds" on public.playgrounds;
create policy "Public can read playgrounds" on public.playgrounds for select to anon, authenticated using (true);
drop policy if exists "Public can read visits" on public.playground_visits;
create policy "Public can read visits" on public.playground_visits for select to anon, authenticated using (true);

-- Internal metadata upsert. No public EXECUTE permission.
create or replace function public.atlas_ensure_playground(p_place jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_place is null or jsonb_typeof(p_place) <> 'object' then raise exception 'A playground object is required'; end if;
  insert into public.playgrounds (id, name, latitude, longitude, address, kind, equipment, access, wheelchair)
  values (
    p_place->>'id', p_place->>'name', (p_place->>'latitude')::double precision, (p_place->>'longitude')::double precision,
    coalesce(p_place->>'address', ''), coalesce(p_place->>'kind', 'playground'), coalesce(p_place->'equipment', '[]'::jsonb),
    coalesce(p_place->>'access', ''), coalesce(p_place->>'wheelchair', '')
  ) on conflict (id) do update set
    name = excluded.name, latitude = excluded.latitude, longitude = excluded.longitude,
    address = excluded.address, kind = excluded.kind, equipment = excluded.equipment,
    access = excluded.access, wheelchair = excluded.wheelchair;
end;
$$;
revoke all on function public.atlas_ensure_playground(jsonb) from public, anon, authenticated;

create or replace function public.save_playground_rating(p_place jsonb, p_variety integer, p_climbability integer, p_pull_ups integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_variety is null or p_climbability is null or p_pull_ups is null
    or p_variety not between 0 and 10 or p_climbability not between 0 and 10 or p_pull_ups not between 0 and 10 then
    raise exception 'Every category must be an integer from 0 to 10';
  end if;
  perform public.atlas_ensure_playground(p_place);
  update public.playgrounds set variety = p_variety, climbability = p_climbability, pull_ups = p_pull_ups, rated_at = now() where id = p_place->>'id';
  select to_jsonb(p) into result from public.playgrounds p where id = p_place->>'id';
  return result;
end;
$$;
revoke all on function public.save_playground_rating(jsonb, integer, integer, integer) from public;
grant execute on function public.save_playground_rating(jsonb, integer, integer, integer) to anon, authenticated;

create or replace function public.record_playground_visit(p_place jsonb, p_visited_at timestamptz, p_visit_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_visit_id is null or p_visited_at is null or not isfinite(p_visited_at)
    or p_visited_at < '2000-01-01T00:00:00Z'::timestamptz or p_visited_at > now() + interval '1 minute' then
    raise exception 'Valid visit ID and past date/time are required';
  end if;
  perform public.atlas_ensure_playground(p_place);
  insert into public.playground_visits (id, playground_id, visited_at) values (p_visit_id, p_place->>'id', p_visited_at) on conflict (id) do nothing;
end;
$$;
revoke all on function public.record_playground_visit(jsonb, timestamptz, uuid) from public;
grant execute on function public.record_playground_visit(jsonb, timestamptz, uuid) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
