# DoorKnock

A door-to-door canvassing tracker. Draw the area you want to work on a map, pull in every
house inside it automatically, and mark each door as you knock it — with the whole crew
seeing the same map, live.

Built to be used on a phone, one-handed, standing on a sidewalk.

---

## What it does

**Draw a territory.** Hit *Draw area*, then either drag your finger to lasso a block or tap
corner by corner. The shape closes itself.

**Get the houses for free.** On save it queries OpenStreetMap for every addressed building
inside your outline and drops a pin on each one, with the real street address. A 2–3 block
area typically comes back with 100–200 houses in a few seconds. Where an area has buildings
mapped but no addresses, it falls back to building footprints so you still get pins.

**Mark doors.** Tap a pin and choose: Not home · Not interested · Interested · Appointment
set · Sold · Do not knock. Add notes per house ("dog in the yard", "come back after 6").
Every mark is stamped with who did it and when.

**See progress.** The territory card shows *64 of 156 doors worked* with a colour breakdown,
so nobody re-knocks a street that is already done.

**Everyone sees it at once.** With Supabase connected, one rep marking a door updates
everyone else's map within a second.

**Export.** *Territories → Export CSV* gives you every house, status, note, rep, timestamp
and coordinate for your own reporting.

Other bits: satellite/street toggle, find-me button, tap-to-add for houses OpenStreetMap
missed, editable addresses, installable on a phone home screen.

---

## Running it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

With no database configured it runs in **solo mode**: everything is stored in that one
browser and nothing is shared. That is enough to try it out. For a crew, set up Supabase
below.

---

## Setting up the shared database (Supabase — free)

1. Go to https://supabase.com and create a project. Any region near your crew is fine.
2. In the project, open **SQL Editor → New query**, paste the whole contents of
   [`supabase-schema.sql`](./supabase-schema.sql), and hit **Run**. It creates the two
   tables, installs the team-scoped access policies, and turns on live updates.
   (With a Postgres URL to hand you can instead run `node scripts/run-sql.mjs
   supabase-schema.sql`.)
3. Open **Project Settings → API** and copy two values:
   - **Project URL**
   - the **anon / public** key (not the service role key)
4. Copy `.env.local.example` to `.env.local` and paste them in:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
   SUPABASE_JWT_SECRET=<Project Settings → API → JWT Secret>
   ```

   The first two are public and end up in the browser bundle. `SUPABASE_JWT_SECRET` must
   NOT have a `NEXT_PUBLIC_` prefix: it stays on the server, where the token route signs
   with it.

5. Restart `npm run dev`. The badge in the top bar should read **Live** instead of
   **This device**.

---

## Deploying to Vercel

1. Put this folder on GitHub (see below if it is not there yet).
2. Go to https://vercel.com, sign in with GitHub, and **Add New → Project**.
3. Pick the repo. Vercel detects Next.js on its own — leave the build settings alone.
4. Before deploying, open **Environment Variables** and add the same three values:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_JWT_SECRET`

   Vercel's Supabase integration sets the first two for you if you add it from the
   dashboard; the JWT secret you may need to add by hand.
5. **Deploy**. You get a URL like `doorknock-abc123.vercel.app`.
6. Send that link to the crew. On a phone: open it, then *Share → Add to Home Screen* and it
   behaves like an installed app.

If you add the environment variables after the first deploy, hit **Redeploy** — they are
baked in at build time.

Getting it onto GitHub:

```bash
git remote add origin https://github.com/YOUR-NAME/doorknock.git
git push -u origin main
```

---

## How teams are separated

There are no user accounts. Everyone types a **team code** and their **name** on the front
page, and the team code is what splits one crew's map from another's.

That code is enforced by the database, not just the UI. When you enter it the app calls
`/api/team-token`, which signs a short-lived JWT carrying a `team` claim using the project's
JWT secret. Every read, write and live-update subscription carries that token, and the
row-level security policies compare its claim to each row's `team_code`. A browser holding a
token for one team cannot read, change or delete another team's rows — Postgres refuses.

