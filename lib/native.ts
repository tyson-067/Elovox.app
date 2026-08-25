"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Is this the iOS/Android shell rather than a browser?
 *
 * Reads the `data-native` attribute that the inline script in app/layout.tsx
 * stamps on <html> before first paint — NOT the Capacitor bridge directly, so
 * that the CSS (`html[data-native] .web-only`) and any TypeScript branching
 * can never disagree about which one they think this is. One source of truth,
 * set once, synchronously.
 *
 * Returns false during SSR/prerender, which is correct: the static HTML is
 * shared by both clients, and the native-only behavior is applied on the
 * client where the answer is actually known.
 */
export function isNativeApp(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.hasAttribute("data-native");
}

/**
 * Same answer, as a hook, for components that must render identical markup on
 * the server and on the first client paint.
 *
 * React 19 will throw a hydration mismatch if a component reads `data-native`
 * during render, because the server has no idea. So this starts false and
 * flips in an effect — which is fine for the native chrome (it mounts a frame
 * later, on top of a page that was already dark) but is NOT fine for hiding a
 * price. Anything Apple must never see stays on the `.web-only` CSS path,
 * which is settled before first paint.
 *
 * Subscribes to attribute changes rather than assuming the stamp is
 * permanent. In the shipped app it is — stamped pre-paint, never touched —
 * so the observer never fires and costs nothing. In dev it is not: a
 * hydration recovery (React discarding the server DOM and client-rendering,
 * which the `?demo=1` preview mode provokes) rebuilds <html>'s attributes
 * and wipes the stamp, after which the dev script re-asserts it. A
 * subscription that never listens would leave every consumer holding
 * `false` forever after that wipe.
 */
export function useIsNative(): boolean {
  return useSyncExternalStore(subscribeToNative, isNativeApp, () => false);
}

function subscribeToNative(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-native"],
  });
  return () => observer.disconnect();
}

export type Theme = "light" | "dark";

const THEME_KEY = "elovox.theme";

/** The theme the document is currently painted in. */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

/**
 * Switch themes and remember the choice.
 *
 * Writing the attribute is what actually repaints — every screen reads its
 * colors from CSS variables scoped to `html[data-theme]`. The localStorage
 * write is only so the inline script in app/layout.tsx can restore the choice
 * before first paint on the next launch, rather than flashing light and
 * correcting itself.
 */
export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode, or storage full. The theme still applies for this session.
  }
}

/**
 * Live theme value for components that render a switch.
 *
 * Reads the DOM rather than holding its own copy, because the DOM is where the
 * truth is: the pre-paint script writes the attribute before React exists, and
 * a second source of truth would be wrong for the first frame of every launch.
 */
export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    currentTheme,
    () => "light" as Theme
  );
  return [theme, useCallback((t: Theme) => setTheme(t), [])];
}

function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

/**
 * Declare that this screen paints INK under the status bar.
 *
 * The status bar's glyphs are chosen by NativeRuntime, and until the modern
 * pass the only question it had to answer was "is the app in dark mode?" —
 * because in light mode the top of every screen was paper. That stopped being
 * true the moment screens grew ink stages: the Report, the Den and the
 * recording booth are near-black at the top IN LIGHT MODE, and the status bar
 * was still drawing dark glyphs on them. On the Den's violet stage the clock,
 * the wifi bars and the battery were all but invisible.
 *
 * The webview cannot infer this — `viewport-fit=cover` means the app paints
 * under the bar, but nothing tells iOS what colour it painted. So the screen
 * says so, via an attribute the runtime already knows how to watch.
 *
 * Takes the flag as an ARGUMENT rather than being called conditionally, so
 * callers whose stage is conditional (the booth, which is only ink while
 * recording) still call it on every render.
 */
export function useInkTopBar(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const el = document.documentElement;

    // The flag used to be set once and held for the whole screen, which is
    // right only while the ink surface is actually UNDER the status bar. The
    // Den and the report both open on a dark stage and then scroll onto bone
    // paper — and the status bar kept its light glyphs the whole way down, so
    // the clock and the battery went white-on-cream and disappeared. Same on
    // the report. It is a two-line bug that makes the app look broken in
    // screenshots, which is where most people meet it.
    //
    // A takeover is exempt: it covers the viewport and never scrolls away.
    let raf = 0;
    const apply = () => {
      raf = 0;
      const stage = document.querySelector<HTMLElement>(".nv-takeover, .nv-stage");
      let ink = true;
      if (stage && !stage.classList.contains("nv-takeover")) {
        // Real inset rather than a guessed constant — a Dynamic Island phone
        // and a notch phone differ by more than a rounding error.
        const inset =
          parseFloat(getComputedStyle(el).getPropertyValue("--safe-top")) || 47;
        ink = stage.getBoundingClientRect().bottom > inset;
      }
      if (ink) el.setAttribute("data-topbar", "ink");
      else el.removeAttribute("data-topbar");
    };

    apply();
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      el.removeAttribute("data-topbar");
    };
  }, [active]);
}
