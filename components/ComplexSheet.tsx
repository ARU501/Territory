"use client";

import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import { IconMove, IconTarget, IconTrash } from "./Icons";
import { STATUSES, STATUS_MAP, type House, type Status } from "@/lib/types";

/**
 * Saves as you type, the same way the notes field does.
 *
 * Waiting for blur loses whatever was typed whenever the sheet is dismissed
 * with the keyboard still open, which on a phone is most of the time.
 */
function useAutosave(draft: string, saved: string, commit: (value: string) => void) {
  const unsaved = draft.trim() !== saved;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    if (!unsaved) return;
    const timer = setTimeout(() => commitRef.current(draft.trim()), 700);
    return () => clearTimeout(timer);
  }, [unsaved, draft]);
  return unsaved;
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

interface ComplexSheetProps {
  complex: House;
  territoryName: string | null;
  onClose: () => void;
  onRename: (name: string) => void;
  onAddress: (address: string) => void;
  onNotes: (notes: string) => void;
  onStatus: (status: Status) => void;
  onMove: () => void;
  onDelete: () => void;
  onCenter: () => void;
}

/**
 * An apartment building is one stop, marked like any other door.
 *
 * This deliberately does not break a complex into its individual units. A rep
 * standing outside a forty-door building wants to record that they worked it
 * and move on, not maintain a directory; a grid of unit numbers is a second job
 * nobody asked for, and every number in it would have to be kept true by hand.
 * What the building carries instead is a name and a note — which door to try,
 * the gate code, who manages it — because that is what is worth knowing next
 * time, and it survives whoever walks it.
 */
export default function ComplexSheet({
  complex,
  territoryName,
  onClose,
  onRename,
  onAddress,
  onNotes,
  onStatus,
  onMove,
  onDelete,
  onCenter,
}: ComplexSheetProps) {
  const [name, setName] = useState(complex.name ?? "");
  const [address, setAddress] = useState(complex.address ?? "");
  const [notes, setNotes] = useState(complex.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Tapping a different building without closing the sheet reloads the fields.
  const complexIdRef = useRef(complex.id);
  useEffect(() => {
    if (complexIdRef.current === complex.id) return;
    complexIdRef.current = complex.id;
    setName(complex.name ?? "");
    setAddress(complex.address ?? "");
    setNotes(complex.notes ?? "");
    setConfirmDelete(false);
  }, [complex]);

  const nameUnsaved = useAutosave(name, complex.name ?? "", onRename);
  useAutosave(address, complex.address ?? "", onAddress);
  const notesUnsaved = useAutosave(notes, complex.notes ?? "", onNotes);

  const meta = STATUS_MAP[complex.status] ?? STATUS_MAP.not_knocked;

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">{complex.name || "Apartment building"}</div>
      <div className="sheet-sub">
        {territoryName ? `${territoryName} · ` : ""}
        <span style={{ color: meta.color, fontWeight: 700 }}>{meta.label}</span>
        {complex.status !== "not_knocked" && complex.updated_by
          ? ` · ${complex.updated_by}, ${relativeTime(complex.updated_at)}`
          : ""}
      </div>

      <div className="section-label">Mark this building</div>
      <div className="status-grid">
        {STATUSES.map((s) => {
          const active = s.id === complex.status;
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

      <div className="section-label">
        Name
        <span className="label-hint">{nameUnsaved ? "saving…" : "saves as you type"}</span>
      </div>
      <input
        className="field"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="The Arlo"
        autoFocus={!complex.name}
      />
      <input
        className="field"
        style={{ marginTop: 8 }}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Street address (optional)"
      />

      <div className="section-label">
        Notes
        <span className="label-hint">{notesUnsaved ? "saving…" : "saves as you type"}</span>
      </div>
      <textarea
        className="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        placeholder={
          "Anything worth knowing next time.\n" +
          "Gate code · buzzer at the north door · manager in 101 · no soliciting sign"
        }
      />

      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn btn-quiet grow" onClick={onCenter}>
          <IconTarget size={16} /> Center
        </button>
        <button className="btn btn-quiet grow" onClick={onMove}>
          <IconMove size={16} /> Move pin
        </button>
        {confirmDelete ? (
          <button className="btn btn-danger grow" onClick={onDelete}>
            <IconTrash size={16} /> Really delete?
          </button>
        ) : (
          <button
            className="btn btn-danger"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete this building"
          >
            <IconTrash size={16} />
          </button>
        )}
      </div>

      <p className="meta-line">
        {complex.status === "not_knocked"
          ? `Added ${relativeTime(complex.updated_at)}${
              complex.updated_by ? ` by ${complex.updated_by}` : ""
            }`
          : `Last marked ${relativeTime(complex.updated_at)}${
              complex.updated_by ? ` by ${complex.updated_by}` : ""
            }`}
      </p>
    </Sheet>
  );
}
