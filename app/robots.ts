import type { MetadataRoute } from "next";

// Keeps crawlers off everything that is personal or transactional. A feedback
// report lives at a guessable-ish /report/{id}, and an indexed one would put
// somebody's recording transcript in a search engine — so those are excluded
// alongside the account, API, and post-checkout screens.

const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://elovox.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/account", "/report/", "/onboarding"],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
