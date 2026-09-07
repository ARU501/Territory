/**
 * The "worked grid" area, defined by the four streets written on the map:
 *
 *   North  W Antelope Dr
 *   South  E 2200 S
 *   West   S Main St
 *   East   N 2200 W
 *
 *   node scripts/worked-grid.mjs <grid.json>          report the corners
 *   DB_ENV_FILE=... node scripts/worked-grid.mjs <grid.json> --count
 *
 * Unlike the previous hand-drawn box, every corner here is a genuine street
 * intersection computed from OpenStreetMap geometry, so there is no fitting and
 * no pixel guesswork.
 */

import { readFileSync } from "node:fs";

const file = process.argv[2];
const els = JSON.parse(readFileSync(file, "utf8")).elements ?? [];

const byName = new Map();
for (const w of els) {
  const n = w.tags?.name;
  if (!n || !w.geometry?.length) continue;
  if (!byName.has(n)) byName.set(n, []);
  byName.get(n).push(w.geometry.map((g) => [g.lat, g.lon]));
}

function segInt(p1, p2, p3, p4) {
  const [y1, x1] = p1, [y2, x2] = p2, [y3, x3] = p3, [y4, x4] = p4;
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(d) < 1e-14) return null;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [y1 + t * (y2 - y1), x1 + t * (x2 - x1)];
}

/** Where two named roads actually cross. Names vary by city, so try variants. */
function cross(namesA, namesB) {
  const hits = [];
  for (const na of namesA)
    for (const la of byName.get(na) ?? [])
      for (let i = 0; i < la.length - 1; i++)
        for (const nb of namesB)
          for (const lb of byName.get(nb) ?? [])
            for (let j = 0; j < lb.length - 1; j++) {
              const p = segInt(la[i], la[i + 1], lb[j], lb[j + 1]);
              if (p && !hits.some((h) => Math.abs(h[0] - p[0]) < 1e-4 && Math.abs(h[1] - p[1]) < 1e-4)) {
                hits.push(p);
              }
            }
  return hits;
}

const ANTELOPE = ["Antelope Drive", "West Antelope Drive", "East Antelope Drive"];
const S2200 = ["2200 South", "West 2200 South", "East 2200 South"];
const MAIN = ["Main Street", "South Main Street", "North Main Street"];
const W2200 = ["2200 West", "North 2200 West", "South 2200 West"];

const nw = cross(ANTELOPE, MAIN);
const ne = cross(ANTELOPE, W2200);
const se = cross(S2200, W2200);
const sw = cross(S2200, MAIN);

console.log("Corner intersections found:\n");
const show = (label, hits) =>
  console.log(
    `  ${label.padEnd(34)} ${hits.length ? hits.map((h) => `${h[0].toFixed(6)}, ${h[1].toFixed(6)}`).join(" | ") : "NONE"}`
  );
show("NW  Antelope Dr x Main St", nw);
show("NE  Antelope Dr x 2200 W", ne);
show("SE  2200 South x 2200 W", se);
show("SW  2200 South x Main St", sw);

/**
 * Davis County has several unrelated roads called "Main Street" — Clearfield's,
 * Layton's, and an unprefixed way spanning both. Antelope Drive crosses more
 * than one of them, so taking the first hit picks an arbitrary city. The
 * intended one is South Main Street, which the SW corner resolves to
 * unambiguously, so corners are chosen by proximity to that longitude.
 */
const MAIN_LON = -112.026139; // South Main Street, measured
const nearestTo = (hits, lon) =>
  hits.length
    ? hits.reduce((best, h) => (Math.abs(h[1] - lon) < Math.abs(best[1] - lon) ? h : best))
    : null;

const corners = [
  nearestTo(nw, MAIN_LON),
  nearestTo(ne, -112.006934),
  nearestTo(se, -112.006934),
  nearestTo(sw, MAIN_LON),
];

if (corners.some((c) => !c)) {
  console.log("\nAt least one corner did not resolve; falling back to the street lines.");
  // Grid streets hold one axis almost constant, so a missing crossing can be
  // reconstructed from the two lines that should have met.
  const axis = (names, which) => {
    const pts = names.flatMap((n) => (byName.get(n) ?? []).flat());
    if (!pts.length) return null;
    const vals = pts.map((p) => (which === "lat" ? p[0] : p[1]));
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  console.log(`  Antelope Dr  lat ~ ${axis(ANTELOPE, "lat")?.toFixed(6)}`);
  console.log(`  2200 South   lat ~ ${axis(S2200, "lat")?.toFixed(6)}`);
  console.log(`  Main St      lon ~ ${axis(MAIN, "lon")?.toFixed(6)}`);
  console.log(`  2200 West    lon ~ ${axis(W2200, "lon")?.toFixed(6)}`);
} else {
  console.log("\nPolygon (clockwise from north-west):\n");
  console.log(
    "export const WORKED_GRID = [\n" +
      corners
        .map(([la, lo], i) => `  [${la.toFixed(6)}, ${lo.toFixed(6)}], // ${["NW", "NE", "SE", "SW"][i]}`)
        .join("\n") +
      "\n];"
  );
}
