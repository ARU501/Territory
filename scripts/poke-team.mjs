/**
 * Marks one of a team's houses from outside the browser, to prove that a change
 * made by a teammate reaches an open app live.
 *
 *   node scripts/poke-team.mjs <team-code> <status>
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
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const [team, status = "knocked"] = process.argv.slice(2);
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const iat = Math.floor(Date.now() / 1000);
const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const body = b64url(JSON.stringify({ iss: "supabase", role: "anon", aud: "authenticated", sub: `team:${team}`, team, iat, exp: iat + 600 }));
const token = `${head}.${body}.${b64url(createHmac("sha256", env.SUPABASE_JWT_SECRET).update(`${head}.${body}`).digest())}`;

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  accessToken: async () => token,
});

const { data } = await db.from("houses").select("id,address").eq("team_code", team).limit(1);
if (!data?.length) { console.error("No houses for that team."); process.exit(1); }

const { error } = await db.from("houses").update({
  status,
  address: "12 Teammate Lane",
  updated_by: "Marcus (other phone)",
  updated_at: new Date().toISOString(),
}).eq("id", data[0].id);

console.log(error ? `FAILED: ${error.message}` : `Marked ${data[0].id} as ${status} from a second device.`);
process.exit(error ? 1 : 0);
