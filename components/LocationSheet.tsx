"use client";

import Sheet from "./Sheet";
import { IconCrosshair } from "./Icons";

export type LocationSheetMode = "explain" | "blocked";

interface LocationSheetProps {
  mode: LocationSheetMode;
  onClose: () => void;
  /** Triggers the real browser prompt (explain), or retries the fix (blocked). */
  onContinue: () => void;
}

interface Device {
  ios: boolean;
  android: boolean;
  standalone: boolean;
}

function detectDevice(): Device {
  if (typeof navigator === "undefined") return { ios: false, android: false, standalone: false };
  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS reports itself as a Mac, but a Mac has no touch points.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const standalone =
    (typeof window !== "undefined" &&
      window.matchMedia?.("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return { ios, android, standalone: Boolean(standalone) };
}

interface Route {
  title: string;
  steps: string[];
}

/**
 * Recovery routes, deliberately ordered easiest-first and worded to survive OS
 * updates. Naming a submenu that has been renamed is worse than describing what
 * the rep is looking for, so these say what to look for rather than promising an
 * exact label wherever there is any doubt.
 */
function routesFor(device: Device): Route[] {
  if (device.ios) {
    const routes: Route[] = [
      {
        title: "Settings app (most reliable)",
        steps: [
          "Open Settings",
          "Tap Apps, then Safari — on older iOS, scroll down to Safari directly",
          "Tap Location",
          "Choose Ask or Allow",
          "Come back here and tap Try again",
        ],
      },
      {
        title: "Check location is on for the phone at all",
        steps: [
          "Open Settings",
          "Tap Privacy & Security, then Location Services",
          "Make sure the switch at the top is on",
          "Find Safari in the list and allow it While Using the App",
          "Turn on Precise Location so the map puts you on the right house",
        ],
      },
    ];

    if (device.standalone) {
      routes.unshift({
        title: "You added this to your Home Screen",
        steps: [
          "Home Screen apps keep their own location permission, separate from Safari",
          "If the steps below do not fix it, press and hold this app's icon and remove it",
          "Open the site in Safari again, allow location when asked, then add it back",
        ],
      });
    } else {
      routes.unshift({
        title: "From this page",
        steps: [
          "Tap the page settings button in the address bar (it looks like AA or a puzzle-style icon)",
          "Look for Website Settings or Location",
          "Set Location to Ask or Allow, then tap Try again",
        ],
      });
    }
    return routes;
  }

  if (device.android) {
    return [
      {
        title: "From this page",
        steps: [
          "Tap the icon to the left of the web address (a lock or sliders icon)",
          "Tap Permissions, or Site settings",
          "Set Location to Allow",
          "Come back here and tap Try again",
        ],
      },
      {
        title: "Check location is on for the browser",
        steps: [
          "Open your phone's Settings, then Apps",
          "Find Chrome (or whichever browser you use)",
          "Tap Permissions, then Location, and allow it while using the app",
          "Make sure your phone's main Location switch is on too",
        ],
      },
    ];
  }

  return [
    {
      title: "In your browser",
      steps: [
        "Click the icon to the left of the web address",
        "Find Location in the permissions list",
        "Set it to Allow, then reload the page",
      ],
    },
  ];
}

export default function LocationSheet({ mode, onClose, onContinue }: LocationSheetProps) {
  const device = detectDevice();

  if (mode === "explain") {
    return (
      <Sheet onClose={onClose}>
        <div className="loc-hero">
          <IconCrosshair size={26} />
        </div>
        <div className="sheet-title" style={{ textAlign: "center" }}>
          Show yourself on the map
        </div>
        <p className="loc-copy">
          DoorKnock uses your phone&apos;s location to put a blue dot on the map so you can see
          which house you are standing at. Your location stays on your phone — it is never saved
          to your team&apos;s map or shared with anyone.
        </p>
        <p className="loc-copy">
          Your phone will ask next. Tap <strong>Allow</strong> — if you tap don&apos;t allow, it
          stops asking and you have to turn it back on in Settings.
        </p>
        <button className="btn btn-primary btn-block" onClick={onContinue} style={{ marginTop: 6 }}>
          Continue
        </button>
        <button className="btn btn-quiet btn-block" onClick={onClose} style={{ marginTop: 8 }}>
          Not now
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">Location is turned off</div>
      <p className="loc-copy">
        Your phone is set to refuse location for this app, so it will not ask again. A website
        cannot turn it back on for you — it takes a few taps in your settings.
      </p>

      {routesFor(device).map((route, i) => (
        <div key={route.title} className="loc-route">
          <div className="loc-route-title">
            {i + 1}. {route.title}
          </div>
          <ol className="loc-steps">
            {route.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      ))}

      <button className="btn btn-primary btn-block" onClick={onContinue} style={{ marginTop: 16 }}>
        Try again
      </button>
      <p className="loc-footnote">
        You can keep working without location — it only affects the blue dot showing where you
        are. Marking doors works either way.
      </p>
    </Sheet>
  );
}
