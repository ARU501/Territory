"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTeamClient, fetchTeamToken, isCloudMode } from "./supabase";
import { slugifyTeam } from "./team";
import { kindOf } from "./types";
import type { House, HouseKind, HousePatch, LatLng, Status, Territory } from "./types";

export type SyncState = "solo" | "connecting" | "live" | "error";

const soloKey = (team: string) => `doorknock:data:${slugifyTeam(team)}`;
const pendingKey = (team: string) => `doorknock:pending:${slugifyTeam(team)}`;

interface SoloData {
  territories: Territory[];
  houses: House[];
}

/** A door mark that has not made it to the database yet. */
interface PendingWrite {
  id: string;
  patch: HousePatch & {
    updated_by: string;
    updated_at: string;
  };
}

/**
 * House rows arrive from three places — the server, this device's mirror, and a
 * realtime payload — and a mirror written before apartments existed has none of
 * the new columns. Filling them in at the three doors means the rest of the app
 * can trust `h.kind` outright instead of defending against undefined everywhere.
 */
function asHouse(row: House): House {
  return { ...row, kind: kindOf(row.kind), name: row.name ?? "" };
}

function readSolo(team: string): SoloData {
  if (typeof window === "undefined") return { territories: [], houses: [] };
  try {
    const raw = window.localStorage.getItem(soloKey(team));
    if (!raw) return { territories: [], houses: [] };
    const parsed = JSON.parse(raw) as SoloData;
    return {
      territories: parsed.territories ?? [],
      houses: (parsed.houses ?? []).map(asHouse),
    };
  } catch {
    return { territories: [], houses: [] };
  }
}

function writeSolo(team: string, data: SoloData) {
  try {
    window.localStorage.setItem(soloKey(team), JSON.stringify(data));
  } catch {
    /* storage full or blocked - the in-memory state still works this session */
  }
}

function readPending(team: string): PendingWrite[] {
  if (typeof window === "undefined") return [];
  try {
    return (JSON.parse(window.localStorage.getItem(pendingKey(team)) ?? "[]") ??
      []) as PendingWrite[];
  } catch {
    return [];
  }
}

function writePending(team: string, queue: PendingWrite[]) {
  try {
    if (queue.length === 0) window.localStorage.removeItem(pendingKey(team));
    else window.localStorage.setItem(pendingKey(team), JSON.stringify(queue));
  } catch {
    /* nothing more we can do; the mark is still on screen */
  }
}

/** Later marks on the same door supersede earlier ones. */
function queueWrite(team: string, write: PendingWrite): number {
  const queue = readPending(team).filter((p) => p.id !== write.id);
  queue.push(write);
  writePending(team, queue);
  return queue.length;
}

/**
 * Reads an entire team's table, a page at a time.
 *
 * Supabase caps rows per request (1000 by default) and does NOT report the cap
 * as an error — the query simply returns fewer rows than exist. A crew with
 * seven or eight loaded blocks passes 1000 houses easily, and without paging
 * the extras just vanish off the map with nothing on screen to explain it.
 */
const PAGE_SIZE = 1000;

async function fetchAllForTeam<T>(
  client: SupabaseClient,
  table: "territories" | "houses",
  teamCode: string
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .eq("team_code", teamCode)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return { rows, error: error.message };
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE_SIZE) return { rows, error: null };
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export interface NewTerritory {
  name: string;
  color: string;
  polygon: LatLng[];
}

export interface NewHouse {
  territory_id: string | null;
  lat: number;
  lng: number;
  address: string;
  status?: Status;
  kind?: HouseKind;
  /** A building name, for complexes. */
  name?: string;
}

