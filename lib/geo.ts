import type { LatLng } from "./types";

/** Ray-casting point-in-polygon test. Polygon is an array of [lat, lng]. */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  const [y, x] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function polygonBounds(polygon: LatLng[]): [LatLng, LatLng] {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of polygon) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

/** Approximate area in square metres using an equirectangular projection. */
export function polygonAreaSqM(polygon: LatLng[]): number {
  if (polygon.length < 3) return 0;
  const R = 6378137;
  const latRef = (polygon.reduce((s, p) => s + p[0], 0) / polygon.length) * (Math.PI / 180);
  const pts = polygon.map(([lat, lng]) => [
    ((lng * Math.PI) / 180) * R * Math.cos(latRef),
    ((lat * Math.PI) / 180) * R,
  ]);
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(area / 2);
}

/**
 * Which drawn area a point belongs to when areas overlap.
 *
 * Areas nest in practice: an off-limits block sits inside the territory it was
 * carved out of, and a worked grid sits inside the same one. Taking the first
 * match means a new pin lands in whichever area the database happened to return
 * first, so a house dropped inside a "do not knock" box can end up filed under
 * the surrounding territory. The smallest containing area is always the one
 * somebody drew deliberately around that spot.
 */
export function smallestContaining<T extends { polygon: LatLng[] }>(
  point: LatLng,
  areas: T[]
): T | null {
  let best: T | null = null;
  let bestArea = Infinity;
  for (const area of areas) {
    if (!Array.isArray(area.polygon) || area.polygon.length < 3) continue;
    if (!pointInPolygon(point, area.polygon)) continue;
    const size = polygonAreaSqM(area.polygon);
    if (size < bestArea) {
      best = area;
      bestArea = size;
    }
  }
  return best;
}

/** Metres between two coordinates (haversine). */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Ramer-Douglas-Peucker simplification, so a freehand lasso with 400 points
 * gets stored (and sent to Overpass) as a couple of dozen.
 */
export function simplify(points: LatLng[], toleranceDeg = 0.00004): LatLng[] {
  if (points.length < 3) return points;

  const sqDistToSegment = (p: LatLng, a: LatLng, b: LatLng) => {
    let [x, y] = [a[1], a[0]];
    let dx = b[1] - x;
    let dy = b[0] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[1] - x) * dx + (p[0] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = b[1];
        y = b[0];
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p[1] - x;
    dy = p[0] - y;
    return dx * dx + dy * dy;
  };

  const sqTol = toleranceDeg * toleranceDeg;
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxSq = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const sq = sqDistToSegment(points[i], points[first], points[last]);
      if (sq > maxSq) {
        maxSq = sq;
        index = i;
      }
    }
    if (maxSq > sqTol && index !== -1) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

export function formatArea(sqM: number): string {
  const acres = sqM / 4046.86;
  if (acres < 1) return `${Math.round(sqM).toLocaleString()} m²`;
  if (acres < 640) return `${acres.toFixed(1)} acres`;
  return `${(acres / 640).toFixed(2)} sq mi`;
}
