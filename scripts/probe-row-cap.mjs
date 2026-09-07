/**
 * Does this project silently truncate a large SELECT?
 *
 *   node scripts/probe-row-cap.mjs
 *
 * Supabase caps rows per request (1000 by default). A team with several loaded
 * territories passes that easily — 156 houses is one city block — and the cap
 * is not an error: the query just returns fewer rows than exist, so the map
 * quietly loses houses with nothing on screen to say so.
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

const TEAM = "zz-rowcap";
const TOTAL = 1250;

const b64url = (b) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const iat = Math.floor(Date.now() / 1000);
const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const body = b64url(
  JSON.stringify({ iss: "supabase", role: "anon", aud: "authenticated", sub: `team:${TEAM}`, team: TEAM, iat, exp: iat + 900 })
);
const token = `${head}.${body}.${b64url(
  createHmac("sha256", env.SUPABASE_JWT_SECRET).update(`${head}.${body}`).digest()
)}`;

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  accessToken: async () => token,
});

const uuid = () => crypto.randomUUID();
const stamp = () => new Date().toISOString();

console.log(`Inserting ${TOTAL} houses for ${TEAM}...`);
const rows = Array.from({ length: TOTAL }, (_, i) => ({
  id: uuid(),
  team_code: TEAM,
  territory_id: null,
  lat: 40.62 + i * 0.000005,
  lng: -74.02 + i * 0.000005,
  address: `${i} Cap Street`,
  status: "not_knocked",
  notes: "",
  updated_by: "probe",
  updated_at: stamp(),
}));
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await db.from("houses").insert(rows.slice(i, i + 500));
  if (error) {
    console.error("insert failed:", error.message);
    process.exit(1);
  }
}

const exact = await db
  .from("houses")
  .select("id", { count: "exact", head: true })
  .eq("team_code", TEAM);
console.log(`Database really holds: ${exact.count}`);

const naive = await db.from("houses").select("*").eq("team_code", TEAM);
console.log(`One plain select returns: ${naive.data?.length ?? 0}`);

// Paged read, the way the app should do it.
const PAGE = 1000;
const all = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from("houses")
    .select("*")
    .eq("team_code", TEAM)
    .order("id", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) {
    console.error("paged read failed:", error.message);
    break;
  }
  all.push(...(data ?? []));
  if (!data || data.length < PAGE) break;
}
console.log(`Paged read returns:      ${all.length}`);

const truncated = (naive.data?.length ?? 0) < exact.count;
console.log(
  truncated
    ? `\nCONFIRMED: a plain select silently drops ${exact.count - naive.data.length} houses. Pagination is required.`
    : `\nNo cap hit at ${TOTAL} rows on this project.`
);

await db.from("houses").delete().eq("team_code", TEAM);
console.log("Cleaned up.");
process.exit(0);
