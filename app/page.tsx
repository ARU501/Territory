"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import Gate from "@/components/Gate";
import HouseSheet from "@/components/HouseSheet";
import SaveTerritorySheet from "@/components/SaveTerritorySheet";
import TerritorySheet from "@/components/TerritorySheet";
import LocationSheet, { type LocationSheetMode } from "@/components/LocationSheet";
import {
  IconCheck,
  IconDoor,
  IconLasso,
  IconLayers,
  IconList,
  IconCrosshair,
  IconPlus,
  IconUndo,
  IconX,
} from "@/components/Icons";
import type { Basemap, MapHandle, MapMode } from "@/components/MapView";

import { useCanvassData } from "@/lib/store";
import { useWakeLock } from "@/lib/useWakeLock";
import {
  clearDenied,
  getPermissionState,
  hasBeenAsked,
  rememberAsked,
  rememberDenied,
  wasDenied,
} from "@/lib/geolocation";
import { isCloudMode } from "@/lib/supabase";
import { distanceM, pointInPolygon, simplify } from "@/lib/geo";
import { fetchHousesInPolygon } from "@/lib/overpass";
import {
  STATUSES,
  STATUS_MAP,
  TERRITORY_COLORS,
  isExcluded,
  type LatLng,
  type Status,
  type Territory,
} from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="map-canvas" />,
});

interface Toast {
  id: number;
  text: string;
  kind: "info" | "ok" | "err";
}

const TEAM_KEY = "doorknock:team";
const REP_KEY = "doorknock:rep";
const BASEMAP_KEY = "doorknock:basemap";
const ACTIVE_KEY = "doorknock:active";

/** A new pin this close to an existing one is treated as the same house. */
const DEDUPE_RADIUS_M = 8;

