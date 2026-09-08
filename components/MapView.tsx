"use client";

import { useEffect, useImperativeHandle, useRef, type MutableRefObject } from "react";
import L from "leaflet";
import type { House, LatLng, Territory } from "@/lib/types";
import { STATUS_MAP } from "@/lib/types";
import {
  describeLocationError,
  getPermissionState,
  getPosition,
  type LocationFailure,
} from "@/lib/geolocation";

export type MapMode = "idle" | "draw" | "add" | "move";
export type Basemap = "street" | "satellite";

export interface MapHandle {
  fitPolygon: (polygon: LatLng[]) => void;
  panTo: (lat: number, lng: number, zoom?: number) => void;
  locate: () => void;
  undoDrawPoint: () => void;
  clearDrawing: () => void;
  getDrawPoints: () => LatLng[];
}

interface MapViewProps {
  /**
   * next/dynamic does not forward refs, so the imperative handle is passed in
   * as a plain ref object instead.
   */
  handleRef: MutableRefObject<MapHandle | null>;
  mode: MapMode;
  basemap: Basemap;
  territories: Territory[];
  houses: House[];
  activeTerritoryId: string | null;
  selectedHouseId: string | null;
  onDrawProgress: (pointCount: number) => void;
  onHouseClick: (house: House) => void;
  onMapTap: (point: LatLng) => void;
  onTerritoryClick: (id: string) => void;
  onLocationError: (kind: LocationFailure, message: string) => void;
  /** A real fix arrived, so any remembered refusal is stale. */
  onLocationFound: () => void;
}

const TILES: Record<Basemap, { url: string; attribution: string; maxZoom: number }> = {
  street: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
  },
};

const LABELS_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

/** Below this zoom a full territory can be thousands of dots; draw it as one shape instead. */
const MARKER_MIN_ZOOM = 15;

/**
 * Buildings stay on screen four zoom levels further out than house dots.
 *
 * One pin can stand for eighty doors, so a rep needs to see that a complex is
 * over there from much further away than they can read a street name — and
 * there are a handful of them per territory, not ten thousand.
 */
const COMPLEX_MIN_ZOOM = 12;

/**
 * Built as DOM rather than an HTML string: building names are typed by reps,
 * and interpolating one into innerHTML would run whatever it contained.
 */
function complexPin(house: House, selected: boolean): HTMLElement {
  const meta = STATUS_MAP[house.status] ?? STATUS_MAP.not_knocked;

  const root = document.createElement("div");
  root.style.setProperty("--pin", meta.color);

  const chip = document.createElement("div");
  chip.className = `complex-chip${selected ? " is-selected" : ""}`;

  const name = document.createElement("span");
  name.className = "complex-chip-name";
  name.textContent = house.name || house.address || "Apartments";
  chip.appendChild(name);

  const stem = document.createElement("span");
  stem.className = "complex-stem";
  const dot = document.createElement("span");
  dot.className = "complex-dot";

  root.append(chip, stem, dot);
  return root;
}

/** City blocks put houses ~10 m apart, so dots have to shrink as you zoom out. */
function markerRadius(zoom: number): number {
  if (zoom >= 19) return 9;
  if (zoom >= 18) return 7;
  if (zoom >= 17) return 5;
  if (zoom >= 16) return 3.5;
  return 2.5;
}

/** Repaint the in-progress lasso: outline, fill, and a dot on each vertex. */
function paintDrawing(layer: L.LayerGroup, pts: LatLng[]) {
  layer.clearLayers();
  if (pts.length >= 3) {
    L.polygon(pts as L.LatLngExpression[], {
      color: "#2563eb",
      weight: 3,
      fillColor: "#2563eb",
      fillOpacity: 0.15,
      dashArray: "6 6",
      interactive: false,
    }).addTo(layer);
  } else if (pts.length === 2) {
    L.polyline(pts as L.LatLngExpression[], {
      color: "#2563eb",
      weight: 3,
      dashArray: "6 6",
      interactive: false,
    }).addTo(layer);
  }
  if (pts.length <= 60) {
    for (const p of pts) {
      L.circleMarker(p as L.LatLngExpression, {
        radius: 4,
        color: "#ffffff",
        weight: 2,
        fillColor: "#2563eb",
        fillOpacity: 1,
        interactive: false,
      }).addTo(layer);
    }
  }
}

