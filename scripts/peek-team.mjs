/**
 * Reads one team's rows straight out of the database, using the same signed
 * token the app uses. Handy for confirming that what the UI claims it saved
 * really is in Postgres.
 *
 *   node scripts/peek-team.mjs <team-code>
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

const team = process.argv[2];
if (!team) {
  console.error("Usage: node scripts/peek-team.mjs <team-code>");
  process.exit(1);
}

const b64url = (b) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

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
    exp: iat + 600,
  })
);
const token = `${head}.${body}.${b64url(
  createHmac("sha256", env.SUPABASE_JWT_SECRET).update(`${head}.${body}`).digest()
)}`;

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  accessToken: async () => token,
});

const t = await db.from("territories").select("*").eq("team_code", team);
const h = await db.from("houses").select("*").eq("team_code", team);

console.log(`Team: ${team}\n`);

if (t.error || h.error) {
  console.error("Query failed:", (t.error ?? h.error)?.message);
  process.exit(1);
}

console.log(`Territories (${t.data.length}):`);
for (const row of t.data) {
  console.log(`  ${row.name}  [${row.color}]  ${row.polygon?.length ?? 0} points  by ${row.created_by}`);
}

console.log(`\nHouses (${h.data.length}):`);
for (const row of h.data.slice(0, 20)) {
  console.log(
    `  ${(row.address || "(dropped pin)").padEnd(28)} ${row.status.padEnd(16)} ${row.updated_by}` +
      (row.notes ? `\n      note: ${row.notes}` : "")
  );
}
if (h.data.length > 20) console.log(`  ... and ${h.data.length - 20} more`);

process.exit(0);
