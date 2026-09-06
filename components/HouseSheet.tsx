"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import { IconTarget, IconTrash } from "./Icons";
import { STATUSES, STATUS_MAP, type House, type Status } from "@/lib/types";

interface HouseSheetProps {
  house: House;
  territoryName: string | null;
  onClose: () => void;
  onStatus: (status: Status) => void;
  onNotes: (notes: string) => void;
  onAddress: (address: string) => void;
  onDelete: () => void;
  onCenter: () => void;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export default function HouseSheet({
  house,
  territoryName,
  onClose,
  onStatus,
  onNotes,
  onAddress,
  onDelete,
  onCenter,
}: HouseSheetProps) {
  const [notes, setNotes] = useState(house.notes ?? "");
  const [address, setAddress] = useState(house.address ?? "");
  const [editingAddress, setEditingAddress] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const houseIdRef = useRef(house.id);

  // Switching to a different pin without closing the sheet should reload fields.
  useEffect(() => {
    if (houseIdRef.current === house.id) return;
    houseIdRef.current = house.id;
    setNotes(house.notes ?? "");
    setAddress(house.address ?? "");
    setEditingAddress(false);
    setConfirmDelete(false);
  }, [house]);

  const meta = STATUS_MAP[house.status] ?? STATUS_MAP.not_knocked;
  const fallbackLabel = `Dropped pin · ${house.lat.toFixed(5)}, ${house.lng.toFixed(5)}`;

  const commitNotes = useCallback(() => {
    const next = notes.trim();
    if (next !== (house.notes ?? "")) onNotes(next);
  }, [notes, house.notes, onNotes]);

  // Notes save as they are typed. Waiting for blur loses a note whenever the
  // sheet is dismissed with the keyboard still open.
  useEffect(() => {
    if (notes.trim() === (house.notes ?? "")) return;
    const timer = setTimeout(commitNotes, 700);
    return () => clearTimeout(timer);
  }, [notes, house.notes, commitNotes]);

  function commitAddress() {
    const next = address.trim();
    setEditingAddress(false);
    if (next !== (house.address ?? "")) onAddress(next);
  }

  return (
    <Sheet onClose={onClose}>
      {editingAddress ? (
        <div className="row" style={{ marginBottom: 4 }}>
          <input
            className="field grow"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street address"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAddress();
            }}
          />
          <button className="btn btn-primary" onClick={commitAddress}>
            Save
          </button>
        </div>
      ) : (
        <button
          className="sheet-title"
          style={{ display: "block", width: "100%", textAlign: "left" }}
          onClick={() => setEditingAddress(true)}
          title="Tap to edit the address"
        >
          {house.address || fallbackLabel}
        </button>
      )}

      <div className="sheet-sub">
        {territoryName ? `${territoryName} · ` : ""}
        <span style={{ color: meta.color, fontWeight: 700 }}>{meta.label}</span>
        {house.status !== "not_knocked" && house.updated_by
          ? ` · ${house.updated_by}, ${relativeTime(house.updated_at)}`
          : ""}
      </div>

      <div className="section-label">Mark this door</div>
      <div className="status-grid">
        {STATUSES.map((s) => {
          const active = s.id === house.status;
          return (
            <button
              key={s.id}
              className={`status-btn${active ? " is-active" : ""}`}
              style={active ? { color: s.color } : undefined}
              onClick={() => onStatus(s.id)}
            >
              <span className="legend-swatch" style={{ background: s.color }} />
              <span style={{ color: "var(--ink)" }}>{s.label}</span>
            </button>
          );
        })}
      </div>

      <div className="section-label">Notes</div>
      <textarea
        className="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={commitNotes}
        placeholder="Dog in the yard, come back after 6, spouse decides…"
      />

      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn btn-quiet grow" onClick={onCenter}>
          <IconTarget size={16} /> Center on map
        </button>
        {confirmDelete ? (
          <button
            className="btn btn-danger grow"
            onClick={() => {
              commitNotes();
              onDelete();
            }}
          >
            <IconTrash size={16} /> Really delete?
          </button>
        ) : (
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)} aria-label="Delete this house">
            <IconTrash size={16} />
          </button>
        )}
      </div>

      <p className="meta-line">
        {house.status === "not_knocked"
          ? `Added ${relativeTime(house.updated_at)}${house.updated_by ? ` by ${house.updated_by}` : ""}`
          : `Last marked ${relativeTime(house.updated_at)}${
              house.updated_by ? ` by ${house.updated_by}` : ""
            }`}
      </p>
    </Sheet>
  );
}
