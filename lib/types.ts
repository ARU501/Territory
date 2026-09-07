export type LatLng = [number, number]; // [lat, lng]

export type Status =
  | "not_knocked"
  | "knocked"
  | "not_home"
  | "not_interested"
  | "interested";

export interface StatusMeta {
  id: Status;
  label: string;
  short: string;
  color: string;
  /** Counts toward "houses worked" in progress stats. */
  worked: boolean;
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
  { id: "not_knocked", label: "Not knocked yet", short: "New", color: "#94a3b8", worked: false },
];

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
