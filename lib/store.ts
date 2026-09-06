"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTeamClient, fetchTeamToken, isCloudMode } from "./supabase";
import { slugifyTeam } from "./team";
import type { House, LatLng, Status, Territory } from "./types";

export type SyncState = "solo" | "connecting" | "live" | "error";

const soloKey = (team: string) => `doorknock:data:${slugifyTeam(team)}`;

interface SoloData {
  territories: Territory[];
  houses: House[];
}

function readSolo(team: string): SoloData {
  if (typeof window === "undefined") return { territories: [], houses: [] };
  try {
    const raw = window.localStorage.getItem(soloKey(team));
    if (!raw) return { territories: [], houses: [] };
    const parsed = JSON.parse(raw) as SoloData;
    return { territories: parsed.territories ?? [], houses: parsed.houses ?? [] };
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

  const persistSolo = useCallback(
    (next: Partial<SoloData>) => {
      if (isCloudMode) return;
      writeSolo(teamCode, { ...stateRef.current, ...next });
    },
    [teamCode]
  );

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
        client.from("territories").select("*").eq("team_code", teamCode),
        client.from("houses").select("*").eq("team_code", teamCode),
      ]);

      if (cancelled) return;

      if (t.error || h.error) {
        setError(
          (t.error ?? h.error)?.message ??
            "Could not load this team's data. Check the Supabase setup."
        );
        setSync("error");
        setLoading(false);
        return;
      }

      setTerritories((t.data ?? []) as Territory[]);
      setHouses((h.data ?? []) as House[]);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [teamCode, client]);

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
            setHouses((prev) => upsert(prev, payload.new as House));
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
      persistSolo({ territories: [...stateRef.current.territories, row] });

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
    [teamCode, rep, persistSolo]
  );

  const renameTerritory = useCallback(
    async (id: string, name: string) => {
      setTerritories((prev) => prev.map((t) => (t.id === id ? { ...t, name } : t)));
      persistSolo({
        territories: stateRef.current.territories.map((t) => (t.id === id ? { ...t, name } : t)),
      });
      const db = clientRef.current;
      if (db) {
        const { error: err } = await db.from("territories").update({ name }).eq("id", id);
        if (err) report(`Renaming that area did not save: ${err.message}`);
      }
    },
    [persistSolo, report]
  );

  const deleteTerritory = useCallback(
    async (id: string) => {
      const doomed = stateRef.current.territories.find((t) => t.id === id);
      const nextTerritories = stateRef.current.territories.filter((t) => t.id !== id);
      const nextHouses = stateRef.current.houses.filter((h) => h.territory_id !== id);
      setTerritories(nextTerritories);
      setHouses(nextHouses);
      persistSolo({ territories: nextTerritories, houses: nextHouses });

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
    [persistSolo, report]
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
      }));
      if (rows.length === 0) return [];

      setHouses((prev) => [...prev, ...rows]);
      persistSolo({ houses: [...stateRef.current.houses, ...rows] });

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
    [teamCode, rep, persistSolo]
  );

  const updateHouse = useCallback(
    async (id: string, patch: Partial<Pick<House, "status" | "notes" | "address">>) => {
      const full = { ...patch, updated_by: rep, updated_at: new Date().toISOString() };
      const apply = (list: House[]) => list.map((h) => (h.id === id ? { ...h, ...full } : h));
      setHouses(apply);
      persistSolo({ houses: apply(stateRef.current.houses) });

      const db = clientRef.current;
      if (db) {
        const { error: err } = await db.from("houses").update(full).eq("id", id);
        if (err) {
          const address =
            stateRef.current.houses.find((h) => h.id === id)?.address || "that house";
          report(`${address} did not save: ${err.message}. Mark it again when you have signal.`);
        }
      }
    },
    [rep, persistSolo, report]
  );

  const deleteHouse = useCallback(
    async (id: string) => {
      const doomed = stateRef.current.houses.find((h) => h.id === id);
      const next = stateRef.current.houses.filter((h) => h.id !== id);
      setHouses(next);
      persistSolo({ houses: next });

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
    [persistSolo, report]
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
    addTerritory,
    renameTerritory,
    deleteTerritory,
    addHouses,
    updateHouse,
    deleteHouse,
  };
}
