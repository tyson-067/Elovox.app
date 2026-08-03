"use client";

import { isNativeApp } from "@/lib/native";
import { todayKey, getChallengeState } from "@/lib/daily";

/**
 * The daily practice reminder.
 *
 * These are LOCAL notifications, scheduled on the device, not pushes sent
 * from a server — and that is the right tool rather than a shortcut around
 * the wrong one. A daily nudge is a clock event in the user's own timezone:
 * scheduling it on the phone means it fires at the right local minute with
 * no server, no cron, no timezone column to keep in sync, no APNs key in the
 * delivery path, and it still works with no signal. A remote push would be
 * strictly worse at this job.
 *
 * What remote push is actually for is anything the *server* knows and the
 * phone doesn't — "your friend passed you", a win-back after two weeks gone.
 * That is a separate system and it needs an APNs key uploaded to Firebase
 * before a single notification can be delivered. Nothing here blocks it.
 *
 * Everything is a no-op in a browser.
 */

const SETTINGS_KEY = "elovox.reminder.v1";

/** How many days ahead to schedule.
 *
 * iOS keeps at most 64 pending local notifications per app and silently drops
 * the rest, so this cannot simply be "a year". Fourteen is chosen from the
 * other end: it is how long the reminders keep arriving for someone who never
 * reopens the app, and someone who hasn't opened it in two weeks has stopped
 * using it — another reminder is not what brings them back. Every launch tops
 * the window back up. */
const HORIZON_DAYS = 14;

/** Notification ids are ours to allocate; this range is only the reminders,
 *  so cancelling them can never touch a notification scheduled by something
 *  else later. */
const ID_BASE = 4200;

export interface ReminderSettings {
  enabled: boolean;
  /** "HH:MM", 24-hour, in the device's local time. */
  time: string;
}

/** Early evening: after the working day, before the night is written off.
 *  Practice needs somewhere quiet and about ten minutes. */
export const DEFAULT_TIME = "19:00";

/** Frozen and shared, because this is also the server snapshot — and
 *  useSyncExternalStore compares snapshots by identity, so handing back a
 *  fresh object each render is an infinite loop. */
const DEFAULTS: ReminderSettings = Object.freeze({
  enabled: false,
  time: DEFAULT_TIME,
});

/* The settings are read straight out of localStorage, but a component cannot
   read localStorage while rendering — the server has none, and React would
   see the two renders disagree. So the stored value is mirrored here and
   published through useSyncExternalStore, the same shape lib/native.ts uses
   for the theme. The mirror is also what makes the snapshot identity-stable
   between writes. */
let cached: ReminderSettings | null = null;
const listeners = new Set<() => void>();

function fromStorage(): ReminderSettings {
  if (typeof localStorage === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ReminderSettings>;
    return {
      enabled: parsed.enabled === true,
      time: /^\d{2}:\d{2}$/.test(parsed.time ?? "") ? parsed.time! : DEFAULT_TIME,
    };
  } catch {
    return DEFAULTS;
  }
}

export function readSettings(): ReminderSettings {
  cached ??= fromStorage();
  return cached;
}

export function writeSettings(next: ReminderSettings): void {
  cached = next;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Private mode or storage full. The schedule still applies for this
    // session; it just won't survive a relaunch.
  }
  listeners.forEach((l) => l());
}

