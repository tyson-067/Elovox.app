"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { BackdropScene, backdropTone } from "@/components/Backdrop";
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
// Layering: fixed, full-viewport, z-[-1]. Nothing else paints behind the
// page — body's white background propagates to the canvas, and a negative
// z-index child paints over the canvas and under every surface, so this
// lands in exactly the right place. When nothing is equipped it renders
// nothing at all and the site is white paper: plain is the absence of an
// item, not an item.
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
  const showing = !isNative && uid && isBackdropId(equipped) ? equipped : null;
  const tone = showing ? backdropTone(showing) : null;

  // Tell the document which ink the page has to write in. The site's text
  // colors are all tuned for the pale default ground, and half these scenes
  // are night — near-black body copy on Starry night is 1.02:1, which is not
  // low contrast, it is invisible. globals.css reads this attribute and
  // re-points the ink; surfaces with their own background (cards, the
  // header, the footer) put it straight back, because a white card still
  // wants dark text no matter what the sky is doing behind it.
  //
  // An attribute on <html> rather than a class on a wrapper: the chrome that
  // needs it — header, footer, banner — are siblings of <main>, not children
  // of anything this component renders.
  useEffect(() => {
    const el = document.documentElement;
    if (!tone) {
      el.removeAttribute("data-backdrop-tone");
      return;
    }
    el.setAttribute("data-backdrop-tone", tone);
    return () => el.removeAttribute("data-backdrop-tone");
  }, [tone]);

  if (!showing) return null;

  return (
    <div
      aria-hidden="true"
      className="native-hide pointer-events-none fixed inset-0 z-[-1]"
    >
      <BackdropScene id={showing} className="h-full w-full" />
    </div>
  );
}
