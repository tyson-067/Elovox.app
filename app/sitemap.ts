import type { MetadataRoute } from "next";

// Only the public marketing and legal pages. Anything behind auth is left out
// on purpose, it mirrors the disallow list in robots.ts.

const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://elovox.app";

// Hand-maintained, and deliberately not `new Date()`.
//
// Build time is not modification time. Evaluating the date at build made every
// page claim it changed on every deploy, including deploys that only touched
// an API route, so a crawler that recrawled on the signal found the same
// bytes it already had. Do that consistently and the signal stops being read,
// which costs us the one case it exists for: telling Google that the legal
// pages or the pricing really did change.
//
// Update the entry when the page's visible content changes. A stale-but-honest
// date is worth more than a fresh lie.
const MODIFIED: Record<string, string> = {
  "/": "2026-07-31",
  "/about": "2026-07-28", // new page: team + why Elovox exists
  "/pricing": "2026-07-27", // subscriber CTAs → Customer Portal
  "/terms": "2026-07-23",
  "/privacy": "2026-07-31", // tips-list disclosure

  "/for/job-candidates": "2026-07-31", // per-audience landing pages
  "/for/students": "2026-07-31",
  "/for/founders": "2026-07-31",
};

export default function sitemap(): MetadataRoute.Sitemap {
  const priority: Record<string, number> = {
    "/": 1,
    "/about": 0.5,
    "/pricing": 0.8,
    "/terms": 0.3,
    "/privacy": 0.3,
    "/for/job-candidates": 0.7,
    "/for/students": 0.7,
    "/for/founders": 0.7,
  };

  return Object.keys(MODIFIED).map((path) => ({
    url: `${BASE}${path}`,
    lastModified: new Date(`${MODIFIED[path]}T00:00:00Z`),
    priority: priority[path],
  }));
}
