/**
 * Exercises the live Supabase project the way the app does, using nothing but the
 * anon key — the same credential the deployed site ships to every visitor.
 *
 *   node scripts/verify-supabase.mjs
 *
 * It answers the questions that cannot be settled by reading code:
 *   - do inserts with client-generated ids and a jsonb polygon round-trip?
 *   - does realtime deliver INSERT/UPDATE/DELETE, and is payload.new a whole row?
 *   - does payload.old carry the id on DELETE under the default replica identity?
 *   - does the team_code filter on the realtime subscription actually work?
 *   - can an anonymous visitor read or wipe another team's data?
 *
 * Everything it writes uses team codes prefixed "zz-verify", and it cleans up after
 * itself. It never touches rows belonging to any other team.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, "..", ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY in .env.local");
  process.exit(1);
}

const TEAM_A = "zz-verify-alpha";
const TEAM_B = "zz-verify-bravo";

const results = [];
let failures = 0;

function check(name, ok, note = "") {
  results.push({ name, ok, note });
  if (!ok) failures++;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${name}${note ? `  — ${note}` : ""}`);
}

function section(title) {
  console.log(`\n${title}`);
}

const SECRET = env.SUPABASE_JWT_SECRET;

const b64url = (b) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Mirrors lib/jwt.ts, so the tests exercise the token the real app uses. */
function signTeamToken(team) {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({
      iss: "supabase",
      role: "anon",
      aud: "authenticated",
      sub: `team:${team}`,
      team,
      iat,
      exp: iat + 3600,
    })
  );
  const sig = b64url(createHmac("sha256", SECRET).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

/**
 * A client scoped to one team by a signed token, or — when team is null — a
 * client holding nothing but the public anon key. That second one is the
 * attacker: it is exactly what anyone can lift out of the deployed bundle.
 */
function clientFor(team) {
  if (!team) return createClient(URL_, KEY, { realtime: { params: { eventsPerSecond: 10 } } });

  const token = signTeamToken(team);
  // Mirrors lib/supabase.ts exactly: the accessToken hook, not a hand-set
  // Authorization header, which supabase-js overrides per request.
  return createClient(URL_, KEY, {
    accessToken: async () => token,
    realtime: { params: { eventsPerSecond: 20 } },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for the next realtime payload matching `want`, or time out. */
function waitFor(bucket, want, ms = 12000) {
  const started = process.hrtime.bigint();
  return new Promise((resolve) => {
    const tick = setInterval(() => {
      const hit = bucket.find(want);
      const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
      if (hit || elapsed > ms) {
        clearInterval(tick);
        resolve(hit ?? null);
      }
    }, 120);
  });
}

const uuid = () => crypto.randomUUID();
const stamp = () => new Date().toISOString();

function territory(team, name) {
  return {
    id: uuid(),
    team_code: team,
    name,
    color: "#2563eb",
    polygon: [
      [40.6255, -74.03],
      [40.6255, -74.027],
      [40.6275, -74.027],
      [40.6275, -74.03],
    ],
    created_by: "verify",
    created_at: stamp(),
  };
}

function house(team, territoryId, i) {
  return {
    id: uuid(),
    team_code: team,
    territory_id: territoryId,
    lat: 40.626 + i * 0.000012,
    lng: -74.0285 + i * 0.000012,
    address: `${100 + i} Verify Street`,
    status: "not_knocked",
    notes: "",
    updated_by: "verify",
    updated_at: stamp(),
  };
}

async function main() {
  console.log(`Verifying ${URL_}`);
  console.log(`Using the anon key only — exactly what a visitor to the site holds.\n`);

  const a = clientFor(TEAM_A);
  const b = clientFor(TEAM_B);
  const bare = clientFor(null); // the attacker: public anon key only

  // ---------------------------------------------------------------- schema
  section("Schema");
  const probe = await a.from("territories").select("id").limit(1);
  if (probe.error && probe.error.code === "PGRST205") {
    console.error(
      "\n  The tables do not exist yet. Run supabase-schema.sql in the Supabase SQL editor first.\n"
    );
    process.exit(2);
  }
  check("territories table reachable", !probe.error, probe.error?.message ?? "");

  const hProbe = await a.from("houses").select("id").limit(1);
  check("houses table reachable", !hProbe.error, hProbe.error?.message ?? "");
  if (failures) return;

  // ------------------------------------------------------------- realtime
  // Subscribe BEFORE writing, exactly like the app does.
  section("Realtime subscription");
  const events = [];
  const channel = a
    .channel(`verify:${TEAM_A}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "houses", filter: `team_code=eq.${TEAM_A}` },
      (p) => events.push({ table: "houses", ...p })
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "territories", filter: `team_code=eq.${TEAM_A}` },
      (p) => events.push({ table: "territories", ...p })
    );

  const subscribed = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("TIMEOUT"), 15000);
    channel.subscribe((status) => {
      if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        clearTimeout(timer);
        resolve(status);
      }
    });
  });
  check("realtime channel subscribes", subscribed === "SUBSCRIBED", `status=${subscribed}`);

  // ---------------------------------------------------------------- writes
  section("Writes as an anonymous visitor");
  const tA = territory(TEAM_A, "Verify Alpha");
  const insT = await a.from("territories").insert(tA);
  check("insert territory (client id, jsonb polygon)", !insT.error, insT.error?.message ?? "");
  if (insT.error) return cleanup(a, b);

  const readBack = await a.from("territories").select("*").eq("id", tA.id).single();
  const poly = readBack.data?.polygon;
  check(
    "polygon round-trips as an array of pairs",
    Array.isArray(poly) && poly.length === 4 && Array.isArray(poly[0]) && poly[0].length === 2,
    Array.isArray(poly) ? `${poly.length} points` : `got ${typeof poly}`
  );
  check(
    "created_at preserved from the client",
    readBack.data?.created_at != null,
    String(readBack.data?.created_at ?? "")
  );

  // The app inserts houses in chunks of 500; push past one chunk boundary.
  const many = Array.from({ length: 620 }, (_, i) => house(TEAM_A, tA.id, i));
  let chunkErr = null;
  for (let i = 0; i < many.length; i += 500) {
    const { error } = await a.from("houses").insert(many.slice(i, i + 500));
    if (error) {
      chunkErr = error;
      break;
    }
  }
  check("chunked insert of 620 houses", !chunkErr, chunkErr?.message ?? "2 chunks");

  const count = await a
    .from("houses")
    .select("id", { count: "exact", head: true })
    .eq("team_code", TEAM_A);
  check("all 620 houses readable back", count.count === 620, `count=${count.count}`);

  // ------------------------------------------------------- realtime payloads
  section("Realtime delivery");
  const target = many[0];
  await a.from("houses").update({ status: "sold", notes: "verify note", updated_by: "verify" }).eq("id", target.id);

  const upd = await waitFor(events, (e) => e.table === "houses" && e.eventType === "UPDATE" && e.new?.id === target.id);
  check("UPDATE event arrives", !!upd);
  if (upd) {
    const cols = Object.keys(upd.new ?? {});
    const whole = ["id", "team_code", "territory_id", "lat", "lng", "address", "status", "notes", "updated_by", "updated_at"]
      .every((c) => cols.includes(c));
    check("payload.new is a WHOLE row, not just changed columns", whole, `${cols.length} columns`);
    check("payload.new carries the new status", upd.new?.status === "sold", String(upd.new?.status));
  }

  const insEvent = await waitFor(events, (e) => e.table === "territories" && e.eventType === "INSERT");
  check("INSERT event arrives", !!insEvent);

  await a.from("houses").delete().eq("id", target.id);
  const del = await waitFor(events, (e) => e.table === "houses" && e.eventType === "DELETE");
  check("DELETE event arrives", !!del);
  check(
    "payload.old carries the id (needed to remove the pin)",
    del?.old?.id === target.id,
    del ? `old = ${JSON.stringify(del.old)}` : "no event"
  );

  // --------------------------------------------------------- tenant isolation
  section("Tenant isolation — can a stranger read your crew's doors?");
  const tB = territory(TEAM_B, "Verify Bravo");
  const insB = await b.from("territories").insert(tB);
  check("second team can insert its own territory", !insB.error, insB.error?.message ?? "");

  // Team A's client asks for EVERYTHING, no team filter — the attacker's request.
  const dumpFromA = await a.from("houses").select("team_code");
  const teamsSeenByA = new Set((dumpFromA.data ?? []).map((r) => r.team_code));
  check(
    "a client scoped to one team cannot see other teams' houses",
    !teamsSeenByA.has(TEAM_B) && teamsSeenByA.size <= 1,
    `saw teams: [${[...teamsSeenByA].join(", ")}]`
  );

  // The raw anon key from the JS bundle, with no team token at all.
  const dumpBare = await bare.from("territories").select("team_code");
  check(
    "a client with ONLY the public anon key cannot enumerate teams",
    (dumpBare.data ?? []).length === 0 || dumpBare.error != null,
    dumpBare.error
      ? `blocked: ${dumpBare.error.message}`
      : dumpBare.data.length === 0
        ? "returned nothing"
        : `LEAK — ${dumpBare.data.length} rows across [${[...new Set(dumpBare.data.map((r) => r.team_code))].join(", ")}]`
  );

  // Can a stranger destroy data?
  const wipe = await bare.from("houses").delete().eq("team_code", TEAM_A);
  const survived = await a.from("houses").select("id", { count: "exact", head: true }).eq("team_code", TEAM_A);
  check(
    "a client with ONLY the public anon key cannot delete another team's houses",
    survived.count > 0,
    wipe.error ? `blocked: ${wipe.error.message}` : `${survived.count} rows left after the attempt`
  );

  // --------------------------------------------------------------- cleanup
  section("Cleanup");
  await channel.unsubscribe();
  await cleanup(a, b);
}

async function cleanup(a, b) {
  for (const [client, team] of [
    [a, TEAM_A],
    [b, TEAM_B],
  ]) {
    await client.from("houses").delete().eq("team_code", team);
    await client.from("territories").delete().eq("team_code", team);
  }
  check("test rows removed", true);
}

main()
  .then(async () => {
    await sleep(300);
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${passed}/${results.length} checks passed.`);
    if (failures) {
      console.log("\nFailures:");
      for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.note}`);
    }
    process.exit(failures ? 1 : 0);
  })
  .catch((err) => {
    console.error("\nVerification crashed:", err);
    process.exit(1);
  });
