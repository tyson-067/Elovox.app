import {
  FieldPath,
  FieldValue,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";

// Operational telemetry for the /admin Ops tab, and the analyze kill switch.
//
// PRIVACY POSTURE (this is the load-bearing part): everything written here is
// either a COUNTER with no user data at all (opsDaily), or a security event
// justified by the privacy policy's named "legitimate interests" basis of
// "keeping the service secure and preventing abuse". Events may carry a uid
// or an IP — the same data the server logs already hold — and the policy says
// server logs live "a short operational window, then discarded", so every
// event carries an `expiresAt` and the admin Ops route lazily purges expired
// rows on read (plus a recommended Firestore TTL policy on `expiresAt` as
// belt-and-braces; see the README note in the admin PR).
//
// Never write practice content, transcripts, scores, or emails here.

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a security event lives. "A short operational window." */
export const OPS_EVENT_TTL_MS = 7 * DAY_MS;

/** UTC day key, matching lib/quota.ts / lib/streakReward.ts. */
export function utcDayKey(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

// --- Analyze pipeline health (opsDaily/{yyyy-mm-dd}) ---------------------
// Pure counters + duration sums, incremented best-effort from /api/analyze.
// Sums-plus-counts rather than averages so the day's numbers merge correctly
// under concurrency; the admin route divides at read time.

export type AnalyzeOutcome =
  | "ok"
  | "no-speech"
  | "unreadable-audio"
  | "transcribe-failed"
  | "model-failed"
  | "paused";

const OUTCOME_FIELD: Record<AnalyzeOutcome, string> = {
  ok: "ok",
  "no-speech": "noSpeech",
  "unreadable-audio": "unreadableAudio",
  "transcribe-failed": "transcribeFailed",
  "model-failed": "modelFailed",
  paused: "paused",
};

/**
 * Record one trip through the analyze pipeline. Never throws, never blocks
 * the caller's outcome — instrumentation must not be able to break the money
 * path it observes (same posture as lib/refunds.ts).
 */
export async function recordAnalyzeOutcome(
  db: Firestore | null,
  o: {
    outcome: AnalyzeOutcome;
    totalMs?: number;
    transcribeMs?: number;
    modelMs?: number;
    premium?: boolean;
    camera?: boolean;
  }
): Promise<void> {
  if (!db) return;
  try {
    const inc = FieldValue.increment;
    const update: Record<string, unknown> = {
      runs: inc(1),
      [OUTCOME_FIELD[o.outcome]]: inc(1),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (o.premium) update.premiumRuns = inc(1);
    if (o.camera) update.cameraRuns = inc(1);
    if (typeof o.totalMs === "number" && Number.isFinite(o.totalMs)) {
      update.totalMsSum = inc(Math.round(o.totalMs));
      update.totalMsCount = inc(1);
    }
    if (typeof o.transcribeMs === "number" && Number.isFinite(o.transcribeMs)) {
      update.transcribeMsSum = inc(Math.round(o.transcribeMs));
      update.transcribeMsCount = inc(1);
    }
    if (typeof o.modelMs === "number" && Number.isFinite(o.modelMs)) {
      update.modelMsSum = inc(Math.round(o.modelMs));
      update.modelMsCount = inc(1);
    }
    await db.doc(`opsDaily/${utcDayKey()}`).set(update, { merge: true });
  } catch (err) {
    console.error("[ops] couldn't record analyze outcome", err);
  }
}

// --- Security events (opsEvents/{autoId}) --------------------------------

export type OpsEventType = "admin-denied" | "flags-changed";

// Per-instance write sampler: a probe loop hammering /api/admin/* must not be
// able to turn a 404 into unbounded Firestore writes (cost amplification).
// Ten writes a minute per event type is plenty to see an attack's shape; the
// rest are dropped silently, which loses nothing an operator acts on.
const EVENTS_PER_MINUTE = 10;
const sampler = new Map<string, number[]>();

function sampled(type: string): boolean {
  const now = Date.now();
  const hits = (sampler.get(type) ?? []).filter((t) => t > now - 60_000);
  if (hits.length >= EVENTS_PER_MINUTE) return true;
  hits.push(now);
  sampler.set(type, hits);
  return false;
}

/**
 * Record one security-relevant event. Sampled, expiring, best-effort.
 * `ip` keys abuse response (the same value the rate limiters already use);
 * never put content or emails in `detail`.
 */
export async function recordOpsEvent(
  db: Firestore | null,
  e: {
    type: OpsEventType;
    route: string;
    uid?: string | null;
    ip?: string | null;
    detail?: string;
  }
): Promise<void> {
  if (!db || sampled(e.type)) return;
  try {
    const now = Date.now();
    await db.collection("opsEvents").add({
      type: e.type,
      route: e.route,
      ...(e.uid ? { uid: e.uid } : {}),
      ...(e.ip ? { ip: e.ip } : {}),
      ...(e.detail ? { detail: e.detail.slice(0, 300) } : {}),
      // `at` is epoch ms for display (the route and UI read it as a number).
      at: now,
      // `expiresAt` is a real Firestore Timestamp, and MUST stay one: a
      // Firestore TTL policy only ever acts on a Date-and-time field and
      // silently ignores documents whose TTL field holds a number. Written as
      // ms first, this looked configured in the console and deleted nothing —
      // the retention promise resting entirely on the lazy purge below.
      expiresAt: Timestamp.fromMillis(now + OPS_EVENT_TTL_MS),
    });
  } catch (err) {
    console.error("[ops] couldn't record event", err);
  }
}

/** Convenience wrapper for the admin routes' flat-404 branch. */
export async function recordAdminDenied(
  db: Firestore | null,
  route: string,
  ip: string
): Promise<void> {
  await recordOpsEvent(db, { type: "admin-denied", route, ip });
}

/**
 * Delete a batch of expired events. Called from the admin Ops GET (via
 * next/server `after`, so it never delays the response), which guarantees the
 * "short operational window" promise holds as long as anyone actually looks
 * at the Ops tab — and a Firestore TTL policy on `expiresAt` covers the case
 * where nobody does.
 */
export async function purgeExpiredOpsEvents(
  db: Firestore | null,
  limit = 200
): Promise<number> {
  if (!db) return 0;
  try {
    // TWO queries, because Firestore range comparisons are type-scoped: a
    // `< Timestamp` bound matches only Timestamp-valued fields and skips
    // numeric ones entirely (verified against live data — a Timestamp query
    // matched 0 of 23 numeric rows). The second query sweeps events written
    // before `expiresAt` became a Timestamp; it can retire once no numeric
    // rows remain, and costs one empty query until then.
    const [fresh, legacy] = await Promise.all([
      db
        .collection("opsEvents")
        .where("expiresAt", "<", Timestamp.now())
        .limit(limit)
        .get(),
      db
        .collection("opsEvents")
        .where("expiresAt", "<", Date.now())
        .limit(limit)
        .get(),
    ]);
    const docs = [...fresh.docs, ...legacy.docs];
    if (docs.length === 0) return 0;
    const batch = db.batch();
    for (const doc of docs) batch.delete(doc.ref);
    await batch.commit();
    return docs.length;
  } catch (err) {
    console.error("[ops] purge failed", err);
    return 0;
  }
}

// --- Operator flags (ops/flags) ------------------------------------------
// The one control doc: written only by /api/admin/ops, read by the routes it
// gates. Cached per instance for a minute so the analyze hot path pays one
// Firestore read per instance-minute, not one per recording.

export interface OpsFlags {
  /** Emergency stop for the paid analyze pipeline (abuse spike, provider
   *  meltdown, cost runaway). Users get an honest 503, nothing is spent. */
  pauseAnalyze?: boolean;
  /** Emergency stop for new Checkout sessions (a pricing mistake, a Stripe
   *  incident). Existing subscribers are untouched — this only stops NEW
   *  purchases from starting. */
  pauseCheckout?: boolean;
  /** Site-wide announcement line (web only; the native shell never shows
   *  it). Empty/absent = no banner. Plain text, no links, set from /admin. */
  banner?: string;
}

const FLAGS_CACHE_MS = 60 * 1000;
let flagsCache: { at: number; flags: OpsFlags } | null = null;

/**
 * Current flags, FAIL-OPEN: any read problem returns {} so a Firestore blip
 * can never pause the product by itself. The flag exists to stop spend in an
 * emergency; its absence of evidence must never act like evidence.
 */
export async function getOpsFlags(db: Firestore | null): Promise<OpsFlags> {
  if (!db) return {};
  const now = Date.now();
  if (flagsCache && now - flagsCache.at < FLAGS_CACHE_MS) return flagsCache.flags;
  try {
    const snap = await db.doc("ops/flags").get();
    const data = snap.exists ? snap.data() : undefined;
    const flags: OpsFlags = {
      pauseAnalyze: data?.pauseAnalyze === true,
      pauseCheckout: data?.pauseCheckout === true,
      banner:
        typeof data?.banner === "string" ? data.banner.slice(0, 140) : "",
    };
    flagsCache = { at: now, flags };
    return flags;
  } catch (err) {
    console.error("[ops] flags read failed (failing open)", err);
    return {};
  }
}

/** Drop this instance's cache after an admin write. Other instances converge
 *  within FLAGS_CACHE_MS, which is fine for an emergency brake. */
export function invalidateOpsFlagsCache(): void {
  flagsCache = null;
}

// Re-exported for the ops route's day-range query.
export { FieldPath };
