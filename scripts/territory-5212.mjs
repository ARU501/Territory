/**
 * The Davis County UT 5212 territory (northern section only), traced from the
 * official boundary map.
 *
 * The five land corners are real OpenStreetMap street intersections, computed
 * by scripts/corners.mjs rather than eyeballed:
 *
 *   700 South    x 1000 West   41.103637, -112.045297
 *   Antelope Dr  x 1000 West   41.089170, -112.045307
 *   Antelope Dr  x 2200 West   41.089132, -112.006934
 *   Gentile St   x 2200 West   41.060155, -112.007077
 *   Gentile St   x 3200 West   41.060196, -112.026286
 *
 * The rest of the outline runs over the Great Salt Lake, where the official map
 * itself marks the boundary as an "imaginary line". Those points are traced
 * from the map and are approximate — which costs nothing, because no doors are
 * out there. The scale used to place them was checked against the known street
 * positions above and landed within ~30 m.
 *
 * Traced clockwise from the north-west.
 */
export const TERRITORY_5212 = [
  // North edge: 700 South, running east from the imaginary line over the lake.
  [41.10364, -112.14990],
  [41.10364, -112.04530], // 700 South x 1000 West

  // South on 1000 West to Antelope Drive.
  [41.08917, -112.04531], // Antelope Drive x 1000 West

  // East on Antelope Drive (1700 South) to 2200 West.
  [41.08913, -112.00693], // Antelope Drive x 2200 West

  // South on 2200 West to Gentile Street.
  [41.06016, -112.00708], // Gentile Street x 2200 West

  // West on Gentile Street to 3200 West.
  [41.06020, -112.02629], // Gentile Street x 3200 West

  // South on the 3200 West imaginary line, out into the lake.
  [40.98270, -112.02660],

  // West along the southern imaginary line.
  [40.98330, -112.05040],

  // North-west back up the Great Salt Lake shoreline.
  [40.98790, -112.05720],
  [40.99310, -112.06320],
  [40.99830, -112.07080],
  [41.00350, -112.07930],
  [41.01000, -112.08780],
  [41.01650, -112.09630],
  [41.02360, -112.10480],
  [41.03340, -112.11250],
  [41.04510, -112.11930],
  [41.05680, -112.12610],
  [41.06980, -112.13200],
  [41.08280, -112.13880],
  [41.09060, -112.14130],
];

export const TERRITORY_NAME = "Davis County UT 5212 (north)";

/** Overpass wants "lat lon lat lon ...". */
export function polyString(polygon = TERRITORY_5212) {
  return polygon.map(([lat, lon]) => `${lat.toFixed(6)} ${lon.toFixed(6)}`).join(" ");
}

if (process.argv[1] && process.argv[1].endsWith("territory-5212.mjs")) {
  const poly = polyString();
  console.log(`[out:json][timeout:180];
(
  node["addr:housenumber"](poly:"${poly}");
  way["addr:housenumber"](poly:"${poly}");
);
out center tags;`);
}
