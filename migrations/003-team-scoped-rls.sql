-- ---------------------------------------------------------------------------
-- Replace blanket access with per-team access.
--
-- Before this, the policies were "using (true) with check (true)". Since the
-- anon key is baked into the public JavaScript bundle, that meant anyone who
-- loaded the site could read, alter and delete EVERY team's data without
-- knowing a single team code. That was verified against this database, not
-- assumed: a client holding only the anon key listed rows belonging to two
-- different teams and then deleted another team's houses.
--
-- Now every request must carry a JWT minted by /api/team-token whose `team`
-- claim names one team. Postgres compares that claim to the row's team_code.
--
-- This is scoping, not authentication: anyone who knows a team code can still
-- get a token for it, exactly as they could always have typed it into the app.
-- What it removes is the ability to enumerate or destroy teams you cannot name.
-- Pick team codes that are not guessable.
--
-- Note the failure mode is closed: with no token, auth.jwt() is null, the
-- comparison is null rather than true, and no row is visible.
-- ---------------------------------------------------------------------------

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

-- Realtime evaluates these same policies when deciding what to stream, so the
-- team filter is enforced on the websocket as well as on REST.
