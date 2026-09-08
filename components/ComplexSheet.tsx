"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Sheet from "./Sheet";
import { IconMove, IconPlus, IconTarget, IconTrash } from "./Icons";
import { STATUSES, STATUS_MAP, complexProgress, type House, type Status } from "@/lib/types";

/** How many doors one Add may create. A slipped thumb on "1-9999" should not land. */
export const MAX_NEW_UNITS = 400;

/**
 * Turns what a rep types into unit numbers.
 *
 * Accepts ranges and lists in the shapes people actually write on a clipboard:
 * "101-124", "1 to 12", "101-112, 201-212", "A, B, Basement". Anything that is
 * not a numeric range is taken literally, so lettered and named doors work
 * without a second input to explain themselves.
 */
export function parseUnitLabels(input: string): { labels: string[]; truncated: boolean } {
  const seen = new Set<string>();
  let truncated = false;

  const push = (label: string) => {
    if (seen.size >= MAX_NEW_UNITS) {
      truncated = true;
      return;
    }
    seen.add(label);
  };

  for (const chunk of input.split(/[,;\n]/)) {
    const raw = chunk.trim();
    if (!raw) continue;

    const range = raw.match(/^(\d+)\s*(?:-|–|—|to|through)\s*(\d+)$/i);
    if (!range) {
      push(raw);
      continue;
    }

    let from = Number(range[1]);
    let to = Number(range[2]);
    // A range written backwards is a typo, not a request for nothing.
    if (from > to) [from, to] = [to, from];
    // "0101-0112" is numbering rather than arithmetic, so keep the zeroes — but
    // "1-24" must not turn into "01", which is a different door on some blocks.
    const pad = range[1].startsWith("0") ? range[1].length : 0;
    for (let n = from; n <= to; n++) {
      push(String(n).padStart(pad, "0"));
      if (truncated) break;
    }
  }

  return { labels: [...seen], truncated };
}

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

interface ComplexSheetProps {
  complex: House;
  units: House[];
  territoryName: string | null;
  onClose: () => void;
  onRename: (name: string) => void;
  onAddress: (address: string) => void;
  onNotes: (notes: string) => void;
  onStatus: (status: Status) => void;
  onAddUnits: (labels: string[]) => void;
  onUnitStatus: (unitId: string, status: Status) => void;
  onUnitNotes: (unitId: string, notes: string) => void;
  onDeleteUnit: (unitId: string) => void;
  onBulkStatus: (ids: string[], status: Status) => void;
  onMove: () => void;
  onDelete: () => void;
  onCenter: () => void;
}

