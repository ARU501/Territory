/**
 * Reports the real position of the landmarks and streets visible in a map
 * screenshot, so a hand-drawn area can be transferred onto real coordinates by
 * fitting to known points instead of guessing at a scale.
 *
 *   node scripts/anchors.mjs <landmarks.json>
 */

import { readFileSync } from "node:fs";

const els = JSON.parse(readFileSync(process.argv[2], "utf8")).elements ?? [];

const pois = [];
const streets = new Map();

for (const el of els) {
  const name = el.tags?.name;
  if (!name) continue;

  if (el.tags.highway && el.geometry?.length) {
    if (!streets.has(name)) streets.set(name, []);
    streets.get(name).push(el.geometry.map((g) => [g.lat, g.lon]));
    continue;
  }

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (typeof lat === "number" && typeof lon === "number") {
    pois.push({ name, lat, lon, kind: el.tags.leisure ?? el.tags.amenity ?? el.tags.shop ?? "" });
  }
}

console.log("Landmarks:");
const seen = new Set();
for (const p of pois) {
  const key = p.name + p.lat.toFixed(4);
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`  ${p.name.padEnd(24)} ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}  ${p.kind}`);
}

console.log("\nStreets (a grid street should hold one value almost constant):");
for (const [name, lines] of [...streets].sort((a, b) => a[0].localeCompare(b[0]))) {
  const pts = lines.flat();
  const lats = pts.map((p) => p[0]);
  const lons = pts.map((p) => p[1]);
  const dLat = Math.max(...lats) - Math.min(...lats);
  const dLon = Math.max(...lons) - Math.min(...lons);
  const ew = dLon > dLat;
  // For a grid street, the useful number is the axis it holds constant.
  const held = ew
    ? `lat ~ ${(lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(6)}`
    : `lon ~ ${(lons.reduce((a, b) => a + b, 0) / lons.length).toFixed(6)}`;
  console.log(
    `  ${name.padEnd(24)} ${ew ? "E-W" : "N-S"}  ${held}   ` +
      `lat ${Math.min(...lats).toFixed(5)}-${Math.max(...lats).toFixed(5)} ` +
      `lon ${Math.min(...lons).toFixed(5)}-${Math.max(...lons).toFixed(5)}`
  );
}
