"use client";

import { useEffect, useState } from "react";

// The operator announcement bar, set from /admin → Ops ("maintenance tonight
// 9-10pm", "new speech pack is live"). Renders nothing at all unless a
// banner is set — the overwhelmingly common case costs one cached fetch and
// zero layout. Web only: the parent wraps it in `native-hide`, keeping the
// native shell's chrome (and Apple review) untouched.
//
// Fail-silent by design: any fetch problem means no banner, never an error.
// The text renders as a text node — no markup, no links, nothing clickable.

export function SiteBanner() {
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/flags")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (typeof data.banner === "string" && data.banner.trim()) {
          setBanner(data.banner.trim());
        }
      })
      .catch(() => {
        // no banner is always an acceptable outcome
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!banner) return null;

  return (
    <p
      role="status"
      className="border-b border-primary/10 bg-surface-container px-4 py-2 text-center text-[13px] font-medium text-primary"
    >
      {banner}
    </p>
  );
}
