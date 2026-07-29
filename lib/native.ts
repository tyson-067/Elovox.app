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
