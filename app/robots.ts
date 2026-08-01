import type { MetadataRoute } from "next";

// Keeps crawlers off everything that is personal or transactional. A feedback
// report lives at a guessable-ish /report/{id}, and an indexed one would put
// somebody's recording transcript in a search engine, so those are excluded
// alongside the account, API, and post-checkout screens.

const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://elovox.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/account",
        "/report/",
        "/admin",
        "/verify-email",
        // The signed-in app itself. These are client-rendered screens behind
        // RequireAuth: they export no metadata, so a crawler sees ten
        // different URLs all titled "Elovox: Speak with Impact" with no
        // content under them — duplicate, thin, and useless to a searcher who
        // can't sign in anyway. The marketing pages are what should rank.
        "/dashboard",
        "/practice",
        "/progress",
        "/library",
        "/leaderboard",
        "/shop",
        "/social",
        "/interviews",
        "/own",
        "/custom",
      ],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
