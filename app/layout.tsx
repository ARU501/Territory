import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "DoorKnock — Territory & Door Tracking",
  description:
    "Draw a territory on the map, pull in every house inside it, and track who knocked what — live across your whole team.",
  appleWebApp: { capable: true, title: "DoorKnock", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays available: blocking it fails WCAG and hurts anyone who
  // needs larger text. Leaflet claims its own gestures over the map, so
  // pinching the map still zooms the map rather than the page.
  maximumScale: 5,
  userScalable: true,
  themeColor: "#0f172a",
  viewportFit: "cover",
  // Shrink the layout for the keyboard instead of scrolling it out of view,
  // so the notes field stays visible while a rep types.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