/** Subscribe/snapshot pair for useSyncExternalStore. */
export function subscribeSettings(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The settings a server render must assume: the reminder is off until the
 *  device says otherwise. */
export function serverSettings(): ReminderSettings {
  return DEFAULTS;
}

/**
 * Reconcile the saved switch against the real permission.
 *
 * Someone can allow notifications here and revoke them later in Settings,
 * which leaves `enabled: true` saved against a permission that no longer
 * exists — a switch that says the reminder is on when nothing can fire. This
 * corrects the stored value, and the subscribers repaint from it.
 */
export async function reconcilePermission(): Promise<void> {
  const current = readSettings();
  if (!current.enabled) return;
  if (await permissionGranted()) return;
  writeSettings({ ...current, enabled: false });
}

/* --- Copy -----------------------------------------------------------------
   One line per day of the horizon, cycled by day index rather than random so
   the same day never draws the same string twice from two different tops-up.

   Written to be ignorable. A reminder that shouts gets the notification
   switched off within a week, and then there is no reminder at all. Nothing
   here claims a streak is dying or that Felix is disappointed — the app does
   not know what kind of day this person has had. */
const LINES: Array<{ title: string; body: string }> = [
  { title: "Today's speech is up", body: "A couple of minutes out loud is the whole thing." },
  { title: "Ready when you are", body: "One rep, then get on with your evening." },
  { title: "Your daily speech", body: "Felix is listening whenever you've got a minute." },
  { title: "Time to talk", body: "Today's topic is waiting." },
  { title: "One rep today?", body: "It takes about as long as reading this twice." },
  { title: "Today's speech is up", body: "Short one. Say it out loud, see the score." },
  { title: "Your daily speech", body: "Two minutes of practice beats none." },
];

/* --- Scheduling ----------------------------------------------------------- */

type Plugin = typeof import("@capacitor/local-notifications");

function plugin(): Promise<Plugin> | null {
  if (!isNativeApp()) return null;
  return import("@capacitor/local-notifications");
}

/** Has the user allowed notifications? Never asks. */
export async function permissionGranted(): Promise<boolean> {
  const mod = await plugin();
  if (!mod) return false;
  try {
    const { display } = await mod.LocalNotifications.checkPermissions();
    return display === "granted";
  } catch {
    return false;
  }
}

/**
 * Ask for permission, returning whether it was granted.
 *
 * Deliberately never called on launch. iOS gives an app exactly one shot at
 * this prompt — decline it and the only way back is the Settings app, which
 * nobody does — so it is spent at the moment the user switches the reminder
 * on, where the prompt is the obvious consequence of what they just did
 * rather than an ambush during their first ten seconds in the app.
 */
export async function requestPermission(): Promise<boolean> {
  const mod = await plugin();
  if (!mod) return false;
  try {
    const { display } = await mod.LocalNotifications.requestPermissions();
    return display === "granted";
  } catch {
    return false;
  }
}

/**
 * The next `HORIZON_DAYS` firing times, skipping any that have passed.
 *
 * `now` is a parameter so this is checkable without waiting for a Tuesday —
 * the interesting cases are all about *when* it is called (before or after
 * today's slot, on the day a rep was done, across a month boundary).
 */
export function nextFiringTimes(
  time: string,
  skipToday: boolean,
  now: Date = new Date()
): Array<{ at: Date; day: number }> {
  const [hh, mm] = time.split(":").map(Number);
  const out: Array<{ at: Date; day: number }> = [];

  for (let day = 0; day < HORIZON_DAYS; day++) {
    // Built from `now` rather than a fresh Date() per iteration, so a call
    // that straddles midnight can't produce two different "todays".
    const at = new Date(now.getTime());
    at.setDate(now.getDate() + day);
    at.setHours(hh, mm, 0, 0);

    // Today's slot is dropped when today's rep is already done, and also when
    // the time has simply gone by — iOS treats a past date as "deliver now",
    // so scheduling one would fire a reminder the instant the app opens.
    if (day === 0 && (skipToday || at.getTime() <= now.getTime())) continue;
    out.push({ at, day });
  }
  return out;
}

/**
 * Bring the scheduled notifications in line with the settings and with
 * whether today's rep is done. Idempotent: it clears its own ids and lays
 * them down again, so calling it twice is the same as calling it once.
 *
 * Called on launch, on resume, when the setting changes, and after a daily
 * attempt is recorded.
 */
export async function syncReminders(): Promise<void> {
  const mod = await plugin();
  if (!mod) return;
  const { LocalNotifications } = mod;

  try {
    // Always clear first, so turning the reminder off actually removes the
    // pending ones rather than leaving two weeks of them queued.
    const pending = await LocalNotifications.getPending();
    const ours = pending.notifications.filter(
      (n) => n.id >= ID_BASE && n.id < ID_BASE + HORIZON_DAYS
    );
    if (ours.length) {
      await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
    }

    const settings = readSettings();
    if (!settings.enabled) return;
    if (!(await permissionGranted())) return;

    // Whether today is already done. A failure here must not block the
    // schedule — a duplicate nudge on a day you've practised is a much
    // smaller problem than a reminder system that silently stopped.
    let doneToday = false;
    try {
      const state = await getChallengeState(todayKey());
      doneToday = state.complete;
    } catch {
      doneToday = false;
    }

    const slots = nextFiringTimes(settings.time, doneToday);
    if (!slots.length) return;

    await LocalNotifications.schedule({
      notifications: slots.map(({ at, day }) => {
        const line = LINES[day % LINES.length];
        return {
          id: ID_BASE + day,
          title: line.title,
          body: line.body,
          schedule: { at },
          // Read by the tap handler in NativeRuntime to route into the drill
          // rather than dropping the user on whatever screen they left.
          extra: { route: "/practice?daily=1" },
        };
      }),
    });
  } catch {
    // Notifications are a nicety. Nothing above is worth surfacing an error
    // over, and every path that matters is re-run on the next resume.
  }
}

/** Turn the reminder on or off, asking for permission the first time.
 *  Returns the settings actually in force — `enabled` comes back false if
 *  permission was refused, so the switch reflects the truth. */
export async function setEnabled(enabled: boolean): Promise<ReminderSettings> {
  const current = readSettings();

  if (enabled && !(await permissionGranted())) {
    const granted = await requestPermission();
    if (!granted) {
      const off = { ...current, enabled: false };
      writeSettings(off);
      return off;
    }
  }

  const next = { ...current, enabled };
  writeSettings(next);
  await syncReminders();
  return next;
}

/** Move the reminder to a new time of day. */
export async function setTime(time: string): Promise<ReminderSettings> {
  const next = { ...readSettings(), time };
  writeSettings(next);
  await syncReminders();
  return next;
}
