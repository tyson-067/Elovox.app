import type { Session } from "./types";
import type { User } from "firebase/auth";
import { isFirebaseConfigured, getDb, getUser } from "./firebase";

// Session persistence. When Firebase is configured and someone is signed
// in, sessions live in Firestore under users/{uid}/sessions/{id} (private
// history enforced by security rules). Without Firebase config — or before
// sign-in — the app still works, persisting to localStorage.

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

function localSave(session: Session): void {
  const sessions = localList().filter((s) => s.id !== session.id);
  sessions.push(session);
  window.localStorage.setItem(KEY, JSON.stringify(sessions));
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

export async function deleteSession(id: string): Promise<void> {
  const user = await firestoreUser();
  if (!user) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        KEY,
        JSON.stringify(localList().filter((s) => s.id !== id))
      );
    }
    return;
  }
  const { doc, deleteDoc } = await import("firebase/firestore");
  const col = await sessionsCollection(user);
  await deleteDoc(doc(col, id));
}
