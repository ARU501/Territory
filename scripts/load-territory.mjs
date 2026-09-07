/**
 * Creates a territory and loads its houses straight into Postgres.
 *
 *   DB_ENV_FILE=<pulled env> node scripts/load-territory.mjs <overpass.json> <team-code>
 *
 * Bulk loading through the browser would mean thousands of rows over a phone
 * connection, so this does it server-side. The dedupe and point-in-polygon
 * rules match lib/overpass.ts and lib/store.ts, so the result is exactly what
 * the app would have produced.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { TERRITORY_5212, TERRITORY_NAME } from "./territory-5212.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function loadEnv(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.trim().startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          let v = l.slice(i + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          return [l.slice(0, i).trim(), v];
        })
    );
  } catch {
    return {};
  }
}

const env = {
  ...loadEnv(join(here, "..", ".env.local")),
  ...loadEnv(process.env.DB_ENV_FILE ?? ""),
};
const dsn = process.env.POSTGRES_URL_NON_POOLING ?? env.POSTGRES_URL_NON_POOLING;
if (!dsn) {
  console.error("No POSTGRES_URL_NON_POOLING. Run: vercel env pull <file> --environment=production");
  process.exit(1);
}

const [jsonPath, teamArg] = process.argv.slice(2);
const team = (teamArg ?? "").trim().toLowerCase();
if (!jsonPath || !team) {
  console.error("Usage: node scripts/load-territory.mjs <overpass.json> <team-code>");
  process.exit(1);
}

// ---- geometry (mirrors lib/geo.ts) ---------------------------------------
function pointInPolygon([y, x], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function labelFor(tags = {}) {
  const number = tags["addr:housenumber"];
  const street = tags["addr:street"];
  const unit = tags["addr:unit"];
  if (number && street) return `${number}${unit ? ` #${unit}` : ""} ${street}`;
  if (number) return number;
  return tags.name ?? "";
}

// ---- parse ----------------------------------------------------------------
const elements = JSON.parse(readFileSync(jsonPath, "utf8")).elements ?? [];
console.log(`Overpass returned ${elements.length} features.`);

const seen = new Set();
const houses = [];
let outside = 0;
let dupes = 0;

for (const el of elements) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (typeof lat !== "number" || typeof lng !== "number") continue;

  if (!pointInPolygon([lat, lng], TERRITORY_5212)) {
    outside++;
    continue;
  }
  // OSM carries both an address node and its enclosing building way for many
  // buildings; ~1 m of rounding collapses the pair into one pin.
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (seen.has(key)) {
    dupes++;
    continue;
  }
  seen.add(key);
  houses.push({ lat, lng, address: labelFor(el.tags) });
}

console.log(`  ${outside} outside the boundary`);
console.log(`  ${dupes} duplicate node/building pairs collapsed`);
console.log(`  ${houses.length} houses to load`);

const withAddress = houses.filter((h) => h.address).length;
console.log(`  ${withAddress} have a street address, ${houses.length - withAddress} are bare pins\n`);

// ---- write ----------------------------------------------------------------
function encryptedDsn(raw) {
  try {
    const u = new URL(raw);
    u.searchParams.set("sslmode", "require");
    u.searchParams.set("uselibpqcompat", "true");
    return u.toString();
  } catch {
    return raw;
  }
}

const client = new pg.Client({
  connectionString: encryptedDsn(dsn),
  connectionTimeoutMillis: 30000,
  statement_timeout: 300000,
});

await client.connect();

const territoryId = randomUUID();
const now = new Date().toISOString();

await client.query("begin");
try {
  await client.query(
    `insert into public.territories (id, team_code, name, color, polygon, created_by, created_at)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [territoryId, team, TERRITORY_NAME, "#2563eb", JSON.stringify(TERRITORY_5212), "map import", now]
  );

  const CHUNK = 1000;
  for (let i = 0; i < houses.length; i += CHUNK) {
    const slice = houses.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    slice.forEach((h, k) => {
      const b = k * 10;
      values.push(
        `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`
      );
      params.push(
        randomUUID(), team, territoryId, h.lat, h.lng, h.address, "not_knocked", "", "map import", now
      );
    });
    await client.query(
      `insert into public.houses
         (id, team_code, territory_id, lat, lng, address, status, notes, updated_by, updated_at)
       values ${values.join(",")}`,
      params
    );
    process.stdout.write(`\r  inserted ${Math.min(i + CHUNK, houses.length)} / ${houses.length}`);
  }
  await client.query("commit");
  console.log("\n\nDone.");
} catch (err) {
  await client.query("rollback");
  console.error("\nFailed, rolled back:", err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
