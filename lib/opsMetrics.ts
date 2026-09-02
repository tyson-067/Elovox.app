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

// --- The global AI spend ceiling (opsDaily/{yyyy-mm-dd}) ------------------
//
// WHY THIS EXISTS. Every paid pipeline is bounded PER USER and PER IP, and
// nothing bounded the TOTAL. Those per-user numbers are abuse ceilings, not
// budgets: /api/analyze allows 12 an hour and 120 a day, /api/speech 30 an
// hour and 100 a day, /api/felix 60 an hour and 60 a day. One account running
// all three flat out buys roughly $9 of upstream AssemblyAI and Gemini in a
// day, against the $0.22 a day the cheapest subscription (annual, $79.99)
// actually pays — about forty times its own revenue. That is a fine trade for
// one enthusiastic subscriber and a catastrophe for two hundred fraudulent
// ones, and until this existed nothing in the app could see the second case
// happening, let alone stop it: the rate limiters would have refused nobody,
// because every one of those accounts was inside its own limit.
//
// So: one durable counter for the whole day, across every instance, on the
// opsDaily doc the analyze pipeline already writes — no new collection, no new
// write on the hot path — plus a circuit breaker reading it.
//
// This is NOT a product limit. No advertised quota moves, and the default is
// set so only a day unlike any real day reaches it; the routes degrade rather
// than refuse (a cached answer where one exists, otherwise "try again
// shortly"), and the operator hears about it at three quarters of the way up.

/** The paid calls counted here. /api/voice (Fish Audio) is not yet wired in. */
export type AiOperation = "analyze" | "speech" | "felix";

/**
 * Rough upstream cost of one operation, in US cents.
 *
 * Deliberately a constant per route rather than a real usage read: the
 * providers only bill after the fact, and a breaker that needs an accurate
 * bill to fire is a breaker that never fires. Rounded UP — over-estimating
 * trips the brake early, which is the safe direction to be wrong in.
 */
const AI_OP_COST_CENTS: Record<AiOperation, number> = {
  // AssemblyAI on a take of a minute or two, plus the Gemini report over its
  // transcript. The most expensive thing the app does.
  analyze: 5,
  // One Gemini generation of a few hundred words.
  speech: 2,
  // Thirty to sixty words, but the 3.x models bill their thinking too.
  felix: 1,
};

/** Premium camera analysis: a second Gemini pass over up to 12 frames. */
const CAMERA_PASS_COST_CENTS = 3;

/** Firestore field on opsDaily holding the day's estimated spend, in cents. */
const SPEND_FIELD = "aiCostCents";

const AI_OP_FIELD: Record<AiOperation, string> = {
  analyze: "aiOpsAnalyze",
  speech: "aiOpsSpeech",
  felix: "aiOpsFelix",
};

/**
 * The ceiling, in whole US dollars of estimated spend per UTC day.
 *
 * ENV: AI_DAILY_CEILING_USD. Read per call rather than at module load so it
 * can be changed without waiting for every warm instance to recycle.
 *
 * $500 a day is ~10,000 analyses: more than 800 daily-active subscribers each
 * recording a dozen takes, which is a level of traffic that arrives with an
 * order of magnitude more revenue than the bill, and ~55x what a single
 * account can spend at its own daily ceiling. It is meant to be unreachable on
 * a real day and reachable on a fraudulent one. Raise it as real traffic
 * grows: the 75% warning below is the signal that the day has come, and it
 * arrives in the operator alert before anybody is refused anything.
 */
const DEFAULT_AI_DAILY_CEILING_USD = 500;

function aiCeilingCents(): number {
  const raw = Number(process.env.AI_DAILY_CEILING_USD);
  const usd = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AI_DAILY_CEILING_USD;
  return Math.round(usd * 100);
}

/** Tell the operator from here up, while there is still room to act. */
const AI_WARN_FRACTION = 0.75;

export interface AiSpendState {
  /** Estimated upstream spend so far today, in US cents. */
  cents: number;
  /** Today's ceiling in cents (AI_DAILY_CEILING_USD). */
  ceilingCents: number;
  /** At or past the ceiling: paid routes should degrade, not spend. */
  over: boolean;
  /** Past AI_WARN_FRACTION of it: worth an operator's attention. */
  near: boolean;
}

const AI_SPEND_CACHE_MS = 60 * 1000;
let aiSpendCache: { day: string; at: number; cents: number } | null = null;

/** Firestore hands back whatever the field holds, and a hand edit or a
 *  half-written document is not a number of cents. NaN in a brake is a brake
 *  with no opinion, so anything unreadable counts as nothing spent. */
function centsOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function aiStateFor(cents: number): AiSpendState {
  const ceilingCents = aiCeilingCents();
  return {
    cents,
    ceilingCents,
    over: cents >= ceilingCents,
    near: cents >= ceilingCents * AI_WARN_FRACTION,
  };
}

