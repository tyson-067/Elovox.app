import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { adminEmailList } from "./verify";

// The strike / warning / ban system, v1 — built from docs/strike-system-design.md
// with the open decisions settled as follows:
//
//   - TWO SOURCES OF STRIKES. Most are an operator's decision, from /admin,
//     about CONDUCT (reports, abuse the ops tab surfaces, offensive public
//     handles). The one automated source is LANGUAGE: /api/analyze already
//     transcribes every recording, so lib/profanity.ts screens that transcript
//     for swearing and slurs, masks what it finds, and applies at most ONE
//     strike per recording (source "audio"). Nothing else reads practice
//     content, and no automated source can reach severity 3 — a speech-to-text
//     guess must never close an account in one shot. The Terms say this
//     plainly ("Acceptable use": no slurs/hate speech, transcripts are
//     screened automatically), which is the legal basis the scan needs.
//   - A ban blocks the paid pipeline and public surfaces AND disables the
//     Firebase account (full lock, reversible via reinstate).
//   - Billing is never touched by moderation. A banned subscriber's money is
//     an operator decision made separately, with the refund rules intact.
//   - Thresholds per the design doc: warn at ≥1, suspend (7 days) at ≥3,
//     ban at ≥5; severities weigh 1 / 2 / 5.
//   - Appeals are manual: support email → an operator lifts or reinstates.
//
// Enforcement state is VALUABLE, so it follows the usage-meter pattern: an
// Admin-SDK-only doc (users/{uid}/moderation/status) plus an append-only
// event log (moderationEvents/{id}). firestore.rules' catch-all denies every
// client both ways — no rules change, no client reads, enforcement entirely
// server-side. (The design doc's owner-readable status banner can come later
// with a rules deploy; it is presentation, not enforcement.)

export type ModerationState = "ok" | "warned" | "suspended" | "banned";

export interface ModerationStatus {
  strikes: number;
  state: ModerationState;
  /** Epoch ms a temporary suspension ends. Only meaningful while suspended. */
  suspendedUntil?: number;
}

export const STRIKE_WEIGHT: Record<1 | 2 | 3, number> = { 1: 1, 2: 2, 3: 5 };
export const WARN_AT = 1;
export const SUSPEND_AT = 3;
export const BAN_AT = 5;
export const SUSPENSION_MS = 7 * 24 * 60 * 60 * 1000;

function statusRef(db: Firestore, uid: string) {
  return db.doc(`users/${uid}/moderation/status`);
}

/** What the strike total buys, ignoring time. */
function stateForStrikes(strikes: number): ModerationState {
  if (strikes >= BAN_AT) return "banned";
  if (strikes >= SUSPEND_AT) return "suspended";
  if (strikes >= WARN_AT) return "warned";
  return "ok";
}

/**
 * The state that is actually IN FORCE now: a suspension whose window has
 * elapsed reads as "warned" (strikes persist; the sentence is served). Time
 * is applied at read so nothing needs a cron to expire.
 */
export function effectiveState(
  status: ModerationStatus | null,
  now: number = Date.now()
): ModerationState {
  if (!status) return "ok";
  if (status.state === "suspended") {
    const until = status.suspendedUntil ?? 0;
    return now < until ? "suspended" : "warned";
  }
  return status.state;
}

export async function getModerationStatus(
  db: Firestore,
  uid: string
): Promise<ModerationStatus | null> {
  const snap = await statusRef(db, uid).get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  return {
    strikes: typeof d.strikes === "number" ? d.strikes : 0,
    state:
      d.state === "warned" || d.state === "suspended" || d.state === "banned"
        ? d.state
        : "ok",
    ...(typeof d.suspendedUntil === "number"
      ? { suspendedUntil: d.suspendedUntil }
      : {}),
  };
}

export type Restriction =
  | { blocked: false }
  | { blocked: true; state: "suspended"; until: number }
  | { blocked: true; state: "banned" };

/**
 * The enforcement read for routes. FAIL-OPEN like the ops flags: a Firestore
 * blip must never lock honest users out of the thing they pay for — a missed
 * block on a suspended account for one request is the cheaper error.
 */
export async function isRestricted(
  db: Firestore | null,
  uid: string
): Promise<Restriction> {
  if (!db) return { blocked: false };
  try {
    const status = await getModerationStatus(db, uid);
    const state = effectiveState(status);
    if (state === "banned") return { blocked: true, state };
    if (state === "suspended") {
      return { blocked: true, state, until: status?.suspendedUntil ?? 0 };
    }
    return { blocked: false };
  } catch (err) {
    console.error("[moderation] status read failed (failing open)", uid, err);
    return { blocked: false };
  }
}

export interface StrikeInput {
  severity: 1 | 2 | 3;
  /** The stated grounds. For "manual", the operator's words; for "audio", a
   *  fixed description of what the scan found — counts and tier, never the
   *  words themselves, so the log stays metadata rather than content. */
  reason: string;
  /** Which side applied it, so an operator's decision is never confused with
   *  the pipeline's. "audio" is lib/profanity.ts via /api/analyze. */
  source: "manual" | "audio";
  /** Admin email, or "system" for an automated strike — every strike is
   *  attributable. */
  actor: string;
  /** Optional idempotency key: a repeated apply with the same key is a
   *  no-op, so a double-submitted form can't double-punish. */
  dedupeKey?: string;
}

