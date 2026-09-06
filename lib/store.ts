"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isCloudMode } from "./supabase";
import type { House, LatLng, Status, Territory } from "./types";

export type SyncState = "solo" | "connecting" | "live" | "error";

const soloKey = (team: string) => `doorknock:data:${team.toLowerCase()}`;

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

export function useCanvassData(team: string, rep: string) {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState<SyncState>(isCloudMode ? "connecting" : "solo");
  const [error, setError] = useState<string | null>(null);

  const teamCode = team.trim().toLowerCase();
  const stateRef = useRef<SoloData>({ territories: [], houses: [] });
  stateRef.current = { territories, houses };

  const persistSolo = useCallback(
    (next: Partial<SoloData>) => {
      if (isCloudMode) return;
      writeSolo(teamCode, { ...stateRef.current, ...next });
    },
    [teamCode]
  );

  // ---- initial load -------------------------------------------------------
  useEffect(() => {
    if (!teamCode) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      if (!supabase) {
        const data = readSolo(teamCode);
        if (cancelled) return;
        setTerritories(data.territories);
        setHouses(data.houses);
        setSync("solo");
        setLoading(false);
        return;
      }

      const [t, h] = await Promise.all([
        supabase.from("territories").select("*").eq("team_code", teamCode),
        supabase.from("houses").select("*").eq("team_code", teamCode),
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
  }, [teamCode]);

  // ---- live sync ----------------------------------------------------------
  useEffect(() => {
    if (!supabase || !teamCode) return;
    const client = supabase;

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
            const gone = payload.old as { id: string };
            setHouses((prev) => prev.filter((x) => x.id !== gone.id));
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
            const gone = payload.old as { id: string };
            setTerritories((prev) => prev.filter((x) => x.id !== gone.id));
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
  }, [teamCode]);

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

      if (supabase) {
        const { error: err } = await supabase.from("territories").insert(row);
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
      if (supabase) await supabase.from("territories").update({ name }).eq("id", id);
    },
    [persistSolo]
  );

  const deleteTerritory = useCallback(
    async (id: string) => {
      const nextTerritories = stateRef.current.territories.filter((t) => t.id !== id);
      const nextHouses = stateRef.current.houses.filter((h) => h.territory_id !== id);
      setTerritories(nextTerritories);
      setHouses(nextHouses);
      persistSolo({ territories: nextTerritories, houses: nextHouses });
      if (supabase) {
        await supabase.from("houses").delete().eq("territory_id", id);
        await supabase.from("territories").delete().eq("id", id);
      }
    },
    [persistSolo]
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

      if (supabase) {
        // Chunked so a big territory does not blow past the request size limit.
        for (let i = 0; i < rows.length; i += 500) {
          const { error: err } = await supabase.from("houses").insert(rows.slice(i, i + 500));
          if (err) throw new Error(err.message);
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
      if (supabase) await supabase.from("houses").update(full).eq("id", id);
    },
    [rep, persistSolo]
  );

  const deleteHouse = useCallback(
    async (id: string) => {
      const next = stateRef.current.houses.filter((h) => h.id !== id);
      setHouses(next);
      persistSolo({ houses: next });
      if (supabase) await supabase.from("houses").delete().eq("id", id);
    },
    [persistSolo]
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
