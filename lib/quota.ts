import { FieldValue, type Firestore } from "firebase-admin/firestore";

// Server-authoritative free-tier metering. The whole point is that this is
// the ONE place the daily cap is enforced for real: the client's attempt
// bookkeeping (lib/daily.ts) drives the UI, but a determined user can edit
// localStorage or call /api/analyze directly, so it can't be trusted to
// protect the paid AssemblyAI + Gemini pipeline.
//
// The counter lives at users/{uid}/usage/{date}.dailyAnalyses and is written
// ONLY through the Admin SDK, which bypasses security rules. firestore.rules
// lets the user read it (so the UI can show attempts remaining) but denies
// every client write — so the number can't be forged.

export const MAX_FREE_DAILY_ATTEMPTS = 3;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC day key (YYYY-MM-DD), from server time — never client input. */
function utcDateKey(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * The date the attempt should count against. "Today" is the user's LOCAL day
 * so the cap resets when their daily challenge does — but the client supplies
 * that day, so we only trust it when it's within one day of the server's UTC
 * date. That preserves correct local-midnight resets for honest users while
 * bounding a tamperer to yesterday/today/tomorrow — at most 3× the cap across
 * the boundary, never an infinite reset by inventing far-off dates.
 */
export function usageDateKey(clientDate: string, now: number = Date.now()): string {
  const today = utcDateKey(now);
  if (!DATE_RE.test(clientDate)) return today;
  const a = Date.parse(`${clientDate}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a)) return today;
  return Math.abs(Math.round((a - b) / 86_400_000)) <= 1 ? clientDate : today;
}

function usageRef(db: Firestore, uid: string, date: string) {
  return db.doc(`users/${uid}/usage/${date}`);
}

/**
 * Atomically claim one of the day's free attempts. Returns ok:false (without
 * incrementing) when the cap is already spent. Reserving up front — rather
 * than counting after the fact — means concurrent requests can't slip past
 * the limit. A failed analysis is handed back with refundFreeDailyAttempt so
 * the user is never charged an attempt for Felix having a bad moment.
 */
export async function reserveFreeDailyAttempt(
  db: Firestore,
  uid: string,
  date: string
): Promise<{ ok: boolean; used: number }> {
  const ref = usageRef(db, uid, date);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = snap.exists ? Number(snap.data()?.dailyAnalyses ?? 0) : 0;
    if (used >= MAX_FREE_DAILY_ATTEMPTS) return { ok: false, used };
    tx.set(
      ref,
      { dailyAnalyses: used + 1, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return { ok: true, used: used + 1 };
  });
}

/** Give back a reserved attempt when the analysis didn't complete. */
export async function refundFreeDailyAttempt(
  db: Firestore,
  uid: string,
  date: string
): Promise<void> {
  const ref = usageRef(db, uid, date);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used = snap.exists ? Number(snap.data()?.dailyAnalyses ?? 0) : 0;
      if (used > 0) tx.set(ref, { dailyAnalyses: used - 1 }, { merge: true });
    });
  } catch {
    // Best-effort: a lost refund only ever costs the user, never the budget,
    // and self-heals at midnight when the counter resets.
  }
}
