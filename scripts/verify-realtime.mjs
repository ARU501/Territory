/**
 * Isolates the realtime failures seen in verify-supabase.mjs.
 *
 *   node scripts/verify-realtime.mjs
 *
 * Two candidate causes need separating:
 *   1. rate limiting  - the app inserts 150+ houses at once when a territory
 *                       loads, and the client is configured with a low
 *                       eventsPerSecond, so events may be dropped or the
 *                       channel torn down.
 *   2. replica identity - under Postgres' default (primary key) replica
 *                       identity, a DELETE's payload.old may not carry what the
 *                       app needs to remove the pin.
 *
 * So: one quiet insert, one quiet delete, no flood. Then a separate burst test.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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
const TEAM = "zz-realtime-probe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();
const stamp = () => new Date().toISOString();

const log = (m) => console.log(m);
const mark = (ok, name, note = "") =>
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${note ? `  — ${note}` : ""}`);

function house(territoryId, i) {
  return {
    id: uuid(),
    team_code: TEAM,
    territory_id: territoryId,
    lat: 40.626 + i * 0.00002,
    lng: -74.0285 + i * 0.00002,
    address: `${i} Probe Street`,
    status: "not_knocked",
    notes: "",
    updated_by: "probe",
    updated_at: stamp(),
  };
}

async function subscribe(client, bucket, label) {
  const ch = client
    .channel(`probe:${label}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "houses", filter: `team_code=eq.${TEAM}` },
      (p) => bucket.push(p)
    );
  const status = await new Promise((resolve) => {
    const t = setTimeout(() => resolve("TIMEOUT"), 15000);
    ch.subscribe((s) => {
      if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s)) {
        clearTimeout(t);
        resolve(s);
      }
    });
  });
  return { ch, status };
}

async function cleanup(client) {
  await client.from("houses").delete().eq("team_code", TEAM);
  await client.from("territories").delete().eq("team_code", TEAM);
}

async function main() {
  console.log(`Realtime probe against ${URL_}\n`);

  // --------------------------------------------------- 1. quiet single events
  log("Test 1 — one insert, one update, one delete, no flood");
  const quiet = createClient(URL_, KEY, { realtime: { params: { eventsPerSecond: 10 } } });
  await cleanup(quiet);

  const events = [];
  const { ch, status } = await subscribe(quiet, events, "quiet");
  mark(status === "SUBSCRIBED", "channel subscribes", status);

  const terr = {
    id: uuid(),
    team_code: TEAM,
    name: "Probe",
    color: "#2563eb",
    polygon: [[40.6255, -74.03], [40.6255, -74.027], [40.6275, -74.027]],
    created_by: "probe",
    created_at: stamp(),
  };
  await quiet.from("territories").insert(terr);

  const h = house(terr.id, 1);
  await quiet.from("houses").insert(h);
  await sleep(4000);
  const ins = events.find((e) => e.eventType === "INSERT" && e.new?.id === h.id);
  mark(!!ins, "INSERT delivered", ins ? `${Object.keys(ins.new).length} columns` : "nothing arrived");

  await quiet.from("houses").update({ status: "knocked" }).eq("id", h.id);
  await sleep(4000);
  const upd = events.find((e) => e.eventType === "UPDATE" && e.new?.id === h.id);
  mark(!!upd, "UPDATE delivered", upd ? `status=${upd.new.status}` : "nothing arrived");

  await quiet.from("houses").delete().eq("id", h.id);
  await sleep(4000);
  const del = events.find((e) => e.eventType === "DELETE");
  mark(!!del, "DELETE delivered");
  mark(
    del?.old?.id === h.id,
    "DELETE payload.old carries the id",
    del ? `old = ${JSON.stringify(del.old)}` : "no event"
  );

  await ch.unsubscribe();

  // ------------------------------------------- 2. the flood the app produces
  log("\nTest 2 — the burst a territory load actually produces (160 inserts)");
  const burstEvents = [];
  const burstClient = createClient(URL_, KEY, { realtime: { params: { eventsPerSecond: 10 } } });
  const { ch: ch2, status: s2 } = await subscribe(burstClient, burstEvents, "burst");
  mark(s2 === "SUBSCRIBED", "channel subscribes", s2);

  let channelState = "ok";
  ch2.on("system", {}, (p) => {
    if (p?.status === "error") channelState = "error";
  });

  const many = Array.from({ length: 160 }, (_, i) => house(terr.id, i + 10));
  await burstClient.from("houses").insert(many);
  await sleep(12000);

  const got = burstEvents.filter((e) => e.eventType === "INSERT").length;
  mark(
    got >= 160,
    "all 160 INSERT events delivered to a watching teammate",
    `received ${got}/160 (channel: ${ch2.state})`
  );
  if (got < 160) {
    console.log(
      `\n  -> A teammate watching while someone loads a territory sees only ${got} of 160 pins.\n` +
        `     The rest appear only when they reload. Channel state: ${ch2.state}.`
    );
  }

  await ch2.unsubscribe();
  await cleanup(quiet);
  console.log("\nCleaned up.");
}

main()
  .then(() => sleep(400).then(() => process.exit(0)))
  .catch(async (e) => {
    console.error("\nProbe crashed:", e);
    process.exit(1);
  });
