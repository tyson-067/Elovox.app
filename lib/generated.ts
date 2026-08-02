"use client";

import { isFirebaseConfigured, getUser, getAuthInstance } from "./firebase";
import { getAppCheckToken } from "./appCheck";

// Speeches Felix writes on demand (Premium): replacements for a library
// speech you've outgrown, and fully custom ones written to a brief.
//
// A generated speech is handed to the practice screen through
// sessionStorage rather than the URL, the text is far too long for a
// query string, and it only has to survive one navigation.

export interface GeneratedSpeech {
  id: string;
  title: string;
  scenario: string;
  text: string;
  topic: string;
}

const key = (id: string) => `elovox.generated.${id}`;

export function stashGeneratedSpeech(speech: GeneratedSpeech): string {
  try {
    window.sessionStorage.setItem(key(speech.id), JSON.stringify(speech));
  } catch {
    // storage blocked, practice screen shows its "expired" message
  }
  return speech.id;
}

export function readGeneratedSpeech(id: string): GeneratedSpeech | null {
  try {
    const raw = window.sessionStorage.getItem(key(id));
    return raw ? (JSON.parse(raw) as GeneratedSpeech) : null;
  } catch {
    return null;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (isFirebaseConfigured()) {
    const user = await getUser();
    if (user) {
      // ID token = who; App Check token = proof this came from our real
      // client, so a script can't drive paid Gemini calls with just a token.
      // Both fetched together; the App Check header is omitted when a token
      // can't be minted, and the server soft-fails a missing one. See
      // getAppCheckToken in lib/appCheck.ts.
      const [idToken, appCheckToken] = await Promise.all([
        user.getIdToken(),
        getAppCheckToken(),
      ]);
      headers.Authorization = `Bearer ${idToken}`;
      if (appCheckToken) headers["X-Firebase-AppCheck"] = appCheckToken;
    }
  }
  return headers;
}

async function requestSpeech(body: Record<string, unknown>): Promise<GeneratedSpeech> {
  const res = await fetch("/api/speech", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Felix couldn't write that one. Try again.");
  }
  return (await res.json()) as GeneratedSpeech;
}

/**
 * Replaces a speech the user has finished with. "similar" keeps drilling
 * the same muscle in a new situation; "different" moves them to another
 * emotional register entirely.
 */
export function regenerateSpeech(opts: {
  previousTitle: string;
  previousTopic: string;
  relation: "similar" | "different";
  durationSec?: number;
}): Promise<GeneratedSpeech> {
  return requestSpeech({
    kind: "regenerate",
    previousTitle: opts.previousTitle,
    previousTopic: opts.previousTopic,
    relation: opts.relation,
    durationSec: opts.durationSec ?? 30,
  });
}

// --- Library replacements ------------------------------------------------
// When a Premium user retires a library speech, the replacement takes over
// that slot on their dashboard for good. Stored per-device in localStorage:
// it's a personalization, not data worth a Firestore round trip on load.

// uid-scoped, like every other per-user key (elovox.plan.${uid} etc.). An
// un-scoped key let two accounts on one device share replacements, so account
// B saw account A's Felix-written speeches.
function currentUid(): string {
  try {
    return isFirebaseConfigured()
      ? getAuthInstance().currentUser?.uid ?? "anon"
      : "anon";
  } catch {
    return "anon";
  }
}
const replacementsKey = () => `elovox.replacements.v1.${currentUid()}`;

export type ReplacementMap = Record<string, GeneratedSpeech>;

// Exposed to React through useSyncExternalStore rather than an effect, so
// the dashboard reads localStorage without a cascading render and without
// an SSR hydration mismatch (the server snapshot is simply empty).
// The snapshot must be reference-stable between writes or the store loops.

const EMPTY: ReplacementMap = {};
let snapshot: ReplacementMap | null = null;
// The uid the cached snapshot was loaded for; if the account changes (a
// sign-out/in without a full reload), the cache is reloaded for the new user
// so one account never renders another's replacements.
let snapshotUid = "";
const listeners = new Set<() => void>();

function loadFromStorage(): ReplacementMap {
  try {
    const raw = window.localStorage.getItem(replacementsKey());
    return raw ? (JSON.parse(raw) as ReplacementMap) : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function subscribeReplacements(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function replacementsSnapshot(): ReplacementMap {
  const uid = currentUid();
  if (snapshot === null || snapshotUid !== uid) {
    snapshot = loadFromStorage();
    snapshotUid = uid;
  }
  return snapshot;
}

/** Server render has no localStorage, everyone starts with the originals. */
export function replacementsServerSnapshot(): ReplacementMap {
  return EMPTY;
}

export function saveReplacement(slotId: string, speech: GeneratedSpeech): void {
  snapshot = { ...replacementsSnapshot(), [slotId]: speech };
  snapshotUid = currentUid();
  try {
    window.localStorage.setItem(replacementsKey(), JSON.stringify(snapshot));
  } catch {
    // non-fatal, the speech still works for this session
  }
  listeners.forEach((l) => l());
}

// --- Generated interview banks -------------------------------------------
// A bank Felix wrote costs a Gemini call and describes a real interview the
// user is preparing for, so it should survive a refresh or a trip to the
// report screen and back. sessionStorage rather than localStorage: the tab
// closing is the right expiry for "the interview I'm prepping for right
// now", and it keeps a description of someone's job search off the disk.
// Keyed by interview type, so prepping for two different panels doesn't make
// them overwrite each other.

export interface InterviewBank {
  questions: string[];
  situation: string;
  at: number;
}

const bankKey = (interviewId: string) => `elovox.interviewbank.${interviewId}`;

export function stashInterviewBank(
  interviewId: string,
  bank: InterviewBank
): void {
  try {
    window.sessionStorage.setItem(bankKey(interviewId), JSON.stringify(bank));
  } catch {
    // Storage blocked. The bank still works for this screen, it just won't
    // survive a navigation.
  }
}

export function readInterviewBank(interviewId: string): InterviewBank | null {
  try {
    const raw = window.sessionStorage.getItem(bankKey(interviewId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<InterviewBank>;
    // Anything malformed reads as "no bank" rather than throwing into the
    // render: this is parsed during the initial state calculation.
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.filter(
          (q): q is string => typeof q === "string" && q.trim().length > 0
        )
      : [];
    if (questions.length === 0) return null;
    return {
      questions,
      situation: typeof parsed.situation === "string" ? parsed.situation : "",
      at: typeof parsed.at === "number" ? parsed.at : Date.now(),
    };
  } catch {
    return null;
  }
}

export function clearInterviewBank(interviewId: string): void {
  try {
    window.sessionStorage.removeItem(bankKey(interviewId));
  } catch {
    // non-fatal
  }
}

/**
 * Felix writes an interview question bank for the user's actual situation.
 * Same route and the same Premium gate as the speech writing, but it returns
 * a list of questions rather than a speech, so it doesn't go through
 * `requestSpeech`.
 */
export async function requestInterviewQuestions(opts: {
  situation: string;
  panel?: string;
}): Promise<string[]> {
  const res = await fetch("/api/speech", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ kind: "interview", ...opts }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Felix couldn't write those. Try again.");
  }
  const data = (await res.json()) as { questions?: unknown };
  const questions = Array.isArray(data.questions)
    ? data.questions.filter((q): q is string => typeof q === "string" && !!q.trim())
    : [];
  if (questions.length === 0) {
    throw new Error("Felix couldn't write those. Try again.");
  }
  return questions;
}

/** Felix writes a speech to order, from the user's own brief. */
export function requestCustomSpeech(opts: {
  need: string;
  audience?: string;
  occasion?: string;
  tone?: string;
  durationSec?: number;
}): Promise<GeneratedSpeech> {
  return requestSpeech({ kind: "custom", ...opts, durationSec: opts.durationSec ?? 60 });
}
