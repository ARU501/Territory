/**
 * The apartment buildings numbered on the printed 5212 territory map.
 *
 * Two of the eight are in OpenStreetMap and are placed exactly. The other six
 * are not in OSM under any spelling — checked against Overpass by name across
 * Davis County, and against Nominatim unbounded — so they are placed by fitting
 * the screenshot to the map's own printed street grid. Those carry
 * `estimated: true`, which puts a note on the building telling whoever opens it
 * to correct the pin with Move pin.
 *
 * The fit
 * -------
 * The screenshot is north-up at a single scale, so pixel to degree is linear
 * over this span. Two independent sources constrain it:
 *
 *   scale   from the map's printed grid lines. Overpass gives West 700 South at
 *           lat 41.10365 and Antelope Drive (which IS 1700 South here, and is
 *           labelled as both on the map) at lat 41.08920. Those two lines sit
 *           107-108 px apart in the screenshot, so 0.01445 deg over ~108.4 px.
 *
 *   origin  from marker 1, The Arlo, whose true position OSM knows. Anchoring
 *           on a confirmed building rather than on a guessed corner keeps the
 *           error centred on the cluster instead of accumulating across it.
 *
 * Accuracy: re-deriving marker 2 (Aria, also known) from this fit lands 83 m
 * from where OSM puts it. Treat every estimated pin as good to about 100-150 m
 * — the right block, possibly the wrong corner of it.
 */

/** The Arlo, from OSM way 1443762576, and its centre in the screenshot. */
const ANCHOR = { px: [580, 714], lat: 41.088314, lon: -112.058661 };

/** 0.01445 deg latitude across the 108.4 px between 700 South and 1700 South. */
const DEG_LAT_PER_PX = 0.000133;

/** Same ground distance per pixel, converted for longitude at latitude 41.09. */
const DEG_LON_PER_PX = 0.00017586;

const fromPixel = ([x, y]) => ({
  lat: Number((ANCHOR.lat - (y - ANCHOR.px[1]) * DEG_LAT_PER_PX).toFixed(6)),
  lng: Number((ANCHOR.lon + (x - ANCHOR.px[0]) * DEG_LON_PER_PX).toFixed(6)),
});

/** Confirmed against OpenStreetMap; no fitting involved. */
const exact = (lat, lng, osm) => ({ lat, lng, osm, estimated: false });

/** Read off the screenshot and run through the fit above. */
const traced = (px) => ({ ...fromPixel(px), px, estimated: true });

export const APARTMENTS = [
  { marker: 1, name: "The Arlo", ...exact(41.088314, -112.058661, "way/1443762576") },
  { marker: 2, name: "Aria", ...exact(41.088146, -112.052573, "relation/21192191") },
  { marker: 3, name: "Hunter's Cove", ...traced([556, 698]) },
  { marker: 4, name: "Syracuse West Apts", ...traced([556, 767]) },
  { marker: 5, name: "Melrose", ...traced([672, 717]), note: "On the territory line" },
  { marker: 6, name: "Sunset Park Villas", ...traced([670, 731]), note: "55+" },
  { marker: 7, name: "Raintree Assisted Living", ...traced([539, 731]) },
  { marker: 8, name: "BeeHive Homes", ...traced([549, 676]) },
];

export const ESTIMATED_NOTE =
  "Position estimated from the printed 5212 map — not in OpenStreetMap. " +
  "Tap Move pin and put it where the building really is.";