export default function ComplexSheet({
  complex,
  units,
  territoryName,
  onClose,
  onRename,
  onAddress,
  onNotes,
  onStatus,
  onAddUnits,
  onUnitStatus,
  onUnitNotes,
  onDeleteUnit,
  onBulkStatus,
  onMove,
  onDelete,
  onCenter,
}: ComplexSheetProps) {
  const [name, setName] = useState(complex.name ?? "");
  const [address, setAddress] = useState(complex.address ?? "");
  const [notes, setNotes] = useState(complex.notes ?? "");
  const [unitInput, setUnitInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [unitNote, setUnitNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Tapping a different building without closing the sheet reloads the fields.
  const complexIdRef = useRef(complex.id);
  useEffect(() => {
    if (complexIdRef.current === complex.id) return;
    complexIdRef.current = complex.id;
    setName(complex.name ?? "");
    setAddress(complex.address ?? "");
    setNotes(complex.notes ?? "");
    setUnitInput("");
    setAdding(false);
    setSelectedUnitId(null);
    setConfirmDelete(false);
  }, [complex]);

  const nameUnsaved = useAutosave(name, complex.name ?? "", onRename);
  useAutosave(address, complex.address ?? "", onAddress);
  const notesUnsaved = useAutosave(notes, complex.notes ?? "", onNotes);

  const selectedUnit = useMemo(
    () => units.find((u) => u.id === selectedUnitId) ?? null,
    [units, selectedUnitId]
  );

  // Switching doors has to reload the note, or the previous one gets pasted
  // onto the next door the moment the autosave fires.
  const unitIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = selectedUnit?.id ?? null;
    if (unitIdRef.current === id) return;
    unitIdRef.current = id;
    setUnitNote(selectedUnit?.notes ?? "");
  }, [selectedUnit]);

  useAutosave(unitNote, selectedUnit?.notes ?? "", (value) => {
    if (selectedUnit) onUnitNotes(selectedUnit.id, value);
  });

  const progress = complexProgress(units);

  const parsed = useMemo(() => parseUnitLabels(unitInput), [unitInput]);
  const existingLabels = useMemo(
    () => new Set(units.map((u) => u.address.trim().toLowerCase())),
    [units]
  );
  const freshLabels = parsed.labels.filter((l) => !existingLabels.has(l.toLowerCase()));
  const duplicates = parsed.labels.length - freshLabels.length;

  // Bulk actions never overwrite work somebody already recorded: closing a
  // building only touches doors nobody has knocked, and reopening it only
  // touches doors that were closed. Both directions are therefore reversible.
  const untouched = units.filter((u) => u.status === "not_knocked");
  const closed = units.filter((u) => u.status === "do_not_knock");

  function commitUnits() {
    if (freshLabels.length === 0) return;
    onAddUnits(freshLabels);
    setUnitInput("");
    setAdding(false);
  }

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">Apartment building</div>
      <div className="sheet-sub">
        {territoryName ? `${territoryName} · ` : ""}
        {units.length === 0
          ? "No doors listed yet"
          : progress.total === 0
            ? `${units.length} doors · all off limits`
            : `${progress.worked} of ${progress.total} doors worked` +
              (progress.excluded > 0 ? ` · ${progress.excluded} off limits` : "")}
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
        Doors
        {units.length > 0 && <span className="label-hint">{units.length} listed</span>}
      </div>

      {units.length === 0 && !adding && (
        <div className="empty">
          No doors listed yet. Add them once and every rep on the team can mark them one by one.
        </div>
      )}

      {units.length > 0 && (
        <div className="unit-grid">
          {units.map((u) => {
            const meta = STATUS_MAP[u.status] ?? STATUS_MAP.not_knocked;
            const active = u.id === selectedUnitId;
            return (
              <button
                key={u.id}
                className={`unit-chip${active ? " is-active" : ""}`}
                style={{
                  borderColor: meta.color,
                  background: `color-mix(in srgb, ${meta.color} 12%, #fff)`,
                }}
                onClick={() => setSelectedUnitId(active ? null : u.id)}
                title={`${u.address} — ${meta.label}`}
              >
                <span className="unit-chip-label">{u.address || "?"}</span>
                {u.notes?.trim() ? <span className="unit-chip-note" /> : null}
              </button>
            );
          })}
        </div>
      )}

      {selectedUnit && (
        <div className="unit-detail">
          <div className="unit-detail-head">
            <strong>{selectedUnit.address || "This door"}</strong>
            <button
              className="btn btn-danger btn-tiny"
              onClick={() => {
                onDeleteUnit(selectedUnit.id);
                setSelectedUnitId(null);
              }}
              aria-label={`Remove door ${selectedUnit.address}`}
            >
              <IconTrash size={14} />
            </button>
          </div>
          <div className="status-grid is-compact">
            {STATUSES.map((s) => {
              const active = s.id === selectedUnit.status;
              return (
                <button
                  key={s.id}
                  className={`status-btn${active ? " is-active" : ""}`}
                  style={active ? { color: s.color } : undefined}
                  onClick={() => onUnitStatus(selectedUnit.id, s.id)}
                >
                  <span className="legend-swatch" style={{ background: s.color }} />
                  <span style={{ color: "var(--ink)" }}>{s.short}</span>
                </button>
              );
            })}
          </div>
          <input
            className="field"
            style={{ marginTop: 8 }}
            value={unitNote}
            onChange={(e) => setUnitNote(e.target.value)}
            placeholder="Note for this door"
          />
        </div>
      )}

      {adding ? (
        <div className="unit-add">
          <input
            className="field"
            value={unitInput}
            onChange={(e) => setUnitInput(e.target.value)}
            placeholder="101-124, 201-224"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") commitUnits();
            }}
          />
          <div className="field-help">
            Ranges, lists, or plain names — <strong>101-124</strong>, <strong>1 to 12</strong>,{" "}
            <strong>A, B, Basement</strong>.
            {parsed.labels.length > 0 && (
              <>
                {" "}
                Adds <strong>{freshLabels.length}</strong> door
                {freshLabels.length === 1 ? "" : "s"}
                {duplicates > 0 ? ` (${duplicates} already listed)` : ""}.
                {parsed.truncated ? ` Capped at ${MAX_NEW_UNITS} at a time.` : ""}
              </>
            )}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn btn-primary grow"
              onClick={commitUnits}
              disabled={freshLabels.length === 0}
            >
              <IconPlus size={16} /> Add {freshLabels.length || ""} door
              {freshLabels.length === 1 ? "" : "s"}
            </button>
            <button className="btn btn-quiet" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="btn btn-quiet btn-block"
          style={{ marginTop: 10 }}
          onClick={() => setAdding(true)}
        >
          <IconPlus size={16} /> Add doors
        </button>
      )}

      {/* With no doors listed, the building is one stop and carries its own
          status. Once doors exist they are the work, and a status on the
          building itself would be a second, contradictory answer. */}
      {units.length === 0 && (
        <>
          <div className="section-label">Mark this building</div>
          <div className="status-grid is-compact">
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
                  <span style={{ color: "var(--ink)" }}>{s.short}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {units.length > 0 && (untouched.length > 0 || closed.length > 0) && (
        <>
          <div className="section-label">Whole building</div>
          {untouched.length > 0 && (
            <button
              className="btn btn-quiet btn-block"
              onClick={() => onBulkStatus(untouched.map((u) => u.id), "do_not_knock")}
            >
              Close {untouched.length} unknocked door{untouched.length === 1 ? "" : "s"} — no
              soliciting
            </button>
          )}
          {closed.length > 0 && (
            <button
              className="btn btn-quiet btn-block"
              style={{ marginTop: 8 }}
              onClick={() => onBulkStatus(closed.map((u) => u.id), "not_knocked")}
            >
              Reopen {closed.length} closed door{closed.length === 1 ? "" : "s"}
            </button>
          )}
          <p className="field-help" style={{ marginTop: 6 }}>
            Neither button touches a door somebody has already marked.
          </p>
        </>
      )}

      <div className="section-label">
        Building notes
        <span className="label-hint">{notesUnsaved ? "saving…" : "saves as you type"}</span>
      </div>
      <textarea
        className="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder={"Gate code · who manages it · best time for this block"}
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
            <IconTrash size={16} /> Delete building
            {units.length > 0 ? ` + ${units.length} doors` : ""}?
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
    </Sheet>
  );
}
