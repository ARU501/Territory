"use client";

import { useState } from "react";
import Sheet from "./Sheet";
import { formatArea, polygonAreaSqM } from "@/lib/geo";
import { TERRITORY_COLORS, type LatLng } from "@/lib/types";

interface SaveTerritorySheetProps {
  polygon: LatLng[];
  defaultName: string;
  defaultColor: string;
  onCancel: () => void;
  onSave: (name: string, color: string, autoLoad: boolean) => void;
}

export default function SaveTerritorySheet({
  polygon,
  defaultName,
  defaultColor,
  onCancel,
  onSave,
}: SaveTerritorySheetProps) {
  const [name, setName] = useState(defaultName);
  const [color, setColor] = useState(defaultColor);
  const [autoLoad, setAutoLoad] = useState(true);

  const area = polygonAreaSqM(polygon);
  const big = area > 4046.86 * 400; // roughly 400 acres

  return (
    <Sheet onClose={onCancel}>
      <div className="sheet-title">Save this territory</div>
      <div className="sheet-sub">
        {polygon.length} points · about {formatArea(area)}
      </div>

      <div className="section-label">Name</div>
      <input
        className="field"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Maple Street block"
        maxLength={60}
        autoFocus
      />

      <div className="section-label">Color</div>
      <div className="colors">
        {TERRITORY_COLORS.map((c) => (
          <button
            key={c}
            className={`color-dot${c === color ? " is-active" : ""}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={`Use color ${c}`}
          />
        ))}
      </div>

      <div className="section-label">Houses</div>
      <label className="status-btn" style={{ width: "100%" }}>
        <input
          type="checkbox"
          checked={autoLoad}
          onChange={(e) => setAutoLoad(e.target.checked)}
          style={{ width: 18, height: 18, accentColor: "var(--brand)" }}
        />
        <span>
          Load every address inside this area
          <span style={{ display: "block", fontWeight: 500, fontSize: 12, color: "var(--muted)" }}>
            Pulled from OpenStreetMap. Coverage is best in towns and cities.
          </span>
        </span>
      </label>

      {big && autoLoad && (
        <p className="field-help" style={{ color: "#b45309" }}>
          That is a large area — loading it may take a minute and could return thousands of houses.
          Smaller territories are easier to work and faster to load.
        </p>
      )}

      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn btn-quiet grow" onClick={onCancel}>
          Discard
        </button>
        <button
          className="btn btn-primary grow"
          disabled={name.trim().length === 0}
          onClick={() => onSave(name.trim(), color, autoLoad)}
        >
          Save territory
        </button>
      </div>
    </Sheet>
  );
}
