"use client";

import { useState } from "react";
import Sheet from "./Sheet";
import { IconPlus, IconTarget, IconTrash } from "./Icons";
import type { Territory } from "@/lib/types";

export interface TerritoryStats {
  total: number;
  worked: number;
}

interface TerritorySheetProps {
  territories: Territory[];
  statsFor: (id: string) => TerritoryStats;
  activeId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onLoadAddresses: (id: string) => void;
  onStartDrawing: () => void;
  onExport: () => void;
}

export default function TerritorySheet({
  territories,
  statsFor,
  activeId,
  onClose,
  onSelect,
  onRename,
  onDelete,
  onLoadAddresses,
  onStartDrawing,
  onExport,
}: TerritorySheetProps) {
  const [openId, setOpenId] = useState<string | null>(activeId);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const sorted = [...territories].sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">Territories</div>
      <div className="sheet-sub">
        {territories.length === 0
          ? "None yet"
          : `${territories.length} area${territories.length === 1 ? "" : "s"} on this team map`}
      </div>

      {sorted.length === 0 ? (
        <div className="empty">
          Nothing drawn yet. Hit <strong>Draw area</strong> and trace the block you want to work —
          drag to lasso it, or tap corner by corner.
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {sorted.map((t) => {
            const { total, worked } = statsFor(t.id);
            const pct = total === 0 ? 0 : Math.round((worked / total) * 100);
            const expanded = openId === t.id;

            return (
              <div key={t.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <div className="terr-row" style={{ borderBottom: "none" }}>
                  <span className="swatch" style={{ background: t.color }} />
                  <button
                    className="terr-row-main"
                    onClick={() => setOpenId(expanded ? null : t.id)}
                    style={{ textAlign: "left" }}
                  >
                    {renamingId === t.id ? (
                      <input
                        className="field"
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => {
                          if (draftName.trim()) onRename(t.id, draftName.trim());
                          setRenamingId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        autoFocus
                      />
                    ) : (
                      <>
                        <div className="terr-row-name">{t.name}</div>
                        <div className="terr-sub">
                          {total === 0
                            ? "No houses loaded"
                            : `${worked} of ${total} doors worked`}
                          {t.created_by ? ` · drawn by ${t.created_by}` : ""}
                        </div>
                      </>
                    )}
                  </button>
                  <span className="pct">{pct}%</span>
                </div>

                <div className="progress" style={{ marginBottom: 10 }}>
                  <span style={{ width: `${pct}%`, background: t.color }} />
                </div>

                {expanded && (
                  <div style={{ padding: "2px 0 14px" }}>
                    <div className="row" style={{ flexWrap: "wrap" }}>
                      <button
                        className="btn btn-primary grow"
                        onClick={() => {
                          onSelect(t.id);
                          onClose();
                        }}
                      >
                        <IconTarget size={16} /> Go to area
                      </button>
                      <button className="btn btn-quiet grow" onClick={() => onLoadAddresses(t.id)}>
                        <IconPlus size={16} /> Load addresses
                      </button>
                    </div>
                    <div className="row" style={{ marginTop: 8 }}>
                      <button
                        className="btn btn-quiet grow"
                        onClick={() => {
                          setDraftName(t.name);
                          setRenamingId(t.id);
                        }}
                      >
                        Rename
                      </button>
                      {confirmId === t.id ? (
                        <button
                          className="btn btn-danger grow"
                          onClick={() => {
                            onDelete(t.id);
                            setConfirmId(null);
                          }}
                        >
                          Delete area and its {statsFor(t.id).total} houses
                        </button>
                      ) : (
                        <button
                          className="btn btn-danger"
                          onClick={() => setConfirmId(t.id)}
                          aria-label={`Delete ${t.name}`}
                        >
                          <IconTrash size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="row" style={{ marginTop: 18 }}>
        <button
          className="btn btn-primary grow"
          onClick={() => {
            onStartDrawing();
            onClose();
          }}
        >
          <IconPlus size={16} /> Draw a new area
        </button>
        <button className="btn btn-quiet" onClick={onExport} disabled={territories.length === 0}>
          Export CSV
        </button>
      </div>
    </Sheet>
  );
}