This matters because the Supabase anon key is baked into the public JavaScript bundle, so
anyone who loads the site has it. Before the policies were tightened, that key alone was
enough to list every team's data and delete it; that was demonstrated against the real
database, not theorised. It is now enough to do nothing at all without a team token.

**What this is not is authentication.** Anyone who knows a team code can still get a token
for it, exactly as they could always have typed it into the app. What it removes is the
ability to enumerate or destroy teams you cannot name. So:

- **Pick a team code nobody would guess.** `summit-solar-fall26-9xk`, not `solar` or `1234`.
  It is a shared password, and it is the only thing standing between a stranger and a file
  of home addresses with notes about who is home when.
- Codes are normalised to lowercase letters, numbers and dashes, so `Summit Solar!` and
  `summit-solar` are the same team.

If you outgrow that — per-rep logins, revoking one rep's access, an audit trail — the step up
is Supabase Auth. The tables already carry everything it would need.

## Things worth knowing

- **Address coverage varies.** OpenStreetMap has complete address data for most US cities
  and towns and patchy data in rural areas. If a territory comes back thin, the + button
  drops pins by hand as you walk.
- **Big territories are slow.** The public OpenStreetMap query service is free and
  sometimes busy; a huge polygon can take a minute or fail. A few blocks at a time works
  better and is easier to canvass anyway.
- **It needs signal.** There is no offline mode. Marks made with no connection are held in
  the browser tab but are not queued for later upload — if the tab is closed while offline,
  those marks are lost.
- **Location needs HTTPS.** The find-me button works on the Vercel URL and on localhost,
  but not over plain http on a phone.

---

## Layout

```
app/
  page.tsx                    screen state: modes, sheets, territory + house actions
  layout.tsx                  metadata, viewport, Leaflet + global CSS
  globals.css                 the whole design system
  manifest.ts                 home-screen install
  api/team-token/route.ts     signs the per-team JWT (server-side; needs SUPABASE_JWT_SECRET)
components/
  MapView.tsx                 Leaflet map, freehand drawing, status-coloured pins
  Gate.tsx                    team code + name
  HouseSheet.tsx              mark a door, notes, address
  TerritorySheet.tsx          territory list, progress, CSV export
  SaveTerritorySheet.tsx
lib/
  store.ts                    data layer - Supabase with live sync, or browser storage
  supabase.ts                 per-team client factory + token fetch
  jwt.ts                      HS256 signer (server only)
  overpass.ts                 pulls addresses out of OpenStreetMap
  geo.ts                      point-in-polygon, area, distance, lasso simplification
  types.ts                    statuses and their colours
scripts/
  run-sql.mjs                 apply a .sql file to the database
  verify-supabase.mjs         19 checks against the live project - run after any schema change
  verify-realtime.mjs         isolates realtime INSERT/UPDATE/DELETE behaviour
  probe-jwt.mjs               checks custom JWTs are accepted on REST and realtime
  peek-team.mjs               dump one team's rows
  poke-team.mjs               edit a row as if from a second device, to test live sync
migrations/                   incremental changes applied after the initial schema
supabase-schema.sql           the full schema, safe to re-run
```

Data flows one way: `useCanvassData` owns territories and houses, `page.tsx` renders them,
and every mutation goes back through the hook so the optimistic update and the write to
Supabase stay in one place.

## Verifying it still works

After any schema or data-layer change:

```bash
node scripts/verify-supabase.mjs
```

19 checks against the real project: inserts with client-generated ids, jsonb polygon
round-tripping, chunked inserts past the 500-row boundary, realtime delivery of all three
event types, and — the ones that matter most — that a client holding only the public anon key
can neither enumerate nor delete another team's rows. It cleans up after itself and only ever
touches team codes beginning `zz-verify`.
