export type LatLng = [number, number]; // [lat, lng]

export type Status =
  | "not_knocked"
  | "not_home"
  | "not_interested"
  | "interested"
  | "appointment"
  | "sold"
  | "do_not_knock";

export interface StatusMeta {
  id: Status;
  label: string;
  short: string;
  color: string;
  /** Counts toward "houses worked" in progress stats. */
  worked: boolean;
}

export const STATUSES: StatusMeta[] = [
  { id: "not_knocked", label: "Not knocked", short: "New", color: "#94a3b8", worked: false },
  { id: "not_home", label: "Not home", short: "N/H", color: "#f59e0b", worked: true },
  { id: "not_interested", label: "Not interested", short: "No", color: "#ef4444", worked: true },
  { id: "interested", label: "Interested", short: "Int", color: "#3b82f6", worked: true },
  { id: "appointment", label: "Appointment set", short: "Appt", color: "#a855f7", worked: true },
  { id: "sold", label: "Sold", short: "Sold", color: "#22c55e", worked: true },
  { id: "do_not_knock", label: "Do not knock", short: "DNK", color: "#1f2937", worked: true },
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