export interface StrikeOutcome {
  applied: boolean;
  strikes: number;
  state: ModerationState;
  suspendedUntil?: number;
}

/**
 * One transaction: weigh the strike, recompute state, stamp the event.
 * Crossing into "suspended" opens a fresh 7-day window; a strike DURING a
 * suspension restarts it (the design doc's escalation intent); crossing into
 * "banned" is permanent until reinstate.
 */
export async function applyStrike(
  db: Firestore,
  uid: string,
  input: StrikeInput
): Promise<StrikeOutcome> {
  const ref = statusRef(db, uid);
  const eventRef = input.dedupeKey
    ? db.doc(`moderationEvents/${input.dedupeKey}`)
    : db.collection("moderationEvents").doc();
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    if (input.dedupeKey) {
      const prior = await tx.get(eventRef);
      if (prior.exists) {
        // Same event already applied; report the standing state untouched.
        const snap = await tx.get(ref);
        const d = snap.data() ?? {};
        return {
          applied: false,
          strikes: typeof d.strikes === "number" ? d.strikes : 0,
          state: stateForStrikes(typeof d.strikes === "number" ? d.strikes : 0),
          ...(typeof d.suspendedUntil === "number"
            ? { suspendedUntil: d.suspendedUntil }
            : {}),
        };
      }
    }
    const snap = await tx.get(ref);
    const prev = snap.data() ?? {};
    const strikes =
      (typeof prev.strikes === "number" ? prev.strikes : 0) +
      STRIKE_WEIGHT[input.severity];
    const state = stateForStrikes(strikes);
    const suspendedUntil =
      state === "suspended" ? now + SUSPENSION_MS : undefined;

    tx.set(
      ref,
      {
        strikes,
        state,
        ...(suspendedUntil
          ? { suspendedUntil }
          : { suspendedUntil: FieldValue.delete() }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(eventRef, {
      uid,
      kind: "strike",
      severity: input.severity,
      weight: STRIKE_WEIGHT[input.severity],
      reason: input.reason,
      source: input.source,
      actor: input.actor,
      strikesAfter: strikes,
      stateAfter: state,
      at: now,
    });
    return { applied: true, strikes, state, ...(suspendedUntil ? { suspendedUntil } : {}) };
  });
}

/**
 * The automated path: a strike the pipeline applies, with the two guardrails
 * an operator's hands would otherwise provide.
 *
 * 1. Operator accounts are exempt, same as the manual route — the console must
 *    not be able to eat its own operators because one of them swore into a
 *    test recording.
 * 2. Landing on "banned" disables the Firebase account, so an automated ban is
 *    the same full lock a manual one is (lookupUser treats a disabled account
 *    as no valid caller) rather than a half-enforced state.
 *
 * Never throws: the caller is mid-analysis, and a moderation write that fails
 * must not cost the speaker the report they just earned. A missed strike is
 * recoverable; a lost report is not.
 */
export async function applyAutoStrike(
  db: Firestore | null,
  uid: string,
  input: Omit<StrikeInput, "source" | "actor">
): Promise<StrikeOutcome | null> {
  if (!db || uid === "local-dev") return null;
  try {
    const { getAdminApp } = await import("./firebaseAdmin");
    const app = getAdminApp();
    if (!app) return null;
    const { getAuth } = await import("firebase-admin/auth");
    const auth = getAuth(app);

    const user = await auth.getUser(uid);
    const email = user.email?.toLowerCase() ?? "";
    if (email && adminEmailList().includes(email)) return null;

    const outcome = await applyStrike(db, uid, {
      ...input,
      source: "audio",
      actor: "system",
    });
    if (outcome.applied && outcome.state === "banned" && !user.disabled) {
      await auth.updateUser(uid, { disabled: true });
    }
    return outcome;
  } catch (err) {
    console.error("[moderation] auto-strike failed", uid, err);
    return null;
  }
}

/** End a suspension early. Strikes stand; state drops to "warned". */
export async function liftSuspension(
  db: Firestore,
  uid: string,
  actor: string
): Promise<{ ok: boolean }> {
  const ref = statusRef(db, uid);
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data() ?? {};
    if (d.state !== "suspended") return { ok: false };
    tx.set(
      ref,
      {
        state: "warned",
        suspendedUntil: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(db.collection("moderationEvents").doc(), {
      uid,
      kind: "lift",
      actor,
      strikesAfter: typeof d.strikes === "number" ? d.strikes : 0,
      stateAfter: "warned",
      at: now,
    });
    return { ok: true };
  });
}

/** Wipe the slate: strikes to zero, state to ok. The event log remains. */
export async function reinstate(
  db: Firestore,
  uid: string,
  actor: string
): Promise<void> {
  const ref = statusRef(db, uid);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    tx.set(
      ref,
      {
        strikes: 0,
        state: "ok",
        suspendedUntil: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(db.collection("moderationEvents").doc(), {
      uid,
      kind: "reinstate",
      actor,
      strikesAfter: 0,
      stateAfter: "ok",
      at: now,
    });
  });
}
