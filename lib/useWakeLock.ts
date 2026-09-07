"use client";

import { useEffect } from "react";

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  released: boolean;
}

/**
 * Holds the screen awake while the app is in front.
 *
 * A rep walks between doors with the phone in one hand; a 30-second auto-lock
 * means unlocking before every single knock. The lock is released whenever the
 * tab is hidden, so it costs nothing when the app is not actually in use, and
 * it is re-acquired on return because the browser drops it on visibility loss.
 *
 * Unsupported on some browsers (notably iOS before 16.4). It fails quietly
 * there — the app simply behaves as it did before.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;

    const api = (navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
    }).wakeLock;
    if (!api) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        sentinel = await api.request("screen");
      } catch {
        /* denied, low battery, or unsupported - not worth telling the rep */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (sentinel && !sentinel.released) sentinel.release().catch(() => {});
    };
  }, [active]);
}
