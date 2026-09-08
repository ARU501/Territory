/**
 * Puts the apartment buildings from the printed 5212 map onto a team's map.
 *
 *   DB_ENV_FILE=<pulled env> node scripts/load-apartments.mjs <team> [--apply]
 *
 * Without --apply it only reports. Re-running is safe: a building whose name is
 * already on the team's map is skipped rather than duplicated, so this can be
 * run again after adding to apartments.mjs.
 *
 * Each building is filed into whichever drawn area contains it, exactly as a
 * tap on the map would. A building landing in an area whose houses are entirely
 * off limits inherits that: it is inside a boundary somebody drew to say "do
 * not knock here", and shipping it as knockable would contradict the boundary.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { APARTMENTS, ESTIMATED_NOTE } from "./apartments.mjs";

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

const args = process.argv.slice(2);
const team = (args[0] ?? "").trim().toLowerCase();
const apply = args.includes("--apply");

if (!dsn || !team) {
  console.error("Usage: DB_ENV_FILE=<file> node scripts/load-apartments.mjs <team> [--apply]");
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

/** Rough relative size; only the ordering matters here. */
function polygonSize(polygon) {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += (polygon[j][1] - polygon[i][1]) * (polygon[j][0] + polygon[i][0]);
  }
  return Math.abs(sum / 2);
}

/**
 * Areas nest — the off-limits box and the worked grid both sit inside the big
 * 5212 territory — so the first polygon that contains a point is whichever the
 * database happened to return first. The smallest containing area is the one
 * somebody drew deliberately around that spot.
 */
function smallestContaining(point, areas) {
  let best = null;
  let bestSize = Infinity;
  for (const a of areas) {
    if (!Array.isArray(a.polygon) || a.polygon.length < 3) continue;
    if (!pointInPolygon(point, a.polygon)) continue;
    const size = polygonSize(a.polygon);
    if (size < bestSize) {
      best = a;
      bestSize = size;
    }
  }
  return best;
}

const u = new URL(dsn);
u.searchParams.set("sslmode", "require");
u.searchParams.set("uselibpqcompat", "true");
const client = new pg.Client({ connectionString: u.toString(), connectionTimeoutMillis: 30000 });
await client.connect();

const { rows: territories } = await client.query(
  `select id, name, polygon from public.territories where team_code = $1`,
  [team]
);

// Whether each area is wholly off limits, which is what a building landing in
// one should inherit.
const { rows: mix } = await client.query(
  `select territory_id,
          count(*)                                          as total,
          count(*) filter (where status = 'do_not_knock')    as blocked
     from public.houses
    where team_code = $1 and kind = 'house'
    group by territory_id`,
  [team]
);
const allBlocked = new Map(
  mix.map((r) => [r.territory_id, Number(r.total) > 0 && Number(r.total) === Number(r.blocked)])
);

const { rows: existing } = await client.query(
  `select id, name from public.houses where team_code = $1 and kind = 'complex'`,
  [team]
);
const known = new Set(existing.map((r) => r.name.trim().toLowerCase()));

const plan = [];
for (const b of APARTMENTS) {
  const area = smallestContaining([b.lat, b.lng], territories);
  plan.push({
    ...b,
    territory_id: area?.id ?? null,
    territory: area?.name ?? "(not inside any area)",
    status: area && allBlocked.get(area.id) ? "do_not_knock" : "not_knocked",
    skip: known.has(b.name.trim().toLowerCase()),
  });
}

console.log(`Team ${team}: ${territories.length} areas, ${existing.length} buildings already on the map.\n`);
for (const p of plan) {
  const mark = p.skip ? "skip" : p.estimated ? "est " : "osm ";
  console.log(
    `  ${mark} ${String(p.marker).padStart(2)}. ${p.name.padEnd(26)} ` +
      `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}  ${p.status.padEnd(13)} ${p.territory}`
  );
}

const todo = plan.filter((p) => !p.skip);
console.log(
  `\n${todo.length} to add (${todo.filter((p) => p.estimated).length} estimated), ` +
    `${plan.length - todo.length} already there.`
);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to make the change.");
  await client.end();
  process.exit(0);
}

if (todo.length === 0) {
  await client.end();
  process.exit(0);
}

await client.query("begin");
try {
  const now = new Date().toISOString();
  for (const p of todo) {
    const notes = [p.note, p.estimated ? ESTIMATED_NOTE : null].filter(Boolean).join(" · ");
    await client.query(
      `insert into public.houses
         (id, team_code, territory_id, lat, lng, address, status, notes,
          updated_by, updated_at, kind, name)
       values ($1,$2,$3,$4,$5,'',$6,$7,'map import',$8,'complex',$9)`,
      [randomUUID(), team, p.territory_id, p.lat, p.lng, p.status, notes, now, p.name]
    );
  }
  await client.query("commit");
  console.log(`\nAdded ${todo.length} apartment buildings.`);
} catch (err) {
  await client.query("rollback");
  console.error("\nFailed, rolled back:", err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
