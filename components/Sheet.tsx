"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SheetProps {
  onClose: () => void;
  children: React.ReactNode;
}

/** Past this much downward travel, letting go dismisses the sheet. */
const DISMISS_PX = 110;

export default function Sheet({ onClose, children }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0);
  const gesture = useRef<{ startY: number; active: boolean }>({ startY: 0, active: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Swipe the sheet down to dismiss — the gesture every phone user expects.
  // Only starts from the grab handle area so it never fights the sheet's own
  // scrolling, which matters when the status list runs past the fold.
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    gesture.current = { startY: e.clientY, active: true };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!gesture.current.active) return;
    const dy = e.clientY - gesture.current.startY;
    setDrag(dy > 0 ? dy : dy / 4); // resists upward travel
  }, []);

  const onPointerUp = useCallback(() => {
    if (!gesture.current.active) return;
    gesture.current.active = false;
    setDrag((current) => {
      if (current > DISMISS_PX) onClose();
      return 0;
    });
  }, [onClose]);

  return (
    <>
      <div
        className="sheet-backdrop"
        onClick={onClose}
        style={drag > 0 ? { opacity: Math.max(0.15, 1 - drag / 260) } : undefined}
      />
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        style={
          drag !== 0
            ? { transform: `translateY(${drag}px)`, transition: "none" }
            : undefined
        }
      >
        <div
          className="grabber-hit"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="button"
          tabIndex={0}
          aria-label="Drag down to close"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onClose();
          }}
        >
          <div className="grabber" />
        </div>
        {children}
      </div>
    </>
  );
}
