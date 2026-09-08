export type LatLng = [number, number]; // [lat, lng]

export type Status =
  | "not_knocked"
  | "knocked"
  | "not_home"
  | "not_interested"
  | "interested"
  | "do_not_knock";

export interface StatusMeta {
  id: Status;
  label: string;
  short: string;
  color: string;
  /** Counts toward "houses worked" in progress stats. */
  worked: boolean;
  /**
   * Taken out of the total altogether rather than counted as done.
   *
   * A house nobody is allowed to knock is not work outstanding and not work
   * completed — it is not work. Counting it either way lies: as outstanding, a
   * finished territory never reaches 100%; as completed, progress looks better
   * than it is. Removing it from the denominator makes 100% mean finished.
   */
  excluded?: boolean;
}

/**
 * Deliberately short — a rep standing at a door should not be reading a menu.
 *
 * Ordered by how often it gets tapped, not alphabetically or by sentiment:
 * most knocks end in nobody answering, so that sits under the thumb first.
 * "Not knocked" is last because it is the undo, not an outcome.
 *
 * Colours read as a traffic light so the map is legible at a glance: amber
 * come back, red no, green lead, blue spoke to them, grey untouched.
 *
 * Statuses removed from this list still degrade safely — every lookup falls
 * back to "not knocked" rather than crashing on an unrecognised value.
 */
export const STATUSES: StatusMeta[] = [
  { id: "not_home", label: "Not home", short: "Not home", color: "#f59e0b", worked: true },
  { id: "not_interested", label: "Not interested", short: "No", color: "#ef4444", worked: true },
  { id: "interested", label: "Interested", short: "Interested", color: "#22c55e", worked: true },
  { id: "knocked", label: "Knocked", short: "Knocked", color: "#3b82f6", worked: true },
  {
    id: "do_not_knock",
    label: "Do not knock",
    short: "Off limits",
    color: "#1f2937",
    worked: false,
    excluded: true,
  },
  { id: "not_knocked", label: "Not knocked yet", short: "New", color: "#94a3b8", worked: false },
];

/** Houses that should not be counted as work at all. */
export const isExcluded = (status: Status) => Boolean(STATUS_MAP[status]?.excluded);

export const STATUS_MAP: Record<Status, StatusMeta> = STATUSES.reduce(
  (acc, s) => ({ ...acc, [s.id]: s }),
  {} as Record<Status, StatusMeta>
);

export interface Territory {
  id: string;
  team_code: string;
  name: string;
  color: string;
  polygon: LatLng[];
  created_by: string;
  created_at: string;
}

/**
 * What a pin stands for.
 *
 * "house" is one front door. "complex" is an apartment building: a single pin
 * that stands in for many doors, carrying the building's name. "unit" is one of
 * those doors — units share their building's coordinates exactly, so they are
 * never drawn on the map, only listed inside it.
 */
export type HouseKind = "house" | "complex" | "unit";

/**
 * Rows written before apartments existed have no kind, and neither do rows
 * restored from an older copy of this device's offline mirror. Both are houses.
 */
export const kindOf = (kind: string | null | undefined): HouseKind =>
  kind === "complex" || kind === "unit" ? kind : "house";

export interface House {
  id: string;
  team_code: string;
  territory_id: string | null;
  lat: number;
  lng: number;
  address: string;
  status: Status;
  notes: string;
  updated_by: string;
  updated_at: string;
  kind: HouseKind;
  /** Set on a unit: the complex it belongs to. Null on everything else. */
  parent_id: string | null;
  /** The building's name. Only meaningful on a complex. */
  name: string;
}

/** The fields a rep can change on an existing pin. */
export type HousePatch = Partial<
  Pick<House, "status" | "notes" | "address" | "name" | "lat" | "lng">
>;

/**
 * Progress for one building, given its units.
 *
 * A building with no units yet is a single stop and reports its own status. One
 * with units is a container: the units are the doors, and the building's own
 * status is not counted anywhere.
 */
export interface ComplexProgress {
  units: number;
  total: number;
  worked: number;
  excluded: number;
}

export function complexProgress(units: House[]): ComplexProgress {
  let worked = 0;
  let excluded = 0;
  for (const u of units) {
    if (isExcluded(u.status)) excluded++;
    else if (STATUS_MAP[u.status]?.worked) worked++;
  }
  return { units: units.length, total: units.length - excluded, worked, excluded };
}

export const TERRITORY_COLORS = [
  "#2563eb",
  "#16a34a",
  "#ea580c",
  "#9333ea",
  "#0891b2",
  "#dc2626",
  "#ca8a04",
  "#db2777",
];