export default function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const labelLayerRef = useRef<L.TileLayer | null>(null);
  const territoryLayerRef = useRef<L.LayerGroup | null>(null);
  const houseLayerRef = useRef<L.LayerGroup | null>(null);
  const complexLayerRef = useRef<L.LayerGroup | null>(null);
  const drawLayerRef = useRef<L.LayerGroup | null>(null);
  const meLayerRef = useRef<L.LayerGroup | null>(null);

  const markersRef = useRef(new Map<string, L.CircleMarker>());
  const drawPointsRef = useRef<LatLng[]>([]);
  const watchIdRef = useRef<number | null>(null);
  const hasCenteredRef = useRef(false);

  // Props change often; handlers read them through a ref so the Leaflet
  // listeners can be attached exactly once.
  const propsRef = useRef(props);
  propsRef.current = props;

  // ---- map setup ----------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [39.8283, -98.5795],
      zoom: 4,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      // House pins are 5-9px; the canvas renderer hit-tests them on exactly
      // that radius, which is far below a fingertip. The tolerance gives a
      // thumb roughly a 40px target without making the dots visually bigger.
      renderer: L.canvas({ tolerance: 14 }),
    });
    mapRef.current = map;

    L.control.zoom({ position: "topright" }).addTo(map);
    map.attributionControl.setPrefix("");

    territoryLayerRef.current = L.layerGroup().addTo(map);
    houseLayerRef.current = L.layerGroup().addTo(map);
    complexLayerRef.current = L.layerGroup().addTo(map);
    drawLayerRef.current = L.layerGroup().addTo(map);
    meLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      const { mode } = propsRef.current;
      // "move" repositions an existing pin; the page decides which one.
      if (mode === "add" || mode === "move") {
        propsRef.current.onMapTap([e.latlng.lat, e.latlng.lng]);
      }
    });

    // Markers are culled to the visible bounds, so panning needs a repaint too.
    map.on("moveend", () => {
      renderHouses();
      renderComplexes();
    });

    // React Strict Mode mounts, unmounts and remounts; anything asynchronous
    // has to check that its map still exists before touching it.
    let disposed = false;

    // Re-centre on the rep ONLY if they have already granted permission.
    //
    // This used to call getCurrentPosition unconditionally, which fired the
    // native permission dialog the instant the map loaded — before the rep had
    // done anything or been told why it was being asked. People decline a
    // dialog like that by reflex, and both iOS and Android then remember the
    // refusal and stop prompting, so "Find me" failed forever afterwards.
    // Checking the Permissions API never prompts, so an undecided or blocked
    // browser is left alone until the rep deliberately taps Find me.
    getPermissionState().then((state) => {
      if (disposed || state !== "granted" || hasCenteredRef.current) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (disposed || hasCenteredRef.current) return;
          hasCenteredRef.current = true;
          map.setView([pos.coords.latitude, pos.coords.longitude], 17);
        },
        () => {
          /* already granted but no fix - the default view stands */
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      );
    });

    // Leaflet mis-sizes itself when it initialises inside a flex layout.
    const sizeTimer = window.setTimeout(() => {
      if (!disposed) map.invalidateSize();
    }, 60);
    const onResize = () => {
      if (!disposed) map.invalidateSize();
    };
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      window.clearTimeout(sizeTimer);
      window.removeEventListener("resize", onResize);
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      hasCenteredRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- basemap ------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
    if (labelLayerRef.current) {
      map.removeLayer(labelLayerRef.current);
      labelLayerRef.current = null;
    }

    const cfg = TILES[props.basemap];
    baseLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
      maxNativeZoom: cfg.maxZoom,
    }).addTo(map);
    baseLayerRef.current.bringToBack();

    if (props.basemap === "satellite") {
      labelLayerRef.current = L.tileLayer(LABELS_URL, { maxZoom: 19, maxNativeZoom: 19 }).addTo(map);
    }
  }, [props.basemap]);

  // ---- territories --------------------------------------------------------
  useEffect(() => {
    const layer = territoryLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const t of props.territories) {
      if (!Array.isArray(t.polygon) || t.polygon.length < 3) continue;
      const isActive = t.id === props.activeTerritoryId;
      const poly = L.polygon(t.polygon as L.LatLngExpression[], {
        color: t.color,
        weight: isActive ? 4 : 2,
        opacity: isActive ? 1 : 0.75,
        fillColor: t.color,
        fillOpacity: isActive ? 0.12 : 0.06,
        interactive: true,
      });
      poly.on("click", (e) => {
        if (propsRef.current.mode !== "idle") return;
        L.DomEvent.stop(e);
        propsRef.current.onTerritoryClick(t.id);
      });
      poly.addTo(layer);
    }
  }, [props.territories, props.activeTerritoryId]);

  // ---- houses -------------------------------------------------------------
  function renderHouses() {
    const map = mapRef.current;
    const layer = houseLayerRef.current;
    if (!map || !layer) return;

    const { houses, selectedHouseId, activeTerritoryId } = propsRef.current;
    const zoom = map.getZoom();
    const markers = markersRef.current;

    if (zoom < MARKER_MIN_ZOOM) {
      layer.clearLayers();
      markers.clear();
      return;
    }

    const wanted = new Set<string>();
    const bounds = map.getBounds().pad(0.4);
    const radius = markerRadius(zoom);
    const stroke = zoom >= 17 ? 2 : 1;

    for (const h of houses) {
      // Buildings get their own labelled pins below.
      if (h.kind === "complex") continue;
      if (!bounds.contains([h.lat, h.lng])) continue;
      wanted.add(h.id);

      const meta = STATUS_MAP[h.status] ?? STATUS_MAP.not_knocked;
      const selected = h.id === selectedHouseId;
      const dimmed = activeTerritoryId !== null && h.territory_id !== activeTerritoryId;
      // A house someone left a note on gets a dark ring, so "come back after 6"
      // is visible from the map instead of only after opening the house.
      const hasNote = Boolean(h.notes && h.notes.trim());

      const style: L.CircleMarkerOptions = {
        radius: selected ? radius + 4 : radius,
        color: selected ? "#0f172a" : hasNote ? "#0f172a" : "#ffffff",
        weight: selected ? 3 : hasNote ? Math.max(stroke, 2.5) : stroke,
        fillColor: meta.color,
        fillOpacity: dimmed ? 0.35 : 1,
        opacity: dimmed ? 0.5 : 1,
      };

      const existing = markers.get(h.id);
      if (existing) {
        existing.setLatLng([h.lat, h.lng]);
        existing.setStyle(style);
        existing.setRadius(style.radius!);
      } else {
        const marker = L.circleMarker([h.lat, h.lng], style);
        marker.on("click", (e) => {
          if (propsRef.current.mode === "draw") return;
          L.DomEvent.stop(e);
          const current = propsRef.current.houses.find((x) => x.id === h.id);
          if (current) propsRef.current.onHouseClick(current);
        });
        marker.addTo(layer);
        markers.set(h.id, marker);
      }
    }

    for (const [id, marker] of markers) {
      if (!wanted.has(id)) {
        layer.removeLayer(marker);
        markers.delete(id);
      }
    }
  }

  // ---- apartment buildings ------------------------------------------------
  function renderComplexes() {
    const map = mapRef.current;
    const layer = complexLayerRef.current;
    if (!map || !layer) return;

    const { houses, selectedHouseId, activeTerritoryId } = propsRef.current;
    layer.clearLayers();
    if (map.getZoom() < COMPLEX_MIN_ZOOM) return;

    const bounds = map.getBounds().pad(0.5);
    for (const h of houses) {
      if (h.kind !== "complex") continue;
      if (!bounds.contains([h.lat, h.lng])) continue;

      const marker = L.marker([h.lat, h.lng], {
        icon: L.divIcon({
          className: "complex-marker",
          html: complexPin(h, h.id === selectedHouseId),
          iconSize: [0, 0],
        }),
        // Above the house dots: a building is the bigger prize on the street,
        // and its label would otherwise be interrupted by pins drawn over it.
        zIndexOffset: 1000,
        opacity: activeTerritoryId !== null && h.territory_id !== activeTerritoryId ? 0.55 : 1,
        keyboard: false,
      });
      marker.on("click", (e) => {
        if (propsRef.current.mode === "draw") return;
        L.DomEvent.stop(e);
        const current = propsRef.current.houses.find((x) => x.id === h.id);
        if (current) propsRef.current.onHouseClick(current);
      });
      marker.addTo(layer);
    }
  }

  useEffect(() => {
    renderHouses();
    renderComplexes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.houses, props.selectedHouseId, props.activeTerritoryId]);

  // ---- freehand / tap drawing --------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const layer = drawLayerRef.current;
    if (!map || !layer) return;

    const el = map.getContainer();

    if (props.mode !== "draw") {
      map.dragging.enable();
      map.doubleClickZoom.enable();
      el.classList.remove("drawing");
      el.style.touchAction = "";
      return;
    }

    map.dragging.disable();
    map.doubleClickZoom.disable();
    el.classList.add("drawing");
    el.style.touchAction = "none";

    let pointerDown = false;
    let dragged = false;
    let startPx: L.Point | null = null;
    let lastPx: L.Point | null = null;

    const redraw = () => {
      paintDrawing(layer, drawPointsRef.current);
      propsRef.current.onDrawProgress(drawPointsRef.current.length);
    };

    const pushFromEvent = (e: PointerEvent) => {
      const pt = map.mouseEventToContainerPoint(e);
      const ll = map.containerPointToLatLng(pt);
      drawPointsRef.current.push([ll.lat, ll.lng]);
      lastPx = pt;
      redraw();
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== undefined && e.button !== 0) return;
      pointerDown = true;
      dragged = false;
      startPx = map.mouseEventToContainerPoint(e);
      lastPx = startPx;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety, not a requirement */
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!pointerDown || !startPx) return;
      const pt = map.mouseEventToContainerPoint(e);
      if (!dragged && pt.distanceTo(startPx) < 8) return;

      if (!dragged) {
        // The gesture turned out to be a drag: seed the stroke at its origin.
        dragged = true;
        const origin = map.containerPointToLatLng(startPx);
        drawPointsRef.current.push([origin.lat, origin.lng]);
      }
      if (lastPx && pt.distanceTo(lastPx) < 7) return;
      pushFromEvent(e);
    };

    const onUp = (e: PointerEvent) => {
      if (!pointerDown) return;
      pointerDown = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* nothing captured */
      }
      // A tap (no drag) drops a single corner point.
      if (!dragged) pushFromEvent(e);
      dragged = false;
      startPx = null;
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);

    redraw();

    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      map.dragging.enable();
      map.doubleClickZoom.enable();
      el.classList.remove("drawing");
      el.style.touchAction = "";
    };
  }, [props.mode]);

  // ---- imperative handle --------------------------------------------------
  useImperativeHandle(props.handleRef, () => ({
    fitPolygon(polygon) {
      const map = mapRef.current;
      if (!map || polygon.length < 2) return;
      map.fitBounds(L.latLngBounds(polygon as L.LatLngExpression[]), { padding: [48, 48] });
    },
    panTo(lat, lng, zoom) {
      const map = mapRef.current;
      if (!map) return;
      map.setView([lat, lng], zoom ?? Math.max(map.getZoom(), 18), { animate: true });
    },
    locate() {
      const map = mapRef.current;
      const layer = meLayerRef.current;
      if (!map || !layer) return;
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        propsRef.current.onLocationError("unsupported", "This browser cannot share a location.");
        return;
      }

      const draw = (pos: GeolocationPosition, recenter: boolean) => {
        // The map can be torn down between the request and the fix arriving.
        if (mapRef.current !== map) return;
        const { latitude, longitude, accuracy } = pos.coords;
        layer.clearLayers();
        L.circle([latitude, longitude], {
          radius: Math.min(accuracy, 120),
          color: "#2563eb",
          weight: 1,
          fillColor: "#2563eb",
          fillOpacity: 0.12,
          interactive: false,
        }).addTo(layer);
        L.circleMarker([latitude, longitude], {
          radius: 7,
          color: "#ffffff",
          weight: 3,
          fillColor: "#2563eb",
          fillOpacity: 1,
          interactive: false,
        }).addTo(layer);
        if (recenter) {
          hasCenteredRef.current = true;
          map.setView([latitude, longitude], Math.max(map.getZoom(), 18));
        }
      };

      // getPosition tries a precise fix first and falls back to a coarse one,
      // so a slow cold GPS lock outdoors is not reported as a failure.
      getPosition().then(
        (pos) => {
          propsRef.current.onLocationFound();
          draw(pos, true);
          if (watchIdRef.current === null) {
            watchIdRef.current = navigator.geolocation.watchPosition(
              (p) => draw(p, false),
              () => {},
              { enableHighAccuracy: true, maximumAge: 5000 }
            );
          }
        },
        (err: GeolocationPositionError) => {
          const { kind, message } = describeLocationError(err);
          propsRef.current.onLocationError(kind, message);
        }
      );
    },
    undoDrawPoint() {
      const layer = drawLayerRef.current;
      if (!layer) return;
      drawPointsRef.current.pop();
      paintDrawing(layer, drawPointsRef.current);
      propsRef.current.onDrawProgress(drawPointsRef.current.length);
    },
    clearDrawing() {
      drawPointsRef.current = [];
      drawLayerRef.current?.clearLayers();
      propsRef.current.onDrawProgress(0);
    },
    getDrawPoints() {
      return drawPointsRef.current.slice();
    },
  }));

  return <div ref={containerRef} className="map-canvas" />;
}
