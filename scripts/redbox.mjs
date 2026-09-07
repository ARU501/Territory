/**
 * Converts the hand-drawn red box from the Google Maps screenshot into real
 * coordinates, and reports which of the loaded houses fall inside it.
 *
 *   DB_ENV_FILE=<pulled env> node scripts/redbox.mjs
 *
 * The pixel-to-degree fit uses landmarks read out of OpenStreetMap rather than
 * a guessed scale:
 *
 *   S 2000 W   x=445   lon -112.064650
 *   S 1000 W   x=865   lon -112.045318
 *   W 2700 S   y=1390  lat  41.074715
 *
 * Longitude comes straight from the two vertical streets. Latitude is derived
 * from that horizontal scale times cos(latitude) — the map is Web Mercator, so
 * the two axes are not interchangeable — anchored on 2700 South. Checking the
 * result against Antelope BMX (41.069650, -112.068692), which was not used in
 * the fit, lands within about 90 m.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const LON_PER_PX = (-112.045318 - -112.064650) / (865 - 445);
const LAT_PER_PX = LON_PER_PX * Math.cos((41.08 * Math.PI) / 180);

const lonAt = (x) => -112.064650 + (x - 445) * LON_PER_PX;
const latAt = (y) => 41.074715 + (1390 - y) * LAT_PER_PX;

/** The red outline, read off the screenshot clockwise from the top-left. */
const PIXELS = [
  [125, 968],   // top-left, on the railroad corridor
  [720, 975],   // top-right
  [680, 1220],  // bottom-right
  [240, 1195],  // bottom-left
];

export const RED_BOX = PIXELS.map(([x, y]) => [
  Number(latAt(y).toFixed(6)),
  Number(lonAt(x).toFixed(6)),
]);

function pointInPolygon([y, x], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

if (process.argv[1] && process.argv[1].endsWith("redbox.mjs")) {
  const here = dirname(fileURLToPath(import.meta.url));

  const loadEnv = (p) => {
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
  };
  const env = { ...loadEnv(join(here, "..", ".env.local")), ...loadEnv(process.env.DB_ENV_FILE ?? "") };

  console.log("Red box corners:\n");
  const labels = ["top-left (railroad)", "top-right", "bottom-right", "bottom-left"];
  RED_BOX.forEach((c, i) => console.log(`  ${labels[i].padEnd(22)} ${c[0]}, ${c[1]}`));

  const lats = RED_BOX.map((c) => c[0]);
  const lons = RED_BOX.map((c) => c[1]);
  console.log(`\n  north edge  lat ${Math.max(...lats).toFixed(5)}  (Antelope Drive sits at 41.08913)`);
  console.log(`  south edge  lat ${Math.min(...lats).toFixed(5)}  (W 2200 South sits at 41.08192)`);
  console.log(`  east edge   lon ${Math.max(...lons).toFixed(5)}  (S 1000 W sits at -112.04532)`);
  console.log(`  west edge   lon ${Math.min(...lons).toFixed(5)}  (S 2000 W sits at -112.06465)`);

  const dsn = env.POSTGRES_URL_NON_POOLING;
  if (!dsn) {
    console.log("\n(no database URL; skipping the house count)");
    process.exit(0);
  }

  const u = new URL(dsn);
  u.searchParams.set("sslmode", "require");
  u.searchParams.set("uselibpqcompat", "true");
  const client = new pg.Client({ connectionString: u.toString(), connectionTimeoutMillis: 30000 });
  await client.connect();
  const { rows } = await client.query(
    "select id, address, lat, lng, status, territory_id from public.houses"
  );
  await client.end();

  const inside = rows.filter((r) => pointInPolygon([Number(r.lat), Number(r.lng)], RED_BOX));
  console.log(`\n${inside.length} of ${rows.length} loaded houses fall inside the red box.`);

  const streets = new Map();
  for (const h of inside) {
    const st = (h.address || "").replace(/^[0-9]+[A-Za-z]? (#\S+ )?/, "") || "(no street)";
    streets.set(st, (streets.get(st) ?? 0) + 1);
  }
  console.log("\nStreets covered:");
  for (const [st, n] of [...streets].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(4)}  ${st}`);
  }
  process.exit(0);
}
