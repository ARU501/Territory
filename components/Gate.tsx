"use client";

import { useState } from "react";
import { isCloudMode } from "@/lib/supabase";
import { IconDoor } from "./Icons";

interface GateProps {
  initialTeam: string;
  initialRep: string;
  onEnter: (team: string, rep: string) => void;
}

export default function Gate({ initialTeam, initialRep, onEnter }: GateProps) {
  const [team, setTeam] = useState(initialTeam);
  const [rep, setRep] = useState(initialRep);
  const [touched, setTouched] = useState(false);

  const cleanTeam = team.trim();
  const cleanRep = rep.trim();
  const ready = cleanTeam.length >= 3 && cleanRep.length >= 1;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!ready) return;
    onEnter(cleanTeam, cleanRep);
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="gate-mark">
          <IconDoor size={24} className="gate-icon" />
        </div>
        <h1 className="gate-title">DoorKnock</h1>
        <p className="gate-copy">
          Draw the area you want to work, pull in every house inside it, and mark each door as you
          go. {isCloudMode
            ? "Everyone who enters the same team code sees the same map, updating live."
            : "This deploy has no database connected yet, so your work is saved on this device only."}
        </p>

        <label className="field-label" htmlFor="team">
          Team code
        </label>
        <input
          id="team"
          className="field"
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          placeholder="e.g. summit-solar"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={40}
        />
        <p className="field-help">
          Any word your crew agrees on. Everyone who types the same code shares one map, so pick
          something other teams will not guess.
        </p>

        <label className="field-label" htmlFor="rep" style={{ marginTop: 16 }}>
          Your name
        </label>
        <input
          id="rep"
          className="field"
          value={rep}
          onChange={(e) => setRep(e.target.value)}
          placeholder="e.g. Sean"
          autoComplete="given-name"
          maxLength={40}
        />
        <p className="field-help">Stamped on every door you mark so the team knows who worked it.</p>

        {touched && !ready && (
          <p className="field-help" style={{ color: "var(--danger)", marginTop: 12 }}>
            Enter a team code of at least 3 characters and your name.
          </p>
        )}

        <button
          type="submit"
          className="btn btn-primary btn-block"
          style={{ marginTop: 22, padding: "14px" }}
        >
          Start knocking
        </button>
      </form>
    </div>
  );
}
