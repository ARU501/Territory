-- ---------------------------------------------------------------------------
-- DoorKnock database setup
--
-- Paste this whole file into the Supabase SQL Editor and hit Run, or apply it
-- with:  node scripts/run-sql.mjs supabase-schema.sql
--
-- It is safe to run more than once. Every choice below was verified against a
-- live Supabase project by scripts/verify-supabase.mjs, not assumed.
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
-- Apartment buildings
--
-- A complex is one pin standing for many doors, and each of those doors is an
-- ordinary house row pointed back at it by parent_id. Reusing this table
-- rather than adding a second one means units inherit everything already built
-- and proven here: the team-scoped policies below, realtime, the offline retry
-- queue, paging, and the CSV export.
--
--   kind = 'house'    a single front door, and what every existing row is
--        = 'complex'  the building itself; carries the name and the map pin
--        = 'unit'     one door inside a complex; never drawn on the map,
--                     because every unit shares its building's coordinates
--
-- The self-referencing cascade is what makes deleting a building take its
-- units with it instead of orphaning them at the same coordinates forever.
-- ---------------------------------------------------------------------------

alter table public.houses add column if not exists kind      text not null default 'house';
alter table public.houses add column if not exists parent_id text;
alter table public.houses add column if not exists name      text not null default '';

do $$
begin
  alter table public.houses
    add constraint houses_parent_fk foreign key (parent_id)
    references public.houses (id) on delete cascade;
exception when duplicate_object then null;
end $$;

create index if not exists houses_parent_idx on public.houses (parent_id);

-- ---------------------------------------------------------------------------
-- Access rules
--
-- The anon key is baked into the public JavaScript bundle, so row-level
-- security is the only thing protecting this data. Blanket "using (true)"
-- policies would let anyone who loaded the site read, alter and delete EVERY
-- team's data without knowing a single team code — that was demonstrated
-- against a real database before these policies were written.
--
-- Instead, each request must carry a JWT minted by /api/team-token whose
-- `team` claim names one team, and Postgres compares it to the row.
--
-- This is scoping, not authentication. Anyone who knows a team code can still
-- obtain a token for it, exactly as they could always have typed it into the
-- app. What it removes is the ability to enumerate or destroy teams you cannot
-- name. Choose team codes nobody would guess.
--
-- The failure mode is closed: with no token, auth.jwt() is null, the comparison
-- yields null rather than true, and no row is visible.
-- ---------------------------------------------------------------------------

alter table public.territories enable row level security;
alter table public.houses      enable row level security;

-- Remove the permissive policies shipped by earlier versions of this file.
drop policy if exists "territories open access" on public.territories;
drop policy if exists "houses open access"      on public.houses;

drop policy if exists "territories scoped to team token" on public.territories;
create policy "territories scoped to team token"
  on public.territories for all
  using      (team_code = (auth.jwt() ->> 'team'))
  with check (team_code = (auth.jwt() ->> 'team'));

drop policy if exists "houses scoped to team token" on public.houses;
create policy "houses scoped to team token"
  on public.houses for all
  using      (team_code = (auth.jwt() ->> 'team'))
  with check (team_code = (auth.jwt() ->> 'team'));

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

-- Under the default replica identity a DELETE writes only the primary key to
-- the WAL. Realtime evaluates both the subscription filter and RLS against that
-- old record, so a subscription filtered on team_code can never match a delete
-- and the event is dropped: one rep deletes a territory and everyone else keeps
-- seeing the stale pins until they reload. FULL puts the whole old row in the
-- WAL, which is what makes deletions propagate.
alter table public.territories replica identity full;
alter table public.houses      replica identity full;

-- PostgREST caches the schema; tell it to re-read so the tables are visible
-- over the REST API immediately rather than after its next refresh.
notify pgrst, 'reload schema';
