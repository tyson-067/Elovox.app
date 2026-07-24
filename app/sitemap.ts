import type { MetadataRoute } from "next";

// Only the public marketing and legal pages. Anything behind auth is left out
// on purpose — it mirrors the disallow list in robots.ts.

const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://elovox.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${BASE}/`, lastModified: now, priority: 1 },
    { url: `${BASE}/pricing`, lastModified: now, priority: 0.8 },
    { url: `${BASE}/terms`, lastModified: now, priority: 0.3 },
    { url: `${BASE}/privacy`, lastModified: now, priority: 0.3 },
  ];
}
