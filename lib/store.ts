import type { Session } from "./types";
import type { User } from "firebase/auth";
import { isFirebaseConfigured, getDb, getUser } from "./firebase";

// Session persistence. When Firebase is configured and someone is signed
// in, sessions live in Firestore under users/{uid}/sessions/{id} (private
// history enforced by security rules). Without Firebase config, or before
// sign-in, the app still works, persisting to localStorage.

const KEY = "elovox.sessions.v1";

// --- localStorage fallback -------------------------------------------------

function localList(): Session[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const sessions: Session[] = raw ? JSON.parse(raw) : [];
    return sessions.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/**
 * Signed-out history lives in localStorage, which is a few megabytes and
 * never gets any bigger. Each session carries a full analysis, so a regular
 * user WILL reach the quota — and an unguarded write throws
 * QuotaExceededError right out of saveSession, surfacing as "something went
 * wrong saving that" on a take that recorded and analyzed perfectly.
 *
 * So: on a full store, drop the oldest sessions and keep the new one. Losing
 * the tail of a local history beats losing the rep just finished, and anyone
 * signed in has the real history in Firestore regardless.
 */
function localSave(session: Session): void {
  const sessions = localList().filter((s) => s.id !== session.id);
  sessions.push(session);
  // Newest first, so trimming from the end drops the oldest.
  sessions.sort((a, b) => b.createdAt - a.createdAt);

  for (let keep = sessions.length; keep > 0; keep--) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(sessions.slice(0, keep)));
      return;
    } catch {
      // Full. Halve what we're trying to keep and try again, never dropping
      // below the session we were asked to save.
      if (keep === 1) return; // even one won't fit; nothing more we can do
      keep = Math.ceil(keep / 2) + 1; // +1, the loop decrements
    }
  }
}

// --- Firestore -------------------------------------------------------------

async function sessionsCollection(user: User) {
  const { collection } = await import("firebase/firestore");
  return collection(getDb(), "users", user.uid, "sessions");
}

/** Signed-in user, or null when Firebase is absent / nobody is signed in. */
async function firestoreUser(): Promise<User | null> {
  if (!isFirebaseConfigured()) return null;
  return getUser();
}

// --- Public API ------------------------------------------------------------

export async function listSessions(): Promise<Session[]> {
  const user = await firestoreUser();
  if (!user) return localList();
  const { getDocs, query, orderBy } = await import("firebase/firestore");
  const col = await sessionsCollection(user);
  const snap = await getDocs(query(col, orderBy("createdAt", "desc")));
  return snap.docs.map((d) => d.data() as Session);
}

export async function getSession(id: string): Promise<Session | undefined> {
  const user = await firestoreUser();
  if (!user) {
    return localList().find((s) => s.id === id);
  }
  const { doc, getDoc } = await import("firebase/firestore");
  const col = await sessionsCollection(user);
  const snap = await getDoc(doc(col, id));
  return snap.exists() ? (snap.data() as Session) : undefined;
}

export async function saveSession(session: Session): Promise<void> {
  const user = await firestoreUser();
  if (!user) {
    localSave(session);
    return;
  }
  const { doc, setDoc } = await import("firebase/firestore");
  const col = await sessionsCollection(user);
  // Firestore rejects undefined field values; JSON round-trip drops the
  // optional transcript fields (mark/time/note) that are unset.
  await setDoc(doc(col, session.id), JSON.parse(JSON.stringify(session)));
}

/** Why a session was deleted; mirrors the closed set /api/session/delete accepts. */
export type DeleteReason =
  | "mic-test"
  | "interrupted"
  | "wrong-scenario"
  | "privacy"
  | "other";

/**
 * Deletes one session, with the reason the user picked. Signed in, this goes
 * through /api/session/delete — firestore.rules denies client deletes so the
 * small daily cap can actually be counted. Signed out, history is only
 * localStorage on this device: nothing ranked, nothing shared, so it's a
 * plain local remove with no cap.
 *
 * Resolves to ok:false with a human message rather than throwing, because
 * "you've used today's delete" is an answer, not an error.
 */
export async function deleteSession(
  id: string,
  reason: DeleteReason
): Promise<{ ok: boolean; message?: string }> {
  const user = await firestoreUser();
  if (!user) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        KEY,
        JSON.stringify(localList().filter((s) => s.id !== id))
      );
    }
    return { ok: true };
  }
  try {
    const res = await fetch("/api/session/delete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ sessionId: id, reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok || res.status === 404) {
      // 404 = already gone; from the user's side that IS deleted.
      return { ok: true };
    }
    return {
      ok: false,
      message: data.message || data.error || "Couldn't delete that just now.",
    };
  } catch {
    return { ok: false, message: "Couldn't delete that just now." };
  }
}
