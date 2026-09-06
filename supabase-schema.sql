-- ---------------------------------------------------------------------------
-- DoorKnock database setup
--
-- Paste this whole file into the Supabase SQL Editor and hit Run. It is safe
-- to run more than once.
-- ---------------------------------------------------------------------------

create table if not exists public.territories (
  id          text primary key,
  team_code   text not null,
  name        text not null,
  color       text not null default '#2563eb',
  polygon     jsonb not null,
  created_by  text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.houses (
  id           text primary key,
  team_code    text not null,
  territory_id text references public.territories(id) on delete cascade,
  lat          double precision not null,
  lng          double precision not null,
  address      text not null default '',
  status       text not null default 'not_knocked',
  notes        text not null default '',
  updated_by   text not null default '',
  updated_at   timestamptz not null default now()
);

create index if not exists territories_team_idx on public.territories (team_code);
create index if not exists houses_team_idx      on public.houses (team_code);
create index if not exists houses_territory_idx on public.houses (territory_id);

-- ---------------------------------------------------------------------------
-- Access rules
--
-- There are no user accounts: the team code typed on the front page is the
-- only thing separating one crew's map from another's. Anyone who learns a
-- team code can read and change that team's data, so treat the code the way
-- you would treat a shared password.
-- ---------------------------------------------------------------------------

alter table public.territories enable row level security;
alter table public.houses      enable row level security;

drop policy if exists "territories open access" on public.territories;
create policy "territories open access"
  on public.territories for all
  using (true) with check (true);

drop policy if exists "houses open access" on public.houses;
create policy "houses open access"
  on public.houses for all
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Live updates: without this, teammates only see each other's work on reload.
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    alter publication supabase_realtime add table public.territories;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.houses;
  exception when duplicate_object then null;
  end;
end $$;
