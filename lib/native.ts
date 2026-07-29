"use client";

import { useCallback, useSyncExternalStore } from "react";

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
 * shared by both clients, and the native-only behaviour is applied on the
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
 */
export function useIsNative(): boolean {
  return useSyncExternalStore(subscribeNever, isNativeApp, () => false);
}

/** `data-native` is stamped once, before paint, and never changes after. */
function subscribeNever(): () => void {
  return () => {};
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
 * colours from CSS variables scoped to `html[data-theme]`. The localStorage
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
