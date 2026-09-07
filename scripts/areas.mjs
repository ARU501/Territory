/**
 * Areas marked up on the printed 5212 territory maps.
 *
 * Each polygon is clockwise from the north-west, as [lat, lon].
 */

/**
 * The hand-drawn red box around Allison Acres / 2175 South.
 *
 * Traced from a Google Maps screenshot, so the corners are a fit rather than
 * exact: longitude from S 2000 W and S 1000 W, latitude from that scale times
 * cos(lat) anchored on W 2700 S. Antelope BMX, held out of the fit, lands
 * within ~90 m and the north edge within 26 m of Antelope Drive.
 */
export const ALLISON_ACRES = [
  [41.089357, -112.079379], // NW, on the railroad corridor
  [41.089114, -112.051992], // NE
  [41.080613, -112.053833], // SE
  [41.081481, -112.074086], // SW
];

/**
 * The "worked grid", written on the map as four street names:
 *
 *   North  W Antelope Dr      South  E 2200 S
 *   West   S Main St          East   N 2200 W
 *
 * Every corner here is a real OpenStreetMap street intersection, so unlike the
 * box above there is no fitting and no pixel guesswork.
 *
 * Note that Davis County has several unrelated roads named "Main Street".
 * The one meant is South Main Street at lon -112.0261; Antelope Drive also
 * crosses another "Main Street" near -112.0011, which is a different city's.
 */
export const WORKED_GRID = [
  [41.089215, -112.026149], // NW  Antelope Dr x S Main St
  [41.089132, -112.006934], // NE  Antelope Dr x N 2200 W
  [41.082248, -112.006978], // SE  E 2200 S    x N 2200 W
  [41.081908, -112.026169], // SW  E 2200 S    x S Main St
];

export const AREAS = {
  "allison-acres": {
    polygon: ALLISON_ACRES,
    name: "Off limits — Allison Acres / 2175 S",
    color: "#dc2626",
    status: "do_not_knock",
  },
  "worked-grid": {
    polygon: WORKED_GRID,
    name: "Worked grid — Antelope to 2200 S",
    color: "#dc2626",
    status: "do_not_knock",
  },
};
