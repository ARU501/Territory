/**
 * Turns the OSM street geometry in streets.json into the corner coordinates of
 * the Davis County 5212 territory.
 *
 *   node scripts/corners.mjs <streets.json>
 *
 * Utah grid names repeat between cities (Clearfield's 1000 West and Layton's
 * 2200 West belong to different grids), so this prints each candidate street's
 * extent first and then computes the specific intersections the map calls for.
 */

import { readFileSync } from "node:fs";

const els = JSON.parse(readFileSync(process.argv[2], "utf8")).elements ?? [];

/** name -> array of polylines, each [ [lat,lon], ... ] */
const byName = new Map();
for (const w of els) {
  const n = w.tags?.name;
  if (!n || !w.geometry?.length) continue;
  if (!byName.has(n)) byName.set(n, []);
  byName.get(n).push(w.geometry.map((g) => [g.lat, g.lon]));
}

function extent(lines) {
  const pts = lines.flat();
  const lats = pts.map((p) => p[0]);
  const lons = pts.map((p) => p[1]);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLon: Math.min(...lons),
    maxLon: Math.max(...lons),
    n: pts.length,
  };
}

console.log("Streets found (E-W roads vary in latitude; N-S roads in longitude):\n");
const rows = [...byName.entries()]
  .map(([name, lines]) => ({ name, lines, ...extent(lines) }))
  .sort((a, b) => a.name.localeCompare(b.name));

for (const r of rows) {
  const ew = r.maxLon - r.minLon > r.maxLat - r.minLat;
  console.log(
    `${r.name.padEnd(26)} ${ew ? "E-W" : "N-S"}  ` +
      `lat ${r.minLat.toFixed(5)}-${r.maxLat.toFixed(5)}  ` +
      `lon ${r.minLon.toFixed(5)}-${r.maxLon.toFixed(5)}  (${r.lines.length} ways)`
  );
}

// ---- segment intersection ------------------------------------------------
function segInt(p1, p2, p3, p4) {
  const [y1, x1] = p1, [y2, x2] = p2, [y3, x3] = p3, [y4, x4] = p4;
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(d) < 1e-14) return null;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [y1 + t * (y2 - y1), x1 + t * (x2 - x1)];
}

function crossings(nameA, nameB) {
  const A = byName.get(nameA) ?? [];
  const B = byName.get(nameB) ?? [];
  const hits = [];
  for (const la of A)
    for (let i = 0; i < la.length - 1; i++)
      for (const lb of B)
        for (let j = 0; j < lb.length - 1; j++) {
          const p = segInt(la[i], la[i + 1], lb[j], lb[j + 1]);
          if (p) hits.push(p);
        }
  // collapse near-duplicates
  const out = [];
  for (const h of hits) {
    if (!out.some((o) => Math.abs(o[0] - h[0]) < 1e-4 && Math.abs(o[1] - h[1]) < 1e-4)) out.push(h);
  }
  return out;
}

console.log("\nIntersections:\n");
const EW = ["West 700 South", "West Antelope Drive", "Antelope Drive", "Gentile Street"];
const NS = ["1000 West", "South 1000 West", "2200 West", "North 2200 West", "3200 West", "North 3200 West"];

for (const a of EW) {
  for (const b of NS) {
    const hits = crossings(a, b);
    if (!hits.length) continue;
    console.log(
      `${a.padEnd(22)} x ${b.padEnd(18)} -> ` +
        hits.map((h) => `${h[0].toFixed(6)}, ${h[1].toFixed(6)}`).join(" | ")
    );
  }
}

// How far west does each E-W road actually reach on land?
console.log("\nWestern ends (where the mapped road stops and the imaginary line begins):");
for (const name of EW) {
  const lines = byName.get(name);
  if (!lines) continue;
  const pts = lines.flat();
  const west = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
  console.log(`  ${name.padEnd(22)} ${west[0].toFixed(6)}, ${west[1].toFixed(6)}`);
}

// And how far south do the N-S roads run?
console.log("\nSouthern ends:");
for (const name of NS) {
  const lines = byName.get(name);
  if (!lines) continue;
  const pts = lines.flat();
  const south = pts.reduce((a, b) => (b[0] < a[0] ? b : a));
  console.log(`  ${name.padEnd(22)} ${south[0].toFixed(6)}, ${south[1].toFixed(6)}`);
}
