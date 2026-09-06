import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Null when the Supabase env vars are not set. The app detects that and runs
 * in solo mode (browser storage only) instead of crashing, so a fresh deploy
 * is usable before the database is wired up.
 */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        realtime: { params: { eventsPerSecond: 5 } },
      })
    : null;

export const isCloudMode = supabase !== null;