export default function Page() {
  const [ready, setReady] = useState(false);
  const [team, setTeam] = useState("");
  const [rep, setRep] = useState("");
  const [showGate, setShowGate] = useState(false);

  const [mode, setMode] = useState<MapMode>("idle");
  const [basemap, setBasemap] = useState<Basemap>("street");
  const [drawCount, setDrawCount] = useState(0);
  const [pendingPolygon, setPendingPolygon] = useState<LatLng[] | null>(null);

  const [activeTerritoryId, setActiveTerritoryId] = useState<string | null>(null);
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);
  const [showTerritories, setShowTerritories] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [locationSheet, setLocationSheet] = useState<LocationSheetMode | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const mapRef = useRef<MapHandle | null>(null);
  const toastSeq = useRef(0);

  const pushToast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { id, text, kind }]);
    // A failed write is worth reading twice; a confirmation is not.
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), kind === "err" ? 9000 : 5200);
  }, []);

  // Writes that fail on a patchy connection used to vanish silently.
  const reportWriteError = useCallback((message: string) => pushToast(message, "err"), [pushToast]);

  const data = useCanvassData(team, rep, reportWriteError);

  // Keep the screen on while a rep is actually working a territory, so they are
  // not unlocking the phone between every door.
  useWakeLock(Boolean(team && rep && !showGate));

  // ---- restore session ----------------------------------------------------
  useEffect(() => {
    // Accessing localStorage throws outright when site data is blocked (Safari
    // private mode, locked-down enterprise phones). Unguarded, that leaves the
    // rep staring at a permanently blank screen with no way forward.
    let savedTeam = "";
    let savedRep = "";
    try {
      savedTeam = localStorage.getItem(TEAM_KEY) ?? "";
      savedRep = localStorage.getItem(REP_KEY) ?? "";
      const savedBasemap = localStorage.getItem(BASEMAP_KEY) as Basemap | null;
      if (savedBasemap === "satellite" || savedBasemap === "street") setBasemap(savedBasemap);
      setActiveTerritoryId(localStorage.getItem(ACTIVE_KEY));
    } catch {
      /* no stored session available; fall through to the gate */
    }

    if (savedTeam && savedRep) {
      setTeam(savedTeam);
      setRep(savedRep);
    } else {
      setShowGate(true);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (data.error) pushToast(data.error, "err");
  }, [data.error, pushToast]);

  // Keep the working territory across reloads, and drop it if a teammate
  // deleted the area while this device was away.
  useEffect(() => {
    if (!ready) return;
    try {
      if (activeTerritoryId) localStorage.setItem(ACTIVE_KEY, activeTerritoryId);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* preference simply will not stick */
    }
  }, [ready, activeTerritoryId]);

  useEffect(() => {
    if (data.loading || !activeTerritoryId) return;
    if (!data.territories.some((t) => t.id === activeTerritoryId)) setActiveTerritoryId(null);
  }, [data.loading, data.territories, activeTerritoryId]);

  const enter = useCallback((nextTeam: string, nextRep: string) => {
    try {
      localStorage.setItem(TEAM_KEY, nextTeam);
      localStorage.setItem(REP_KEY, nextRep);
    } catch {
      /* the session just will not survive a reload on this device */
    }
    setTeam(nextTeam);
    setRep(nextRep);
    setShowGate(false);
    setActiveTerritoryId(null);
    setSelectedHouseId(null);
  }, []);

  /**
   * Tapping Find me asks the browser what it already knows before doing
   * anything. If location was refused, the native dialog will never appear
   * again, so showing recovery steps is the only useful response. If it has
   * never been asked, explain why first — a prompt that arrives unexplained is
   * the reason people decline in the first place.
   */
  const handleLocate = useCallback(async () => {
    const state = await getPermissionState();

    // Granted is the one answer every browser reports honestly.
    if (state === "granted") {
      clearDenied();
      mapRef.current?.locate();
      return;
    }

    // Our own record of a real refusal outranks the API, because iOS Safari
    // reports "prompt" even when the site is set to Deny.
    if (state === "denied" || wasDenied()) {
      setLocationSheet("blocked");
      return;
    }

    // Never asked on this device: explain before the dialog appears.
    if (!hasBeenAsked()) {
      setLocationSheet("explain");
      return;
    }

    // Asked before, no refusal recorded — just try. If it was in fact refused,
    // the error path records it and shows the recovery steps.
    mapRef.current?.locate();
  }, []);

  const toggleBasemap = useCallback(() => {
    setBasemap((prev) => {
      const next = prev === "street" ? "satellite" : "street";
      try {
        localStorage.setItem(BASEMAP_KEY, next);
      } catch {
        /* preference simply will not stick */
      }
      return next;
    });
  }, []);

  // ---- derived ------------------------------------------------------------
  const territoryById = useMemo(() => {
    const map = new Map<string, Territory>();
    for (const t of data.territories) map.set(t.id, t);
    return map;
  }, [data.territories]);

  const statsFor = useCallback(
    (id: string) => {
      const list = data.housesByTerritory.get(id) ?? [];
      let worked = 0;
      let excluded = 0;
      for (const h of list) {
        if (isExcluded(h.status)) excluded++;
        else if (STATUS_MAP[h.status]?.worked) worked++;
      }
      // Off-limits doors leave the denominator entirely, so a finished
      // territory actually reaches 100%.
      return { total: list.length - excluded, worked, excluded };
    },
    [data.housesByTerritory]
  );

  const activeTerritory = activeTerritoryId ? territoryById.get(activeTerritoryId) ?? null : null;

  const activeBreakdown = useMemo(() => {
    if (!activeTerritoryId) return null;
    const list = data.housesByTerritory.get(activeTerritoryId) ?? [];
    const counts = new Map<Status, number>();
    for (const h of list) counts.set(h.status, (counts.get(h.status) ?? 0) + 1);
    const worked = STATUSES.filter((s) => s.worked).reduce(
      (sum, s) => sum + (counts.get(s.id) ?? 0),
      0
    );
    const excluded = STATUSES.filter((s) => s.excluded).reduce(
      (sum, s) => sum + (counts.get(s.id) ?? 0),
      0
    );
    return { counts, worked, excluded, total: list.length - excluded };
  }, [activeTerritoryId, data.housesByTerritory]);

  const selectedHouse = useMemo(
    () => data.houses.find((h) => h.id === selectedHouseId) ?? null,
    [data.houses, selectedHouseId]
  );

  // ---- address loading ----------------------------------------------------
  const loadAddresses = useCallback(
    async (territory: Territory) => {
      setBusy(`Finding houses in ${territory.name}…`);
      try {
        const { houses: found, usedFallback } = await fetchHousesInPolygon(territory.polygon);

        const existing = data.houses.filter(
          (h) => h.territory_id === territory.id || pointInPolygon([h.lat, h.lng], territory.polygon)
        );
        const fresh = found.filter(
          (f) => !existing.some((h) => distanceM([h.lat, h.lng], [f.lat, f.lng]) < DEDUPE_RADIUS_M)
        );

        if (fresh.length === 0) {
          pushToast(
            found.length === 0
              ? "OpenStreetMap has no mapped buildings in that area. Tap the + button to drop houses by hand."
              : "Every house OpenStreetMap knows about here is already on your map.",
            "info"
          );
          return;
        }

        await data.addHouses(
          fresh.map((f) => ({
            territory_id: territory.id,
            lat: f.lat,
            lng: f.lng,
            address: f.address,
          }))
        );

        pushToast(
          `Loaded ${fresh.length} house${fresh.length === 1 ? "" : "s"} into ${territory.name}.` +
            (usedFallback
              ? " Some had no street address on file, so they show as dropped pins."
              : ""),
          "ok"
        );
      } catch (err) {
        pushToast(
          err instanceof Error
            ? `Could not load addresses: ${err.message}`
            : "Could not load addresses right now.",
          "err"
        );
      } finally {
        setBusy(null);
      }
    },
    [data, pushToast]
  );

  // ---- drawing ------------------------------------------------------------
  const startDrawing = useCallback(() => {
    mapRef.current?.clearDrawing();
    setDrawCount(0);
    setSelectedHouseId(null);
    setMode("draw");
  }, []);

  const cancelDrawing = useCallback(() => {
    mapRef.current?.clearDrawing();
    setDrawCount(0);
    setMode("idle");
    setPendingPolygon(null);
  }, []);

  const finishDrawing = useCallback(() => {
    const raw = mapRef.current?.getDrawPoints() ?? [];
    if (raw.length < 3) {
      pushToast("Trace at least three points to close an area.", "err");
      return;
    }
    setPendingPolygon(simplify(raw));
    setMode("idle");
  }, [pushToast]);

  const saveTerritory = useCallback(
    async (name: string, color: string, autoLoad: boolean) => {
      if (!pendingPolygon) return;
      const polygon = pendingPolygon;
      setPendingPolygon(null);
      mapRef.current?.clearDrawing();
      setDrawCount(0);

      try {
        const territory = await data.addTerritory({ name, color, polygon });
        setActiveTerritoryId(territory.id);
        mapRef.current?.fitPolygon(polygon);
        if (autoLoad) await loadAddresses(territory);
        else pushToast(`${name} saved. Use the + button to drop houses as you walk.`, "ok");
      } catch (err) {
        pushToast(
          err instanceof Error ? `Could not save: ${err.message}` : "Could not save that area.",
          "err"
        );
      }
    },
    [pendingPolygon, data, loadAddresses, pushToast]
  );

  // ---- house interactions -------------------------------------------------
  const handleMapTap = useCallback(
    async (point: LatLng) => {
      const containing =
        data.territories.find((t) => pointInPolygon(point, t.polygon)) ??
        (activeTerritory && pointInPolygon(point, activeTerritory.polygon) ? activeTerritory : null);

      const near = data.houses.find((h) => distanceM([h.lat, h.lng], point) < DEDUPE_RADIUS_M);
      if (near) {
        setSelectedHouseId(near.id);
        setMode("idle");
        return;
      }

      try {
        const [created] = await data.addHouses([
          { territory_id: containing?.id ?? null, lat: point[0], lng: point[1], address: "" },
        ]);
        if (created) setSelectedHouseId(created.id);
        setMode("idle");
      } catch (err) {
        pushToast(
          err instanceof Error ? `Could not add that house: ${err.message}` : "Could not add that house.",
          "err"
        );
      }
    },
    [data, activeTerritory, pushToast]
  );

  const setStatus = useCallback(
    (status: Status) => {
      if (!selectedHouse) return;
      data.updateHouse(selectedHouse.id, { status });
    },
    [selectedHouse, data]
  );

  // ---- export -------------------------------------------------------------
  const exportCsv = useCallback(() => {
    const escape = (value: string) => `"${(value ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Territory", "Address", "Status", "Notes", "Updated by", "Updated at", "Latitude", "Longitude"],
      ...data.houses.map((h) => [
        territoryById.get(h.territory_id ?? "")?.name ?? "",
        h.address,
        STATUS_MAP[h.status]?.label ?? h.status,
        h.notes ?? "",
        h.updated_by ?? "",
        h.updated_at ?? "",
        String(h.lat),
        String(h.lng),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => escape(String(c))).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `doorknock-${team}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, [data.houses, territoryById, team]);

  // ---- render -------------------------------------------------------------
  if (!ready) return <div className="app" />;

  if (showGate || !team || !rep) {
    return <Gate initialTeam={team} initialRep={rep} onEnter={enter} />;
  }

  const syncLabel =
    data.sync === "live"
      ? "Live"
      : data.sync === "solo"
        ? "This device"
        : data.sync === "error"
          ? "Offline"
          : "Connecting";

  const nextColor = TERRITORY_COLORS[data.territories.length % TERRITORY_COLORS.length];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <IconDoor size={15} />
          </span>
          <span className="brand-text">DoorKnock</span>
        </div>
        <div className="topbar-spacer" />
        {data.loading && isCloudMode && (
          <span className="chip" title="Fetching this team's territories and doors">
            <span className="spinner chip-spinner" />
            Loading
          </span>
        )}
        {data.pendingCount > 0 && (
          <span
            className="chip chip-warn"
            title="Marks saved on this phone that have not reached the team yet. They retry automatically."
          >
            {data.pendingCount} unsaved
          </span>
        )}
        <span className="chip" title={isCloudMode ? "Team sync" : "No database connected"}>
          <span className={`dot dot-${data.sync}`} />
          {syncLabel}
        </span>
        <button
          className="chip chip-team"
          onClick={() => setShowGate(true)}
          title={`${rep} on team ${team} — tap to switch`}
        >
          {rep} · {team}
        </button>
      </header>

      <div className="map-wrap">
        <MapView
          handleRef={mapRef}
          mode={mode}
          basemap={basemap}
          territories={data.territories}
          houses={data.houses}
          activeTerritoryId={activeTerritoryId}
          selectedHouseId={selectedHouseId}
          onDrawProgress={setDrawCount}
          onHouseClick={(h) => setSelectedHouseId(h.id)}
          onMapTap={handleMapTap}
          onTerritoryClick={(id) => setActiveTerritoryId(id)}
          onLocationError={(kind, message) => {
            // A real refusal is the only trustworthy signal on iOS, so record
            // it; a refusal needs instructions, not a toast that scrolls away.
            if (kind === "denied") {
              rememberDenied();
              setLocationSheet("blocked");
            } else {
              pushToast(message, "err");
            }
          }}
          onLocationFound={clearDenied}
        />

        {/* active territory summary */}
        {mode === "idle" && activeTerritory && activeBreakdown && (
          <div className="map-top-left">
            <div className="card terr-card">
              <div className="terr-card-head">
                <span className="swatch" style={{ background: activeTerritory.color }} />
                <span className="terr-name">{activeTerritory.name}</span>
                <button
                  onClick={() => setActiveTerritoryId(null)}
                  aria-label="Clear the selected territory"
                  style={{ marginLeft: "auto", color: "var(--muted)", display: "flex" }}
                >
                  <IconX size={15} />
                </button>
              </div>
              <div className="terr-sub">
                {activeBreakdown.total === 0 && activeBreakdown.excluded > 0
                  ? `${activeBreakdown.excluded} doors · off limits`
                  : activeBreakdown.total === 0
                    ? "No houses loaded yet"
                    : `${activeBreakdown.worked} of ${activeBreakdown.total} doors worked` +
                      (activeBreakdown.excluded > 0
                        ? ` · ${activeBreakdown.excluded} off limits`
                        : "")}
              </div>
              {activeBreakdown.total > 0 && (
                <>
                  <div className="progress">
                    {STATUSES.filter((s) => s.worked).map((s) => {
                      const n = activeBreakdown.counts.get(s.id) ?? 0;
                      if (n === 0) return null;
                      return (
                        <span
                          key={s.id}
                          style={{
                            width: `${(n / activeBreakdown.total) * 100}%`,
                            background: s.color,
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="legend">
                    {STATUSES.map((s) => {
                      const n = activeBreakdown.counts.get(s.id) ?? 0;
                      if (n === 0) return null;
                      return (
                        <span className="legend-item" key={s.id}>
                          <span className="legend-swatch" style={{ background: s.color }} />
                          {s.short} {n}
                        </span>
                      );
                    })}
                  </div>
                </>
              )}
              {activeBreakdown.total === 0 && (
                <button
                  className="btn btn-quiet btn-block"
                  style={{ marginTop: 10 }}
                  onClick={() => loadAddresses(activeTerritory)}
                >
                  Load addresses here
                </button>
              )}
            </div>
          </div>
        )}

        {/* right-hand controls */}
        {mode !== "draw" && (
          <div className="map-controls">
            <button
              className={`fab${mode === "add" ? " is-on" : ""}`}
              onClick={() => setMode(mode === "add" ? "idle" : "add")}
              title={mode === "add" ? "Cancel adding" : "Tap the map to add a house"}
              aria-label="Add a house by tapping the map"
            >
              {mode === "add" ? <IconX size={20} /> : <IconPlus />}
            </button>
            <button
              className="fab"
              onClick={toggleBasemap}
              title={basemap === "street" ? "Switch to satellite" : "Switch to street map"}
              aria-label="Switch base map"
            >
              <IconLayers />
            </button>
            <button
              className="fab"
              onClick={handleLocate}
              title="Find me"
              aria-label="Find me"
            >
              <IconCrosshair />
            </button>
            <button
              className="fab"
              onClick={() => setShowTerritories(true)}
              title="Territories"
              aria-label="Territories"
            >
              <IconList />
            </button>
            <button className="fab fab-wide is-on" onClick={startDrawing}>
              <IconLasso size={18} /> Draw area
            </button>
          </div>
        )}

        {/* add-house hint */}
        {mode === "add" && (
          <div className="draw-bar">
            <div className="draw-hint">Tap anywhere on the map to drop a house.</div>
            <div className="draw-actions">
              <button className="btn btn-ghost-dark btn-block" onClick={() => setMode("idle")}>
                Done
              </button>
            </div>
          </div>
        )}

        {/* draw toolbar */}
        {mode === "draw" && (
          <div className="draw-bar">
            <div className="draw-hint">
              {drawCount === 0
                ? "Drag to lasso the area, or tap corner by corner. The shape closes itself."
                : `${drawCount} point${drawCount === 1 ? "" : "s"} — keep going, or hit Finish.`}
            </div>
            <div className="draw-actions">
              <button className="btn btn-ghost-dark" onClick={cancelDrawing}>
                <IconX size={16} /> Cancel
              </button>
              <button
                className="btn btn-ghost-dark"
                onClick={() => mapRef.current?.undoDrawPoint()}
                disabled={drawCount === 0}
              >
                <IconUndo size={16} /> Undo
              </button>
              <button className="btn btn-primary grow" onClick={finishDrawing} disabled={drawCount < 3}>
                <IconCheck size={16} /> Finish
              </button>
            </div>
          </div>
        )}

        {busy && (
          <div className="busy-overlay">
            <div className="busy-box">
              <div className="spinner dark" style={{ margin: "0 auto" }} />
              <p>{busy}</p>
            </div>
          </div>
        )}
      </div>

      {/* sheets */}
      {pendingPolygon && (
        <SaveTerritorySheet
          polygon={pendingPolygon}
          defaultName={`Area ${data.territories.length + 1}`}
          defaultColor={nextColor}
          onCancel={cancelDrawing}
          onSave={saveTerritory}
        />
      )}

      {showTerritories && (
        <TerritorySheet
          territories={data.territories}
          statsFor={statsFor}
          activeId={activeTerritoryId}
          onClose={() => setShowTerritories(false)}
          onSelect={(id) => {
            setActiveTerritoryId(id);
            const t = territoryById.get(id);
            if (t) mapRef.current?.fitPolygon(t.polygon);
          }}
          onRename={data.renameTerritory}
          onDelete={(id) => {
            data.deleteTerritory(id);
            if (activeTerritoryId === id) setActiveTerritoryId(null);
          }}
          onLoadAddresses={(id) => {
            const t = territoryById.get(id);
            if (!t) return;
            setShowTerritories(false);
            setActiveTerritoryId(id);
            loadAddresses(t);
          }}
          onStartDrawing={startDrawing}
          onExport={exportCsv}
        />
      )}

      {locationSheet && (
        <LocationSheet
          mode={locationSheet}
          onClose={() => setLocationSheet(null)}
          onContinue={() => {
            setLocationSheet(null);
            rememberAsked();
            mapRef.current?.locate();
          }}
          onAlreadyAllowed={() => setLocationSheet("blocked")}
        />
      )}

      {selectedHouse && (
        <HouseSheet
          house={selectedHouse}
          territoryName={territoryById.get(selectedHouse.territory_id ?? "")?.name ?? null}
          onClose={() => setSelectedHouseId(null)}
          onStatus={setStatus}
          onNotes={(notes) => data.updateHouse(selectedHouse.id, { notes })}
          onAddress={(address) => data.updateHouse(selectedHouse.id, { address })}
          onDelete={() => {
            data.deleteHouse(selectedHouse.id);
            setSelectedHouseId(null);
          }}
          onCenter={() => mapRef.current?.panTo(selectedHouse.lat, selectedHouse.lng)}
        />
      )}

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
