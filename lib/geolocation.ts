"use client";

export type PermissionState = "granted" | "prompt" | "denied" | "unsupported";

export type LocationFailure = "denied" | "unavailable" | "timeout" | "unsupported";

/**
 * Reads the current geolocation permission WITHOUT triggering the native
 * dialog. Querying the Permissions API never prompts, which is the whole point:
 * it lets the app decide whether to explain itself first, quietly re-centre
 * because permission is already granted, or skip straight to recovery steps
 * because the browser has been told no and will not ask again.
 *
 * Not every mobile browser implements it, so "unsupported" is a real answer and
 * callers must treat it like "prompt" rather than assuming the worst.
 */
export async function getPermissionState(): Promise<PermissionState> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return "unsupported";
  if (!navigator.permissions?.query) return "unsupported";
  try {
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    if (status.state === "granted" || status.state === "denied" || status.state === "prompt") {
      return status.state;
    }
    return "unsupported";
  } catch {
    // Some browsers throw on the geolocation descriptor specifically.
    return "unsupported";
  }
}

export interface LocationErrorInfo {
  kind: LocationFailure;
  message: string;
}

/** Turns a GeolocationPositionError into something worth showing a rep. */
export function describeLocationError(err: GeolocationPositionError): LocationErrorInfo {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return {
        kind: "denied",
        message: "Location is turned off for this app.",
      };
    case err.POSITION_UNAVAILABLE:
      return {
        kind: "unavailable",
        // Reporting this as "blocked" is what makes reps think the app is
        // broken; indoors with no fix is a completely different problem.
        message: "Cannot get a fix here. Step outside or away from the building and try again.",
      };
    case err.TIMEOUT:
      return {
        kind: "timeout",
        message: "Location is taking too long. Try again in a moment.",
      };
    default:
      return { kind: "unavailable", message: "Could not get a location right now." };
  }
}

/**
 * A single fix, trying hard first and then cheaply.
 *
 * A cold GPS fix outdoors regularly takes longer than ten seconds, and the old
 * ten-second high-accuracy-only attempt reported that as a failure. If the
 * precise attempt times out we fall back to a coarse network fix, which is
 * still good enough to put the rep on the right street.
 */
export function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject({ code: 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, (precise) => {
      // A refusal will not change on a second attempt; anything else might.
      if (precise.code === precise.PERMISSION_DENIED) {
        reject(precise);
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 12000,
        maximumAge: 60000,
      });
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}
