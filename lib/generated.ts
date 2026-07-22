"use client";

import { isFirebaseConfigured, getUser } from "./firebase";

// Speeches Felix writes on demand (Premium): replacements for a library
// speech you've outgrown, and fully custom ones written to a brief.
//
// A generated speech is handed to the practice screen through
// sessionStorage rather than the URL — the text is far too long for a
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
    // storage blocked — practice screen shows its "expired" message
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
    if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
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

const REPLACEMENTS_KEY = "elovox.replacements.v1";

export type ReplacementMap = Record<string, GeneratedSpeech>;

// Exposed to React through useSyncExternalStore rather than an effect, so
// the dashboard reads localStorage without a cascading render and without
// an SSR hydration mismatch (the server snapshot is simply empty).
// The snapshot must be reference-stable between writes or the store loops.

const EMPTY: ReplacementMap = {};
let snapshot: ReplacementMap | null = null;
const listeners = new Set<() => void>();

function loadFromStorage(): ReplacementMap {
  try {
    const raw = window.localStorage.getItem(REPLACEMENTS_KEY);
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
  if (snapshot === null) snapshot = loadFromStorage();
  return snapshot;
}

/** Server render has no localStorage — everyone starts with the originals. */
export function replacementsServerSnapshot(): ReplacementMap {
  return EMPTY;
}

export function saveReplacement(slotId: string, speech: GeneratedSpeech): void {
  snapshot = { ...replacementsSnapshot(), [slotId]: speech };
  try {
    window.localStorage.setItem(REPLACEMENTS_KEY, JSON.stringify(snapshot));
  } catch {
    // non-fatal — the speech still works for this session
  }
  listeners.forEach((l) => l());
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
