"use client";

import { isNativeApp } from "@/lib/native";

/**
 * The Taptic Engine, wrapped so callers never have to know whether they're in
 * a browser.
 *
 * Why this matters more than it looks: on iOS, touching a control that doesn't
 * answer back is the difference people actually feel between an app and a
 * website, well before they could tell you what's different. Every other tell
 * in the native layer — the dock, the title bar, the transitions — is
 * something you notice. This is one you only notice missing.
 *
 * Everything here is fire-and-forget. A haptic that fails is not an error
 * worth surfacing: the phone may have the engine disabled in Settings, be in
 * Low Power Mode, or be an iPad with no engine at all. In all three cases the
 * tap still did what it was supposed to do.
 */

// The plugin is loaded on first use rather than imported at module scope, so
// the website never pulls Capacitor into its bundle for a call it can't make.
type HapticsModule = typeof import("@capacitor/haptics");
let modulePromise: Promise<HapticsModule> | null = null;

function haptics(): Promise<HapticsModule> | null {
  if (!isNativeApp()) return null;
  modulePromise ??= import("@capacitor/haptics");
  return modulePromise;
}

/**
 * A single light tick. The default for anything that responds to a tap
 * without changing where you are: toggles, steppers, opening a disclosure.
 */
export function tapLight(): void {
  void haptics()?.then(({ Haptics, ImpactStyle }) =>
    Haptics.impact({ style: ImpactStyle.Light })
  ).catch(() => {});
}

/**
 * A firmer knock, for a tap that commits to something — starting a rep,
 * submitting a form, confirming a destructive action.
 */
export function tapMedium(): void {
  void haptics()?.then(({ Haptics, ImpactStyle }) =>
    Haptics.impact({ style: ImpactStyle.Medium })
  ).catch(() => {});
}

/**
 * The detent tick used when a value moves through discrete positions —
 * changing tab, moving through a segmented control, picking from a list.
 * Deliberately lighter than an impact: it marks a change rather than an act.
 */
export function selection(): void {
  void haptics()?.then(({ Haptics }) =>
    Haptics.selectionStart()
      .then(() => Haptics.selectionChanged())
      .then(() => Haptics.selectionEnd())
  ).catch(() => {});
}

/**
 * The double-tap of a completed action. For a finished rep, a delivered
 * score, a new streak — the moments the app is congratulating you.
 */
export function notifySuccess(): void {
  void haptics()?.then(({ Haptics, NotificationType }) =>
    Haptics.notification({ type: NotificationType.Success })
  ).catch(() => {});
}

/** The buzz of something refused: a failed sign-in, a blocked submit. */
export function notifyError(): void {
  void haptics()?.then(({ Haptics, NotificationType }) =>
    Haptics.notification({ type: NotificationType.Error })
  ).catch(() => {});
}
