/**
 * Creates one of the marked-up areas as a territory and sets the status of the
 * houses inside it.
 *
 *   DB_ENV_FILE=<pulled env> node scripts/apply-area.mjs <team> <area> [--status=x] [--apply]
 *
 * Areas come from areas.mjs. Without --apply it only reports. The whole change
 * runs in one transaction, so a failure leaves the map exactly as it was.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { AREAS } from "./areas.mjs";

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
const areaKey = args[1] ?? "";
const apply = args.includes("--apply");
const statusArg = args.find((a) => a.startsWith("--status="))?.split("=")[1];

const area = AREAS[areaKey];
if (!dsn || !team || !area) {
  console.error(
    `Usage: DB_ENV_FILE=<file> node scripts/apply-area.mjs <team> <area> [--status=x] [--apply]\n` +
      `Areas: ${Object.keys(AREAS).join(", ")}`
  );
  process.exit(1);
}
const status = statusArg ?? area.status;

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
  `select h.id, h.address, h.lat, h.lng, h.status, t.name as territory
     from public.houses h left join public.territories t on t.id = h.territory_id
    where h.team_code = $1`,
  [team]
);
const inside = rows.filter((r) => pointInPolygon([Number(r.lat), Number(r.lng)], area.polygon));

console.log(`Area: ${area.name}`);
console.log(`Team ${team}: ${rows.length} houses, ${inside.length} inside.\n`);

const from = new Map();
for (const h of inside) {
  const k = `${h.territory ?? "(none)"} / ${h.status}`;
  from.set(k, (from.get(k) ?? 0) + 1);
}
console.log("Currently:");
for (const [k, n] of [...from].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);
console.log(`\nWould become: ${area.name} / ${status}`);

const streets = new Map();
for (const h of inside) {
  const st = (h.address || "").replace(/^[0-9]+[A-Za-z]? (#\S+ )?/, "") || "(no street)";
  streets.set(st, (streets.get(st) ?? 0) + 1);
}
console.log("\nTop streets:");
for (const [st, n] of [...streets].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${String(n).padStart(4)}  ${st}`);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to make the change.");
  await client.end();
  process.exit(0);
}

await client.query("begin");
try {
  const id = randomUUID();
  const now = new Date().toISOString();
  await client.query(
    `insert into public.territories (id, team_code, name, color, polygon, created_by, created_at)
     values ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [id, team, area.name, area.color, JSON.stringify(area.polygon), "map import", now]
  );
  const ids = inside.map((h) => h.id);
  for (let i = 0; i < ids.length; i += 500) {
    await client.query(
      `update public.houses set territory_id=$1, status=$2, updated_by='map import', updated_at=$3
        where id = any($4::text[])`,
      [id, status, now, ids.slice(i, i + 500)]
    );
  }
  await client.query("commit");
  console.log(`\nCreated "${area.name}" and set ${ids.length} houses to ${status}.`);
} catch (err) {
  await client.query("rollback");
  console.error("\nFailed, rolled back:", err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
