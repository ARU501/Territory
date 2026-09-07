/** What are the roads around Clearfield / Layton actually called in OSM? */
import { overpass } from "./find-streets.mjs";

const q = `[out:json][timeout:60];
way["highway"]["name"](41.06,-112.10,41.12,-111.98);
out tags;`;

const els = await overpass(q);
console.log(`${els.length} named ways\n`);

const names = new Map();
for (const w of els) {
  const n = w.tags?.name;
  if (!n) continue;
  names.set(n, (names.get(n) ?? 0) + 1);
}

const interesting = [...names.entries()]
  .filter(([n]) => /\d{3,4}|Antelope|Gentile/i.test(n))
  .sort((a, b) => a[0].localeCompare(b[0]));

console.log("Grid-style and named arterials:");
for (const [n, c] of interesting) console.log(`  ${String(c).padStart(3)}x  ${n}`);

console.log(`\n(${names.size} distinct names total)`);
process.exit(0);
