import type { MetadataRoute } from "next";

/**
 * The web app manifest.
 *
 * There wasn't one. `public/` held four files total — a logo, an OG card, an
 * llms.txt and a security.txt — so "Add to Home Screen" produced a screenshot
 * of the page as its icon and opened in a Safari tab with browser chrome.
 * For a product whose whole pitch is a sixty-second daily habit, the home
 * screen is exactly where it wants to live.
 *
 * A route file rather than a static public/manifest.json so the colours stay
 * derived from one place and cannot drift from app/layout.tsx's themeColor —
 * which is precisely how that themeColor came to be a shade nothing on the
 * page had used for months.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Elovox: Speak with Impact",
    short_name: "Elovox",
    description:
      "Record a speech, a pitch or an interview answer. Elovox scores it out of 100, marks the words to stress, and counts every filler you didn't hear yourself say.",
    start_url: "/dashboard",
    // The app opens on the Daily Minute, not the marketing page — someone who
    // installed it has already been sold.
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    // Matches themeColor's light entry and the actual page ground.
    theme_color: "#ffffff",
    categories: ["education", "productivity", "lifestyle"],
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
