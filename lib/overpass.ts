import type { LatLng } from "./types";
import { pointInPolygon, simplify } from "./geo";

export interface FoundHouse {
  lat: number;
  lng: number;
  address: string;
}

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function polyString(polygon: LatLng[]): string {
  // Overpass wants "lat lon lat lon ..." and caps the clause length, so we
  // hand it a simplified outline rather than every freehand sample.
  const simplified = simplify(polygon, 0.00012);
  const outline = simplified.length >= 3 ? simplified : polygon;
  return outline.map(([lat, lng]) => `${lat.toFixed(6)} ${lng.toFixed(6)}`).join(" ");
}

/** Public Overpass mirrors go down or queue for minutes; do not wait forever. */
const PER_ENDPOINT_TIMEOUT_MS = 35000;

async function runQuery(query: string, signal?: AbortSignal): Promise<OverpassElement[]> {
  let lastError: unknown = null;

  for (const endpoint of ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_ENDPOINT_TIMEOUT_MS);
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener("abort", onOuterAbort);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`${new URL(endpoint).hostname} responded ${res.status}`);
      const json = await res.json();
      return (json.elements ?? []) as OverpassElement[];
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onOuterAbort);
    }
  }

  throw new Error(
    `The OpenStreetMap address service is not responding${
      lastError instanceof Error ? ` (${lastError.message})` : ""
    }. Try again in a minute, or drop houses by hand with the + button.`
  );
}

function labelFor(tags: Record<string, string> | undefined): string {
  if (!tags) return "";
  const number = tags["addr:housenumber"];
  const street = tags["addr:street"];
  const unit = tags["addr:unit"];
  if (number && street) return `${number}${unit ? ` #${unit}` : ""} ${street}`;
  if (number) return number;
  if (tags.name) return tags.name;
  return "";
}

function toHouses(elements: OverpassElement[], polygon: LatLng[]): FoundHouse[] {
  const seen = new Set<string>();
  const out: FoundHouse[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (!pointInPolygon([lat, lng], polygon)) continue;

    // Overpass returns both the address node and its enclosing building way for
    // many buildings; collapse anything within roughly 6 m of an existing hit.
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ lat, lng, address: labelFor(el.tags) });
  }
  return out;
}

/**
 * Pull every addressed building inside a drawn territory from OpenStreetMap.
 * Falls back to unaddressed residential building footprints where an area has
 * mapped buildings but no address data (common outside cities).
 */
export async function fetchHousesInPolygon(
  polygon: LatLng[],
  signal?: AbortSignal
): Promise<{ houses: FoundHouse[]; usedFallback: boolean }> {
  const poly = polyString(polygon);

  const addressQuery = `[out:json][timeout:25];
(
  node["addr:housenumber"](poly:"${poly}");
  way["addr:housenumber"](poly:"${poly}");
  relation["addr:housenumber"](poly:"${poly}");
);
out center tags;`;

  const addressed = toHouses(await runQuery(addressQuery, signal), polygon);
  if (addressed.length >= 3) return { houses: addressed, usedFallback: false };

  const buildingQuery = `[out:json][timeout:25];
(
  way["building"](poly:"${poly}");
  relation["building"](poly:"${poly}");
);
out center tags;`;

  const buildings = toHouses(await runQuery(buildingQuery, signal), polygon).filter(
    (h) => !addressed.some((a) => Math.abs(a.lat - h.lat) < 1e-5 && Math.abs(a.lng - h.lng) < 1e-5)
  );

  if (buildings.length === 0) return { houses: addressed, usedFallback: false };
  return { houses: [...addressed, ...buildings], usedFallback: true };
}
