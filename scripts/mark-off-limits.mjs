/**
 * Creates the red off-limits area from the hand-drawn map and moves the houses
 * inside it out of the working territory.
 *
 *   DB_ENV_FILE=<pulled env> node scripts/mark-off-limits.mjs <team-code> [--apply]
 *
 * Without --apply it only reports what it would do. Everything runs in one
 * transaction, so a failure leaves the map exactly as it was.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { RED_BOX } from "./redbox.mjs";

const NAME = "Off limits — Allison Acres / 2175 S";
const COLOR = "#dc2626";

const here = dirname(fileURLToPath(import.meta.url));

function loadEnv(p) {
  try {
    return Object.fromEntries(
      readFileSync(p, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.trim().startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          let v = l.slice(i + 1).trim();
          if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
          return [l.slice(0, i).trim(), v];
        })
    );
  } catch {
    return {};
  }
}

const env = { ...loadEnv(join(here, "..", ".env.local")), ...loadEnv(process.env.DB_ENV_FILE ?? "") };
const dsn = env.POSTGRES_URL_NON_POOLING;
const team = (process.argv[2] ?? "").trim().toLowerCase();
const apply = process.argv.includes("--apply");

if (!dsn || !team) {
  console.error("Usage: DB_ENV_FILE=<file> node scripts/mark-off-limits.mjs <team-code> [--apply]");
  process.exit(1);
}

function pointInPolygon([y, x], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const u = new URL(dsn);
u.searchParams.set("sslmode", "require");
u.searchParams.set("uselibpqcompat", "true");
const client = new pg.Client({ connectionString: u.toString(), connectionTimeoutMillis: 30000 });
await client.connect();

const { rows } = await client.query(
  "select id, address, lat, lng, status from public.houses where team_code = $1",
  [team]
);
const inside = rows.filter((r) => pointInPolygon([Number(r.lat), Number(r.lng)], RED_BOX));

console.log(`Team ${team}: ${rows.length} houses, ${inside.length} inside the red box.`);
const alreadyMarked = inside.filter((h) => h.status !== "not_knocked").length;
if (alreadyMarked) {
  console.log(`  ${alreadyMarked} already have a status other than "not knocked" —`);
  console.log(`  their status will be overwritten with "do not knock".`);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to make the change.");
  await client.end();
  process.exit(0);
}

await client.query("begin");
try {
  const territoryId = randomUUID();
  const now = new Date().toISOString();

  await client.query(
    `insert into public.territories (id, team_code, name, color, polygon, created_by, created_at)
     values ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [territoryId, team, NAME, COLOR, JSON.stringify(RED_BOX), "map import", now]
  );

  const ids = inside.map((h) => h.id);
  for (let i = 0; i < ids.length; i += 500) {
    await client.query(
      `update public.houses
          set territory_id = $1, status = 'do_not_knock', updated_by = 'map import', updated_at = $2
        where id = any($3::text[])`,
      [territoryId, now, ids.slice(i, i + 500)]
    );
  }

  await client.query("commit");
  console.log(`\nCreated "${NAME}" and marked ${ids.length} houses do not knock.`);
} catch (err) {
  await client.query("rollback");
  console.error("\nFailed, rolled back:", err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
