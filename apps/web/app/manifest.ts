import type { MetadataRoute } from "next";

/**
 * PWA web app manifest — makes the app installable on Android (Add to Home
 * Screen / Play Store TWA) and iOS. Next.js serves this at
 * /manifest.webmanifest and auto-injects the <link rel="manifest"> tag.
 *
 * `display: "standalone"` launches without browser chrome; the maskable icon
 * lets Android apply its adaptive-icon shape without clipping the logo.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Apex — Sports Coaching",
    short_name: "Apex",
    description:
      "Daily readiness, training load, and recovery for athletes and coaches.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f1410",
    theme_color: "#f6f7f3",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
