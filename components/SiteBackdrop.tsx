"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { BackdropScene } from "@/components/Backdrop";
import { isBackdropId } from "@/lib/coins";
import { fetchShopState } from "@/lib/shop";
import { useIsNative } from "@/lib/native";

// The purchased site backdrop, painted behind the entire website.
//
// This is a WEBSITE feature, full stop. Inside the iOS shell the native theme
// owns every surface, and a decorative scene under the dock would read as a
// rendering bug — so this returns null under useIsNative() AND carries
// `native-hide`, which `html[data-native]` hides in CSS. Two mechanisms on
// purpose: the hook settles a frame after hydration, and the class covers
// that frame.
//
// Layering: fixed, full-viewport, z-[-1]. The site's default gradient is
// body::before at the same z-index (see globals.css); this element comes
// later in the DOM, so when it renders it paints over the gradient, and when
// nothing is equipped it renders nothing at all and the gradient stays —
// plain is the absence of an item, not an item.
export function SiteBackdrop() {
  const { user } = useAuth();
  const isNative = useIsNative();
  // Keyed by the uid it was fetched FOR and only read back under that uid:
  // signing out needs no reset-in-effect (the compiler lint rightly flags
  // those as cascade risks), and the next account on this browser can never
  // inherit the last one's sky.
  const [fetched, setFetched] = useState<{ uid: string; id: string | null } | null>(null);
  const uid = user?.uid ?? null;

  // One read per sign-in, not a subscription. A backdrop changes when the
  // user changes it in the shop, and the shop tells us directly (below) —
  // polling Firestore for a decoration would be paying for nothing.
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    fetchShopState()
      .then((s) => {
        if (!cancelled) setFetched({ uid, id: s.equippedBackdrop });
      })
      .catch(() => {
        // Failed read = plain site. A backdrop is not worth an error state.
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // The shop page dispatches this after a successful equip/unequip, so the
  // scene changes behind the shop the moment the server says yes — without
  // this, the buyer would have to reload to see the thing they just bought.
  useEffect(() => {
    if (!uid) return;
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<string | null>).detail;
      setFetched({ uid, id: typeof detail === "string" ? detail : null });
    };
    window.addEventListener("elovox:backdrop", onChange);
    return () => window.removeEventListener("elovox:backdrop", onChange);
  }, [uid]);

  const equipped = uid && fetched?.uid === uid ? fetched.id : null;
  // isBackdropId also quietly retires anything stale: an equipped id left in
  // Firestore by a removed catalog entry falls back to the plain site rather
  // than crashing BackdropScene. Same stance as Biome's unknown-id fallback.
  if (isNative || !uid || !isBackdropId(equipped)) return null;

  return (
    <div
      aria-hidden="true"
      className="native-hide pointer-events-none fixed inset-0 z-[-1]"
    >
      <BackdropScene id={equipped} className="h-full w-full" />
    </div>
  );
}