/**
 * Today's estimated global AI spend, FAIL-OPEN and cached per instance for a
 * minute — the same posture, and the same reasons, as getOpsFlags below. A
 * Firestore blip must never be able to stop the paid pipelines by itself: the
 * cost of failing open is one minute of unbounded spend on a day that is
 * almost certainly ordinary, and the cost of failing closed is refusing every
 * paying customer over a database hiccup.
 *
 * The cached value is kept current by recordAiOperation, so an instance sees
 * its own spending immediately and only the OTHER instances' spending is up to
 * a minute stale.
 */
export async function getAiSpend(db: Firestore | null): Promise<AiSpendState> {
  if (!db) return aiStateFor(0);
  const day = utcDayKey();
  const now = Date.now();
  if (aiSpendCache && aiSpendCache.day === day && now - aiSpendCache.at < AI_SPEND_CACHE_MS) {
    return aiStateFor(aiSpendCache.cents);
  }
  try {
    const snap = await db.doc(`opsDaily/${day}`).get();
    aiSpendCache = { day, at: now, cents: centsOf(snap.data()?.[SPEND_FIELD]) };
    return aiStateFor(aiSpendCache.cents);
  } catch (err) {
    // Not cached: an unreadable answer must not be remembered for a minute.
    console.error("[ops] AI spend read failed", err);
    return aiStateFor(0);
  }
}

/**
 * The question the paid routes ask before they spend: is the day's global
 * ceiling already reached? True means degrade — serve a cache or say "try
 * again shortly" — never means say why.
 */
export async function overAiSpendCeiling(db: Firestore | null): Promise<boolean> {
  return (await getAiSpend(db)).over;
}

/** Drop this instance's cached spend and its alert memo, so the next read goes
 *  to Firestore and the next crossing of a level alerts again.
 *
 *  Used by the tests. Nothing in the running app calls it: the daily ops alert
 *  (lib/email/opsAlert.ts) invalidates only the FLAGS cache, because a paused
 *  pipeline it misses goes unreported for a whole day, while a spend total up
 *  to a minute stale is still the right number to the cent it matters at. If
 *  that mail ever reports the day's spend itself, it should call this first. */
export function invalidateAiSpendCache(): void {
  aiSpendCache = null;
  alerted = { day: "", near: false, over: false };
}

/**
 * The increments for one operation, merged into whatever opsDaily write the
 * caller is already making. recordAnalyzeOutcome uses this so the most
 * expensive route in the app pays ZERO extra Firestore writes for the ceiling.
 */
function aiSpendIncrements(op: AiOperation, cents: number): Record<string, unknown> {
  return {
    aiOps: FieldValue.increment(1),
    [AI_OP_FIELD[op]]: FieldValue.increment(1),
    [SPEND_FIELD]: FieldValue.increment(cents),
  };
}

/** Keep this instance's cached estimate honest between reads, so a single
 *  instance in a hot loop trips its own brake without waiting for the cache
 *  to expire. */
function noteLocalSpend(cents: number): void {
  const day = utcDayKey();
  if (aiSpendCache && aiSpendCache.day === day) aiSpendCache.cents += cents;
}

/**
 * Count one paid AI call. Best-effort and never throws, like everything else
 * in this file: instrumentation must not break the money path it observes.
 *
 * Charged when the paid call is CERTAIN, not when it succeeds — a Gemini
 * request that times out was still bought.
 */
