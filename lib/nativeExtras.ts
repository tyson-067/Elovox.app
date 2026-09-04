"use client";

import { registerPlugin } from "@capacitor/core";
import { isNativeApp } from "./native";

/**
 * The Home Screen widget and the Dynamic Island.
 *
 * Both live in a separate process (ios/App/ElovoxWidgets) that shares nothing
 * with the webview but an App Group container, so everything they draw has to
 * be pushed across this bridge — ios/App/App/ElovoxNativePlugin.swift.
 *
 * EVERY CALL HERE IS OPTIONAL AND SILENT. None of it is load-bearing: an
 * Android build, a browser, iOS 15, a phone with Live Activities switched off,
 * or an App Group that was never registered in the developer account all end
 * up in the same place — the promise resolves, nothing happens, and the app
 * behaves exactly as it did before any of this existed. That is deliberate.
 * A speaking-practice app must not fail to record because a widget could not
 * be updated.
 */

interface ElovoxNativePlugin {
  capabilities(): Promise<{
    widgets: boolean;
    liveActivities: boolean;
    sharedStorage: boolean;
  }>;
  setWidgetData(options: {
    streak: number;
    topic: string;
    attemptsLeft: number;
    /** Today's best score, or -1 when nothing has been recorded yet. */
    bestToday: number;
  }): Promise<{ written: boolean }>;
  startTake(options: {
    seconds: number;
    topic: string;
    attempt: number;
    totalAttempts: number;
  }): Promise<{ started: boolean }>;
  endTake(): Promise<void>;
  prepareAudioSession(): Promise<{ category: string; changed: boolean }>;
}

/**
 * `registerPlugin` with no web implementation: on the web the proxy rejects
 * with "not implemented", which every caller below swallows. Registering it
 * unconditionally (rather than behind isNativeApp) keeps the module free of a
 * second code path that only runs in one client.
 */
const ElovoxNative = registerPlugin<ElovoxNativePlugin>("ElovoxNative");

export interface WidgetState {
  streak: number;
  topic: string;
  attemptsLeft: number;
  /** null when nothing has been recorded today. */
  bestToday: number | null;
}

/**
 * Tell the Home Screen widget what today looks like.
 *
 * Called from the Ladder, which is the one screen that already holds every
 * number involved — pushing from there means the widget is refreshed exactly
 * when the user has seen the same figures, and never on a timer.
 */
export async function publishWidgetState(state: WidgetState): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await ElovoxNative.setWidgetData({
      streak: state.streak,
      topic: state.topic,
      attemptsLeft: state.attemptsLeft,
      bestToday: state.bestToday ?? -1,
    });
  } catch {
    // No plugin (Android, web, an older build of the shell). Nothing to do.
  }
}

/** Put the running take in the Dynamic Island and on the Lock Screen. */
export async function startTakeActivity(options: {
  seconds: number;
  topic: string;
  attempt: number;
  totalAttempts: number;
}): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await ElovoxNative.startTake(options);
  } catch {
    /* Unsupported, disabled, or throttled. The take runs regardless. */
  }
}

/**
 * Take it down.
 *
 * Called on finish, on discard, AND on unmount — a recording screen has three
 * ways out and a Live Activity left running after the last of them is the
 * single most annoying thing this feature could do to someone.
 */
export async function endTakeActivity(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await ElovoxNative.endTake();
  } catch {
    /* Nothing running, or no plugin. */
  }
}


/**
 * Make sure Felix will be heard: put the app's audio session in a category
 * that plays through the ringer switch.
 *
 * Web Audio in a WKWebView is silenced by the phone's mute switch under the
 * default (`soloAmbient`) session category, the way a game's sound effects
 * are; a media element's playback is not. The native side sets `.playback`
 * at launch and whenever the app comes to the front, but WebKit sets the
 * category to its own taste as media starts and stops, and a recording just
 * made in the booth is exactly such a change. So the engine asks again, in
 * the tap, right before it fetches the take.
 *
 * Fire-and-forget like everything else here: the bridge call resolves in a
 * few milliseconds, long before the audio arrives, and a shell without the
 * method (an older build) simply plays as it did before.
 */
export async function preparePlayback(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await ElovoxNative.prepareAudioSession();
  } catch {
    // Older shell without the method, or the bridge is unavailable. Felix
    // plays anyway, at the mercy of the switch.
  }
}
