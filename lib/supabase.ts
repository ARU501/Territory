import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * False when the Supabase env vars are not set. The app detects that and runs in
 * solo mode (browser storage only) instead of crashing, so a fresh deploy is
 * usable before the database is wired up.
 */
export const isCloudMode = Boolean(url && anonKey);

/**
 * A client pinned to one team.
 *
 * The token is a signed JWT carrying a `team` claim, minted by /api/team-token.
 * Row-level security keys off that claim, so this client can only see and touch
 * rows belonging to its own team — the database enforces it, not the UI. The
 * token has to be handed to Realtime separately: it authorises over a websocket
 * and never sees the Authorization header set for REST calls.
 */
export function createTeamClient(token: string): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error("createTeamClient called without Supabase env vars configured.");
  }

  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });

  client.realtime.setAuth(token);
  return client;
}

export interface TeamCredentials {
  token: string;
  expiresAt: number;
}

/** Ask the server for a token scoping this browser to `team`. */
export async function fetchTeamToken(
  team: string,
  signal?: AbortSignal
): Promise<TeamCredentials> {
  const res = await fetch("/api/team-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ team }),
    signal,
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? `Could not get a team token (${res.status}).`);
  }

  return (await res.json()) as TeamCredentials;
}
