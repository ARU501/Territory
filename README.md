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
   tables, opens up access, and turns on live updates.
3. Open **Project Settings → API** and copy two values:
   - **Project URL**
   - the **anon / public** key (not the service role key)
4. Copy `.env.local.example` to `.env.local` and paste them in:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```

5. Restart `npm run dev`. The badge in the top bar should read **Live** instead of
   **This device**.

---

## Deploying to Vercel

1. Put this folder on GitHub (see below if it is not there yet).
2. Go to https://vercel.com, sign in with GitHub, and **Add New → Project**.
3. Pick the repo. Vercel detects Next.js on its own — leave the build settings alone.
4. Before deploying, open **Environment Variables** and add the same two values:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
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
page. The team code is what splits one crew's map from another's — the same code means the
same map.

**This means the team code is effectively a shared password.** Anyone who knows it can read
and change that team's data. Pick something nobody would guess (`summit-solar-2026`, not
`solar`), and do not put it on a flyer. If you need real accounts and per-rep permissions,
that is a Supabase Auth change on top of this — the tables are already there for it.

---

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
  page.tsx            screen state: modes, sheets, territory + house actions
  layout.tsx          metadata, viewport, Leaflet + global CSS
  globals.css         the whole design system
  manifest.ts         home-screen install
components/
  MapView.tsx         Leaflet map, freehand drawing, status-coloured pins
  Gate.tsx            team code + name
  HouseSheet.tsx      mark a door, notes, address
  TerritorySheet.tsx  territory list, progress, CSV export
  SaveTerritorySheet.tsx
lib/
  store.ts            data layer — Supabase with live sync, or browser storage
  overpass.ts         pulls addresses out of OpenStreetMap
  geo.ts              point-in-polygon, area, distance, lasso simplification
  types.ts            statuses and their colours
supabase-schema.sql   run this once in Supabase
```

Data flows one way: `useCanvassData` owns territories and houses, `page.tsx` renders them,
and every mutation goes back through the hook so the optimistic update and the write to
Supabase stay in one place.
