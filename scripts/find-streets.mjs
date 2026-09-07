/**
 * Pulls the real geometry of the streets named on the Davis County 5212 map and
 * reports where they actually are, so the territory corners come from
 * OpenStreetMap rather than from eyeballing a screenshot.
 *
 *   node scripts/find-streets.mjs
 *
 * Utah grid names repeat between cities — Clearfield's 1000 West and Layton's
 * 2200 West are different grids — so this prints the latitude/longitude spread
 * of every matching way and lets us pick the right one deliberately.
 */

const BBOX = "41.00,-112.20,41.16,-111.92";

const NAMES = [
  "700 South",
  "1000 West",
  "1700 South",
  "Antelope Drive",
  "2200 West",
  "Gentile Street",
  "3200 West",
];

const query = `[out:json][timeout:90];
way["highway"]["name"~"(${NAMES.join("|")})"](${BBOX});
out geom;`;

// Worldwide mirrors only. overpass.osm.ch serves Switzerland and answers 200
// with zero elements for a US bbox, which reads as "nothing here".
const ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Overpass mirrors hand out 429s freely; rotate and back off rather than give up. */
export async function overpass(q) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const ep of ENDPOINTS) {
      try {
        const res = await fetch(ep, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(q),
        });
        if (res.status === 429 || res.status === 504) throw new Error(String(res.status));
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()).elements ?? [];
      } catch (e) {
        lastErr = e;
        await sleep(1500);
      }
    }
    const wait = 8000 * (attempt + 1);
    console.log(`  all mirrors busy, waiting ${wait / 1000}s...`);
    await sleep(wait);
  }
  throw lastErr ?? new Error("no endpoint answered");
}

async function run() {
  const elements = await overpass(query);

  // Group every way by its exact OSM name.
  const byName = new Map();
  for (const w of elements) {
    const name = w.tags?.name;
    if (!name || !w.geometry?.length) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(w.geometry.map((g) => [g.lat, g.lon]));
  }

  console.log(`${elements.length} ways, ${byName.size} distinct names\n`);

  const rows = [];
  for (const [name, lines] of byName) {
    const pts = lines.flat();
    const lats = pts.map((p) => p[0]);
    const lons = pts.map((p) => p[1]);
    const latSpread = Math.max(...lats) - Math.min(...lats);
    const lonSpread = Math.max(...lons) - Math.min(...lons);
    rows.push({
      name,
      ways: lines.length,
      orientation: lonSpread > latSpread ? "E-W" : "N-S",
      lat: `${Math.min(...lats).toFixed(5)}..${Math.max(...lats).toFixed(5)}`,
      lon: `${Math.min(...lons).toFixed(5)}..${Math.max(...lons).toFixed(5)}`,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(30)} ${r.orientation}  ways=${String(r.ways).padStart(3)}  lat ${r.lat}  lon ${r.lon}`
    );
  }
}

// Only produce the report when run directly; other scripts import overpass().
if (process.argv[1] && process.argv[1].endsWith("find-streets.mjs")) {
  run().catch((e) => {
    console.error("failed:", e.message);
    process.exit(1);
  });
}