export async function recordAiOperation(
  db: Firestore | null,
  op: AiOperation
): Promise<void> {
  if (!db) return;
  const cents = AI_OP_COST_CENTS[op];
  try {
    await db.doc(`opsDaily/${utcDayKey()}`).set(
      { ...aiSpendIncrements(op, cents), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    noteLocalSpend(cents);
    await alertOnAiSpend(db);
  } catch (err) {
    console.error("[ops] couldn't record AI operation", err);
  }
}

// --- Telling somebody ----------------------------------------------------
// Once per instance per day per level, so an instance in a hot loop writes two
// documents, not two thousand. Other instances repeat the write to the SAME
// day-keyed document id, which merges rather than duplicating.

let alerted = { day: "", near: false, over: false };

/**
 * Raise the alarm on the path the codebase already has: a `billingAlerts` doc
 * with `resolved: false`, which is what the admin Billing queue lists and what
 * the daily operator email (lib/email/opsAlert.ts) counts as urgent. Nothing
 * new to wire up, and nothing that only exists if somebody opens a console.
 */
async function alertOnAiSpend(db: Firestore): Promise<void> {
  // No cached read means this instance has only ever seen its OWN spending,
  // and a total we know is too low is not a number to raise an alarm on. Every
  // route that records an operation checks the ceiling first, which fills the
  // cache, so this is the cold-start case rather than a gap.
  const state = aiSpendCache ? aiStateFor(aiSpendCache.cents) : null;
  if (!state || !state.near) return;
  const day = utcDayKey();
  if (alerted.day !== day) alerted = { day, near: false, over: false };
  const level = state.over ? "over" : "near";
  if (alerted[level]) return;
  alerted[level] = true;

  const spent = (state.cents / 100).toFixed(2);
  const ceiling = (state.ceilingCents / 100).toFixed(2);
  try {
    await db.doc(`billingAlerts/ai-spend-${level}-${day}`).set(
      {
        kind: "ai-spend-ceiling",
        context:
          level === "over"
            ? `Estimated AI spend for ${day} reached the daily ceiling ($${spent} of $${ceiling}). The paid routes are degrading gracefully until UTC midnight: analysis and speech writing answer "try again shortly", Felix falls back to a written-from-the-report take. Check /admin for a usage spike before raising AI_DAILY_CEILING_USD.`
            : `Estimated AI spend for ${day} is at $${spent} of the $${ceiling} daily ceiling. Nothing is refused yet. If this is real traffic, raise AI_DAILY_CEILING_USD before it trips; if it is not, /admin has the accounts.`,
        uid: null,
        amount: Math.round(state.cents),
        currency: "usd",
        resolved: false,
        at: Date.now(),
      },
      { merge: true }
    );
  } catch (err) {
    console.error("[ops] couldn't write AI spend alert", err);
  }
  // Also on the console, because the email is once a day and this may be the
  // afternoon somebody is already watching the logs.
  const line = `[ops] AI spend ${level === "over" ? "CEILING REACHED" : "warning"}: $${spent} of $${ceiling} for ${day}`;
  if (level === "over") console.error(line);
  else console.warn(line);
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
    // The global spend counter rides on THIS write. Every terminal path in
    // /api/analyze already calls this exactly once, so the ceiling gets an
    // accurate count of pipeline runs for no extra Firestore write at all —
    // including the failures, which cost AssemblyAI and Gemini just the same.
    // `paused` is the one outcome that spent nothing: the kill switch refused
    // the run before the body was even read.
    if (o.outcome !== "paused") {
      const cents =
        AI_OP_COST_CENTS.analyze + (o.camera ? CAMERA_PASS_COST_CENTS : 0);
      Object.assign(update, aiSpendIncrements("analyze", cents));
      noteLocalSpend(cents);
    }
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
    if (o.outcome !== "paused") await alertOnAiSpend(db);
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
  /**
   * True when the flags could NOT be read (Firestore unreachable, credential
   * rejected) rather than read and found empty.
   *
   * The two are the same for a brake that fails open — and opposite for one
   * that fails closed. `pauseCheckout` is the second kind: it exists partly
   * for a pricing mistake, and resuming sales at the wrong price because a
   * database blip erased the pause is the exact outcome the switch was thrown
   * to prevent. Callers that must not fail open read this.
   */
  unavailable?: boolean;
  /**
   * Today's global AI spend has passed the ceiling (see getAiSpend above).
   *
   * Present ONLY when the caller asks for it with `{ withAiSpend: true }`.
   * It rides on the flags OBJECT, not on the flags READ: getOpsFlags reads
   * `ops/flags` and getAiSpend separately reads `opsDaily/{day}`, so asking
   * for it is a second Firestore read, not a free field on the first. Both
   * are cached per instance for the same minute, so a route that asks "may I
   * spend?" pays two reads per instance-minute rather than two per recording
   * — which is what makes one gate returning both answers affordable.
   * /api/flags, which every client polls on load, does not ask, so the public
   * path pays nothing for the ceiling.
   */
  aiSpendOver?: boolean;
}

const FLAGS_CACHE_MS = 60 * 1000;
let flagsCache: { at: number; flags: OpsFlags } | null = null;

/**
 * Current flags, FAIL-OPEN: any read problem returns {} so a Firestore blip
 * can never pause the product by itself. The flag exists to stop spend in an
 * emergency; its absence of evidence must never act like evidence.
 */
export async function getOpsFlags(
  db: Firestore | null,
  opts?: { withAiSpend?: boolean }
): Promise<OpsFlags> {
  const flags = await readOpsFlags(db);
  if (!opts?.withAiSpend) return flags;
  return { ...flags, aiSpendOver: (await getAiSpend(db)).over };
}

async function readOpsFlags(db: Firestore | null): Promise<OpsFlags> {
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
    // Deliberately NOT cached: an unreadable answer must not be remembered for
    // a minute, and the next request should try again.
    console.error("[ops] flags read failed", err);
    return { unavailable: true };
  }
}

/** Drop this instance's cache after an admin write. Other instances converge
 *  within FLAGS_CACHE_MS, which is fine for an emergency brake. */
export function invalidateOpsFlagsCache(): void {
  flagsCache = null;
}

// Re-exported for the ops route's day-range query.
export { FieldPath };