export function useCanvassData(
  team: string,
  rep: string,
  onWriteError?: (message: string) => void
) {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState<SyncState>(isCloudMode ? "connecting" : "solo");
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  // The client is pinned to one team by a signed token, so it is rebuilt
  // whenever the team changes rather than living as a module singleton.
  const [client, setClient] = useState<SupabaseClient | null>(null);

  const teamCode = slugifyTeam(team);
  const stateRef = useRef<SoloData>({ territories: [], houses: [] });
  const clientRef = useRef<SupabaseClient | null>(null);
  const errorSinkRef = useRef(onWriteError);

  stateRef.current = { territories, houses };
  clientRef.current = client;
  errorSinkRef.current = onWriteError;

  const report = useCallback((message: string) => {
    errorSinkRef.current?.(message);
  }, []);

  /**
   * Mirrors the dataset to this device in BOTH modes.
   *
   * In cloud mode the database is the source of truth, but it is not the only
   * copy that matters: a rep working a basement-level street can have writes
   * fail for an hour, and if the browser evicts the tab before they land the
   * work is gone. The mirror plus the pending queue below mean a reload shows
   * what they actually marked, not what the server last heard about.
   *
   * Debounced, because a real territory is large. The Davis County 5212 import
   * is 11,817 houses, about 2.7 MB of JSON; serialising that synchronously on
   * every tap would stutter the map on a phone. The pending-write queue is
   * written immediately and separately, so nothing is at risk in the gap.
   */
  const mirrorTimer = useRef<number | null>(null);
  const persistLocal = useCallback(
    (next: Partial<SoloData>) => {
      const snapshot = { ...stateRef.current, ...next };
      if (mirrorTimer.current !== null) window.clearTimeout(mirrorTimer.current);
      mirrorTimer.current = window.setTimeout(() => {
        mirrorTimer.current = null;
        writeSolo(teamCode, snapshot);
      }, 1200);
    },
    [teamCode]
  );

  // The load effect must not list persistLocal as a dependency, or changing the
  // team would re-run the fetch twice; a ref keeps it current without that.
  const persistLocalRef = useRef(persistLocal);
  persistLocalRef.current = persistLocal;

  // Backgrounding the app must not drop a mirror write that is still pending.
  useEffect(() => {
    const flush = () => {
      if (mirrorTimer.current === null) return;
      window.clearTimeout(mirrorTimer.current);
      mirrorTimer.current = null;
      writeSolo(teamCode, stateRef.current);
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      flush();
    };
  }, [teamCode]);

  // ---- token + client -----------------------------------------------------
  useEffect(() => {
    if (!isCloudMode || !teamCode) {
      setClient(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    setSync("connecting");
    fetchTeamToken(teamCode, controller.signal)
      .then(({ token }) => {
        if (cancelled) return;
        setClient(createTeamClient(token));
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        setError(
          err instanceof Error
            ? `Could not start a session for this team: ${err.message}`
            : "Could not start a session for this team."
        );
        setSync("error");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [teamCode]);

  // ---- initial load -------------------------------------------------------
  useEffect(() => {
    if (!teamCode) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      if (!isCloudMode) {
        const data = readSolo(teamCode);
        if (cancelled) return;
        setTerritories(data.territories);
        setHouses(data.houses);
        setSync("solo");
        setLoading(false);
        return;
      }

      if (!client) return; // waiting on the team token

      const [t, h] = await Promise.all([
        fetchAllForTeam<Territory>(client, "territories", teamCode),
        fetchAllForTeam<House>(client, "houses", teamCode),
      ]);

      if (cancelled) return;

      if (t.error || h.error) {
        setError(
          t.error ?? h.error ?? "Could not load this team's data. Check the Supabase setup."
        );
        setSync("error");
        setLoading(false);
        return;
      }

      // Marks that never reached the server outrank what the server returned,
      // or a reload would quietly undo the rep's last stretch of work.
      const queued = readPending(teamCode);
      const byId = new Map(queued.map((p) => [p.id, p]));
      const serverHouses = h.rows.map((raw) => {
        const row = asHouse(raw);
        return byId.has(row.id) ? { ...row, ...byId.get(row.id)!.patch } : row;
      });

      setTerritories(t.rows);
      setHouses(serverHouses);
      setPendingCount(queued.length);
      setLoading(false);

      // Mirror what we just fetched. Without this the mirror only fills once a
      // rep marks something, so every cold open re-downloads the whole
      // territory — twelve paged requests and about twenty seconds of blank
      // map on a phone. Debounced, so it costs one write shortly after load.
      persistLocalRef.current({ territories: t.rows, houses: serverHouses });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [teamCode, client]);

  // Paint from this device's mirror straight away, so opening the app on a bad
  // connection shows last night's territory instead of an empty map.
  useEffect(() => {
    if (!teamCode || !isCloudMode) return;
    const cached = readSolo(teamCode);
    if (cached.territories.length || cached.houses.length) {
      setTerritories(cached.territories);
      setHouses(cached.houses);
    }
    setPendingCount(readPending(teamCode).length);
  }, [teamCode]);

  // ---- retry unsaved marks ------------------------------------------------
  useEffect(() => {
    if (!client || !teamCode) return;
    let stopped = false;

    const drain = async () => {
      if (stopped) return;
      const queue = readPending(teamCode);
      if (queue.length === 0) return;

      const stillFailing: PendingWrite[] = [];
      for (const item of queue) {
        const { error: err } = await client.from("houses").update(item.patch).eq("id", item.id);
        if (err) stillFailing.push(item);
      }
      if (stopped) return;

      writePending(teamCode, stillFailing);
      setPendingCount(stillFailing.length);
      if (stillFailing.length < queue.length && stillFailing.length === 0) {
        report(`Saved ${queue.length} mark${queue.length === 1 ? "" : "s"} that had not gone through.`);
      }
    };

    drain();
    const timer = setInterval(drain, 15000);
    window.addEventListener("online", drain);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("online", drain);
    };
  }, [client, teamCode, report]);

  // ---- live sync ----------------------------------------------------------
  useEffect(() => {
    if (!client || !teamCode) return;

    const upsert = <T extends { id: string }>(list: T[], row: T) => {
      const idx = list.findIndex((x) => x.id === row.id);
      if (idx === -1) return [...list, row];
      const copy = list.slice();
      copy[idx] = row;
      return copy;
    };

    const channel = client
      .channel(`team:${teamCode}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "houses", filter: `team_code=eq.${teamCode}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const gone = payload.old as { id?: string };
            if (gone?.id) setHouses((prev) => prev.filter((x) => x.id !== gone.id));
          } else {
            setHouses((prev) => upsert(prev, asHouse(payload.new as House)));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "territories", filter: `team_code=eq.${teamCode}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const gone = payload.old as { id?: string };
            if (gone?.id) setTerritories((prev) => prev.filter((x) => x.id !== gone.id));
          } else {
            setTerritories((prev) => upsert(prev, payload.new as Territory));
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setSync("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setSync("error");
      });

    return () => {
      client.removeChannel(channel);
    };
  }, [client, teamCode]);

  // ---- cross-tab sync in solo mode ---------------------------------------
  useEffect(() => {
    if (isCloudMode || !teamCode) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== soloKey(teamCode)) return;
      const data = readSolo(teamCode);
      setTerritories(data.territories);
      setHouses(data.houses);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [teamCode]);

  // ---- mutations ----------------------------------------------------------
  const addTerritory = useCallback(
    async (input: NewTerritory): Promise<Territory> => {
      const row: Territory = {
        id: newId(),
        team_code: teamCode,
        name: input.name,
        color: input.color,
        polygon: input.polygon,
        created_by: rep,
        created_at: new Date().toISOString(),
      };
      setTerritories((prev) => [...prev, row]);
      persistLocal({ territories: [...stateRef.current.territories, row] });

      const db = clientRef.current;
      if (isCloudMode) {
        if (!db) {
          setTerritories((prev) => prev.filter((t) => t.id !== row.id));
          throw new Error("Still connecting to the team database. Try again in a moment.");
        }
        const { error: err } = await db.from("territories").insert(row);
        if (err) {
          setTerritories((prev) => prev.filter((t) => t.id !== row.id));
          throw new Error(err.message);
        }
      }
      return row;
    },
    [teamCode, rep, persistLocal]
  );

  const renameTerritory = useCallback(
    async (id: string, name: string) => {
      setTerritories((prev) => prev.map((t) => (t.id === id ? { ...t, name } : t)));
      persistLocal({
        territories: stateRef.current.territories.map((t) => (t.id === id ? { ...t, name } : t)),
      });
      const db = clientRef.current;
      if (db) {
        const { error: err } = await db.from("territories").update({ name }).eq("id", id);
        if (err) report(`Renaming that area did not save: ${err.message}`);
      }
    },
    [persistLocal, report]
  );

  const deleteTerritory = useCallback(
    async (id: string) => {
      const doomed = stateRef.current.territories.find((t) => t.id === id);
      const nextTerritories = stateRef.current.territories.filter((t) => t.id !== id);
      const nextHouses = stateRef.current.houses.filter((h) => h.territory_id !== id);
      setTerritories(nextTerritories);
      setHouses(nextHouses);
      persistLocal({ territories: nextTerritories, houses: nextHouses });

      const db = clientRef.current;
      if (db) {
        // The foreign key cascades, but deleting the houses first keeps the
        // realtime events explicit so teammates drop the pins immediately.
        const houseDelete = await db.from("houses").delete().eq("territory_id", id);
        const terrDelete = await db.from("territories").delete().eq("id", id);
        const err = houseDelete.error ?? terrDelete.error;
        if (err) {
          report(
            `Deleting ${doomed?.name ?? "that area"} did not save: ${err.message}. It will come back on reload.`
          );
        }
      }
    },
    [persistLocal, report]
  );

  const addHouses = useCallback(
    async (input: NewHouse[]): Promise<House[]> => {
      const now = new Date().toISOString();
      const rows: House[] = input.map((h) => ({
        id: newId(),
        team_code: teamCode,
        territory_id: h.territory_id,
        lat: h.lat,
        lng: h.lng,
        address: h.address,
        status: h.status ?? "not_knocked",
        notes: "",
        updated_by: rep,
        updated_at: now,
        kind: h.kind ?? "house",
        name: h.name ?? "",
      }));
      if (rows.length === 0) return [];

      setHouses((prev) => [...prev, ...rows]);
      persistLocal({ houses: [...stateRef.current.houses, ...rows] });

      const db = clientRef.current;
      if (isCloudMode) {
        if (!db) {
          setHouses((prev) => prev.filter((h) => !rows.some((r) => r.id === h.id)));
          throw new Error("Still connecting to the team database. Try again in a moment.");
        }
        // Chunked so a big territory does not blow past the request size limit.
        let saved = 0;
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          const { error: err } = await db.from("houses").insert(chunk);
          if (err) {
            // Roll the unsaved tail back out of local state so the map matches
            // the database instead of showing pins nobody else can see.
            const unsaved = new Set(rows.slice(saved).map((r) => r.id));
            setHouses((prev) => prev.filter((h) => !unsaved.has(h.id)));
            throw new Error(
              saved > 0
                ? `Saved ${saved} of ${rows.length} houses, then failed: ${err.message}`
                : err.message
            );
          }
          saved += chunk.length;
        }
      }
      return rows;
    },
    [teamCode, rep, persistLocal]
  );

  const updateHouse = useCallback(
    async (id: string, patch: HousePatch) => {
      const full = { ...patch, updated_by: rep, updated_at: new Date().toISOString() };
      const apply = (list: House[]) => list.map((h) => (h.id === id ? { ...h, ...full } : h));
      setHouses(apply);
      persistLocal({ houses: apply(stateRef.current.houses) });

      const db = clientRef.current;
      if (isCloudMode) {
        // No client yet, or the write failed: keep it on disk and retry rather
        // than letting the mark exist only in a tab that may be evicted.
        if (!db) {
          setPendingCount(queueWrite(teamCode, { id, patch: full }));
          return;
        }
        const { error: err } = await db.from("houses").update(full).eq("id", id);
        if (err) {
          const count = queueWrite(teamCode, { id, patch: full });
          setPendingCount(count);
          const address =
            stateRef.current.houses.find((h) => h.id === id)?.address || "that house";
          report(`${address} has not saved yet — kept on this phone and retrying.`);
        }
      }
    },
    [rep, teamCode, persistLocal, report]
  );

  const deleteHouse = useCallback(
    async (id: string) => {
      const doomed = stateRef.current.houses.find((h) => h.id === id);
      const next = stateRef.current.houses.filter((h) => h.id !== id);
      setHouses(next);
      persistLocal({ houses: next });

      // Drop any queued mark for a house that is being removed.
      const queue = readPending(teamCode).filter((p) => p.id !== id);
      writePending(teamCode, queue);
      setPendingCount(queue.length);

      const db = clientRef.current;
      if (db) {
        const { error: err } = await db.from("houses").delete().eq("id", id);
        if (err) {
          report(
            `Deleting ${doomed?.address ?? "that house"} did not save: ${err.message}. It will come back on reload.`
          );
        }
      }
    },
    [teamCode, persistLocal, report]
  );

  const housesByTerritory = useMemo(() => {
    const map = new Map<string, House[]>();
    for (const h of houses) {
      const key = h.territory_id ?? "__loose__";
      const list = map.get(key);
      if (list) list.push(h);
      else map.set(key, [h]);
    }
    return map;
  }, [houses]);

  return {
    territories,
    houses,
    housesByTerritory,
    loading,
    sync,
    error,
    pendingCount,
    addTerritory,
    renameTerritory,
    deleteTerritory,
    addHouses,
    updateHouse,
    deleteHouse,
  };
}
