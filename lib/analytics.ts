import { track } from "@vercel/analytics";

// Product events, on the same cookieless Vercel Analytics the layout already
// loads (app/layout.tsx). No identifier, no content: an event is a name and a
// handful of enumerated properties, enough to answer "do people who hear
// Felix practise again more often" and nothing that could be read back as a
// transcript or a score.
//
// One function so a property that shouldn't leave the browser has exactly
// one place to be refused, and so a test can mock one module.

export type FelixEvent =
  | "felix_feedback_shown"
  | "felix_feedback_played"
  | "felix_feedback_completed"
  | "felix_feedback_replayed"
  | "felix_try_again_clicked";

export type EventProps = Record<string, string | number | boolean>;

export function trackEvent(name: FelixEvent, props?: EventProps): void {
  try {
    track(name, props);
  } catch {
    // Analytics must never be a reason a page misbehaves.
  }
}
