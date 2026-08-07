"use client";

import { isNativeApp } from "./native";

/**
 * The system share sheet.
 *
 * WHAT IS SHARED, AND WHAT IS NOT. A report holds a transcript of something
 * the user said out loud in private, plus Felix's notes on it. None of that
 * leaves the device through this: the sheet carries the score, what was
 * practised, and a link to the app. Sharing a rep is a brag, not a
 * disclosure, and the one thing a share sheet must never do is put a
 * paragraph the user forgot they recorded into a group chat.
 *
 * Renders nowhere on the web — the browser has `navigator.share`, but the web
 * report already has its own affordances and this is the app's tell, not the
 * site's.
 */

/* No score gate on the button. Hiding "share" below some threshold would
   make a control appear and disappear between reports — which users read as
   a bug — and it would be the app deciding which of your takes you are
   allowed to be pleased with. */

export interface ShareTake {
  score: number;
  /** What they practised: the speech title, or the day's topic. */
  title: string;
}

/**
 * True when the platform can actually present a sheet. Checked before a
 * button is rendered rather than after it is pressed: a control that opens
 * nothing is worse than no control.
 */
export function canShare(): boolean {
  return isNativeApp();
}

/**
 * Present the sheet. Fire-and-forget by design — a user who swipes the sheet
 * away has not hit an error, and `Share.share` rejects on that dismissal in
 * exactly the same way it rejects on a real failure. There is nothing useful
 * to tell them either way.
 */
export async function shareTake(take: ShareTake): Promise<void> {
  if (!canShare()) return;
  try {
    const { Share } = await import("@capacitor/share");
    await Share.share({
      title: "Elovox",
      // One line, because a share sheet's text field is one line on most of
      // the places it lands. The score leads: it is the only part anyone
      // reading it in a group chat will react to.
      text: `I scored ${take.score} on "${take.title}" in Elovox.`,
      url: "https://elovox.app",
      dialogTitle: "Share this take",
    });
  } catch {
    // Dismissed, or the sheet failed. Both are silence.
  }
}
