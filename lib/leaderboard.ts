"use client";

import { isFirebaseConfigured, getDb, getUser } from "./firebase";

// Browser half of the leaderboard. Reads only — every number here was
// computed by the server (lib/leaderboardServer.ts) and this file has no way
// to change any of it, which is the point.
//
// The rows are read straight out of Firestore rather than through an API
// route: firestore.rules makes `leaderboard` readable by any signed-in user
// and writable by none, so a route would add a hop without adding a guarantee.

/** How many rows the board shows before it falls back to "and you, at #N". */
export const BOARD_SIZE = 10;

export interface BoardRow {
  uid: string;
  handle: string | null;
  xp: number;
  level: number;
  streakDays: number;
  /** Filled in by the reader, 1-based, and only meaningful within one board. */
  rank: number;
  isSelf: boolean;
}

export interface Board {
  rows: BoardRow[];
  /**
   * The signed-in user's row when they are NOT in `rows`, so the UI can pin
   * them at the bottom. Null when they're already visible, or have no row yet.
   */
  self: BoardRow | null;
}

const EMPTY: Board = { rows: [], self: null };

type RawRow = { handle?: unknown; xp?: unknown; level?: unknown; streakDays?: unknown };

function toRow(uid: string, data: RawRow, rank: number, selfUid: string | null): BoardRow {
  return {
    uid,
    // A row can legitimately exist without a handle: XP is published on the
    // first scored rep, whereas naming yourself is optional. Render those as
    // anonymous rather than dropping them, or the ranks would lie.
    handle: typeof data.handle === "string" && data.handle ? data.handle : null,
    xp: Number(data.xp ?? 0),
    level: Number(data.level ?? 1),
    streakDays: Number(data.streakDays ?? 0),
    rank,
    isSelf: uid === selfUid,
  };
}

/** The global top N, plus the signed-in user pinned on if they missed the cut. */
export async function fetchGlobalBoard(): Promise<Board> {
  if (!isFirebaseConfigured()) return EMPTY;
  const user = await getUser();
  if (!user) return EMPTY;

  const { collection, doc, getDoc, getDocs, getCountFromServer, limit, orderBy, query, where } =
    await import("firebase/firestore");
  const db = getDb();
  const col = collection(db, "leaderboard");

  const top = await getDocs(query(col, orderBy("xp", "desc"), limit(BOARD_SIZE)));
  const rows = top.docs.map((d, i) => toRow(d.id, d.data() as RawRow, i + 1, user.uid));
  if (rows.some((r) => r.isSelf)) return { rows, self: null };

  const mine = await getDoc(doc(db, "leaderboard", user.uid));
  if (!mine.exists()) return { rows, self: null };

  // Rank by counting everyone above you rather than reading the whole
  // collection: an aggregation query is one billed read regardless of how
  // many users there are, and this number is the only reason to look at the
  // rest of the board at all.
  const data = mine.data() as RawRow;
  const above = (
    await getCountFromServer(query(col, where("xp", ">", Number(data.xp ?? 0))))
  ).data().count;
  // Fewer than BOARD_SIZE users strictly above means this viewer ties into the
  // board that's already shown; the top query just returned a different tied
  // member. Pinning them then would show a rank that collides with the podium
  // ("#1 … you" under ten other rows), so don't pin — they're already there.
  if (above < BOARD_SIZE) return { rows, self: null };
  return { rows, self: toRow(user.uid, data, above + 1, user.uid) };
}

/**
 * The signed-in user and their friends, ranked among themselves.
 *
 * Friendships live at users/{uid}/friends/{friendUid} and are server-written
 * only, so this list can't be padded with strangers. Until the invite flow
 * ships there is nothing in it, and the board is just you.
 */
export async function fetchFriendsBoard(): Promise<Board> {
  if (!isFirebaseConfigured()) return EMPTY;
  const user = await getUser();
  if (!user) return EMPTY;

  const { collection, doc, getDoc, getDocs } = await import("firebase/firestore");
  const db = getDb();

  const friends = await getDocs(collection(db, "users", user.uid, "friends"));
  const uids = [user.uid, ...friends.docs.map((d) => d.id)];

  // One read per friend. Fine at the scale a friends list actually reaches,
  // and it avoids an `in` query capped at thirty ids.
  const snaps = await Promise.all(
    uids.map((uid) => getDoc(doc(db, "leaderboard", uid)))
  );

  const rows = snaps
    .filter((s) => s.exists())
    .map((s) => ({ uid: s.id, data: s.data() as RawRow }))
    .sort((a, b) => Number(b.data.xp ?? 0) - Number(a.data.xp ?? 0))
    .map((r, i) => toRow(r.uid, r.data, i + 1, user.uid));

  return { rows, self: null };
}

/** This user's current handle, or null if they've never set one. */
export async function fetchMyHandle(): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  const user = await getUser();
  if (!user) return null;
  const { doc, getDoc } = await import("firebase/firestore");
  const snap = await getDoc(doc(getDb(), "leaderboard", user.uid));
  const handle = snap.data()?.handle;
  return typeof handle === "string" && handle ? handle : null;
}

/**
 * A starting suggestion, never applied on its own. First name plus a last
 * initial: recognizable to someone who invited you, not a legal name on a
 * public page. The user can replace it with anything that validates.
 */
export function suggestHandle(displayName: string | null | undefined): string {
  const parts = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 20);
  return `${parts[0]} ${parts[parts.length - 1][0]}.`.slice(0, 20);
}

export async function saveHandle(handle: string): Promise<{ error?: string }> {
  const user = await getUser();
  if (!user) return { error: "Sign in first." };
  try {
    const res = await fetch("/api/leaderboard/handle", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ handle }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.error ?? "Couldn't save that." };
    return {};
  } catch {
    return { error: "Couldn't reach the server." };
  }
}
