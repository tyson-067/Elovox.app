import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { type Firestore } from "firebase-admin/firestore";

// Durable, cross-instance rate limiting.
//
// WHY THIS EXISTS. Every route already called `makeRateLimiter` from
// lib/verify.ts, which made the codebase look protected while it wasn't. That
// limiter keeps its buckets in a Map inside one serverless instance, so on
// Vercel the real ceiling is (instances x limit) and every cold start hands the
// caller a fresh, empty bucket. Under exactly the traffic a limit exists to
// stop — a burst — Vercel scales out, and each new instance starts the count
// over. A scripted caller got effectively unbounded access to the paid Gemini
// and AssemblyAI pipelines from behind a limiter that read like 30/hour.
//
// lib/loginGuard.ts had already reached this conclusion for sign-in and put its
// counter in Firestore. This is that idea generalised so every feature can have
// one, because a limit that only holds on one instance is not a limit.
//
// Two layers, composed inside `limited()` so no route can accidentally get only
// one of them:
//   memory  — free, instant, absorbs a hot loop landing on this instance
//             without touching the database.
//   durable — the actual ceiling, true across every instance and cold start.

/** Where the counters live. Deny-all to clients in firestore.rules. */
const COLLECTION = "rateLimits";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

interface Policy {
  /** Requests allowed per window, per key. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
  /**
   * Claim this many units per transaction and spend them from memory.
   *
   * Only for hot paths. The durable check costs one Firestore read+write per
   * ALLOWED request, which is the right price on a route that then spends
   * money, and the wrong one on a route that serves a cached string to every
   * signed-out visitor. Claiming in blocks divides that cost by the block
   * size while keeping the global ceiling exact: units are still reserved
   * atomically, so the total handed out across all instances can never exceed
   * the limit. An instance that dies holding unspent units simply forfeits
   * them, which errs toward refusing traffic, not admitting it.
   */
  batch?: number;
  /**
   * Admit traffic when Firestore itself is failing.
   *
   * The default is fail-CLOSED, which is the right default for anything that
   * spends money: if we cannot prove the caller is under their limit, they do
   * not get a paid API call. Set true only where a database blip locking users
   * out is worse than the traffic it would admit — reads, signature-verified
   * webhooks whose sender retries, and cron.
   */
  failOpen?: boolean;
}

/**
 * Every rate-limited surface in the app, in one table.
 *
 * This is the point of the file. The limits used to live as a bare number at
 * the top of 43 route files, which meant nobody could answer "what is actually
 * capped, and at what?" without reading all 43. A scope missing from here is a
 * compile error at the call site, and audit-rate-limits.mjs fails the build if
 * a route handler exists that never calls `limited()`.
 *
 * Naming: "<feature>" for the per-user limit, "<feature>-ip" for the per-IP one
 * on the same route. Both exist on the expensive routes, because the per-user
 * limit bounds a compromised account while the per-IP limit bounds one person
 * holding several accounts, which is what actually happened.
 */
export const LIMITS = {
  // --- Paid pipelines. The expensive ones, and the reason this file exists. --
  // Both fail closed: a call here is an AssemblyAI and/or Gemini run.
  //
  // The per-USER number is the real control and is deliberately tight. The
  // per-IP number behind it is a coarse backstop for the one thing per-user
  // limits can't see: one person spreading the same load over several accounts,
  // which is the shape the spike took.
  //
  // The per-IP numbers are LOOSE on purpose, and this is a genuine trade rather
  // than an oversight. Elovox is largely a phone app, so most traffic arrives
  // through carrier-grade NAT where thousands of unrelated users share a single
  // address. A tight per-IP cap there stops being an abuse control and becomes
  // an outage for everyone on that carrier. These are set to catch a script
  // running flat out from one machine — which does thousands, not hundreds —
  // while leaving room for a genuine crowd. If per-IP 429s ever show up for
  // real users, these are the two numbers to raise, or to drop entirely: the
  // per-user limits, the durable daily meters in lib/quota.ts, verified email
  // and App Check are what actually hold the line.
  analyze: { limit: 12, windowMs: HOUR },
  "analyze-ip": { limit: 300, windowMs: HOUR },
  // Gemini speech generation. "Felix writes it".
  speech: { limit: 30, windowMs: HOUR },
  "speech-ip": { limit: 600, windowMs: HOUR },
  // Fish Audio text-to-speech: Felix reading his feedback aloud. Cheap per
  // call next to the two above, but a paid third party all the same. Replays
  // are cached in the browser (lib/felixVoice.ts), so an honest session
  // spends one call per report it opens; this is sized for that, not for a
  // script reading the whole library out loud.
  voice: { limit: 60, windowMs: HOUR },
  "voice-ip": { limit: 900, windowMs: HOUR },
  // Felix's spoken take: one short Gemini call per report, the first time it
  // is opened, then served from the session doc. Sized for someone opening
  // every report they have ever recorded in one sitting, not for a script.
  felix: { limit: 60, windowMs: HOUR },
  "felix-ip": { limit: 900, windowMs: HOUR },
  // The daily challenge, public and unauthenticated, so limited per IP. Two
  // ceilings. `daily` is the tight one and sits BEHIND the memo cache, because
  // what it exists to bound is paid Gemini generation. `daily-flood` applies to
  // every request including cache hits, because a cached response is still a
  // serverless invocation. The flood limit is set high enough that no honest
  // client (one fetch per launch, per midnight rollover, and on focus) meets
  // it, and claims in blocks so the hottest path in the app isn't paying for a
  // transaction per visitor.
  //
  // The flood number is raised from the 300 it nominally was, and this is the
  // one place that needed rethinking rather than just enforcing. Per-IP limits
  // on a public route were harmless while they didn't really bind; now that
  // they do, a mobile carrier NAT puts thousands of unrelated users behind one
  // address, and 300/min would have started refusing real people the moment
  // the app got busy. 1200/min is 20 requests a second from a single address:
  // still far below anything a script does, still far above any crowd.
  "daily-flood": { limit: 1200, windowMs: MINUTE, batch: 50, failOpen: true },
  daily: { limit: 60, windowMs: MINUTE },

  // --- Money. Low volume, and a loop here is a mess to unpick. --------------
  // Nobody legitimately opens Checkout 20 times an hour. Keyed by uid, this
  // stops a loop from minting endless Stripe customers and portal sessions.
  "stripe-checkout": { limit: 20, windowMs: HOUR },
  "stripe-portal": { limit: 20, windowMs: HOUR },
  // Read-only, but every call hits Stripe's API: cap it so a loop on the
  // account screen can't burn through rate limits shared with checkout.
  "stripe-invoices": { limit: 60, windowMs: HOUR, failOpen: true },
  // Both webhooks are signature-verified, so the signature is the real control
  // and this is only a cheap flood guard in front of it. Deliberately loose,
  // and looser than the per-instance numbers these replaced: the asymmetry runs
  // the other way here. Refusing a genuine event delays money (Stripe retries
  // for days, but still), while admitting a flood only costs a signature check
  // that fails immediately. Both also fail OPEN for the same reason.
  "stripe-webhook": { limit: 1200, windowMs: MINUTE, batch: 50, failOpen: true },
  "resend-webhook": { limit: 1200, windowMs: MINUTE, batch: 50, failOpen: true },

  // --- The reward economy. Writes to docs clients can't touch directly. -----
  // Generous: the shop is a few taps, and someone trying on outfits is not an
  // attack. It's here so a script can't hammer a transaction on a hot doc.
  shop: { limit: 120, windowMs: HOUR },
  // A claim is a read of ~60 docs plus a transaction. Not expensive, but no
  // reason for anyone to call it more than a handful of times an hour.
  "streak-reward": { limit: 10, windowMs: HOUR },
  // Renaming yourself is rare. The limit stops a script churning the row, and
  // everyone else's view of it, in a loop.
  "leaderboard-handle": { limit: 20, windowMs: HOUR },
  "leaderboard-invite": { limit: 30, windowMs: HOUR },
  // Tight: this is the endpoint someone would point a script at to guess
  // codes. Eight characters of a 31-letter alphabet is ~8.5e11 combinations,
  // so guessing is hopeless anyway, but there's no reason to serve the try.
  "leaderboard-referral": { limit: 10, windowMs: HOUR },

  // --- Account lifecycle. Destructive or expensive, so kept tight. ----------
  // Deletion is irreversible and cancels a subscription on the way out. A
  // retry after a transient failure still works; a loop does not.
  "account-delete": { limit: 5, windowMs: HOUR },
  // An export reads the user's whole subtree, so it is heavier than a normal
  // request. Nobody needs more than a few a day.
  "account-export": { limit: 10, windowMs: HOUR },
  // These two are keyed per IP rather than per uid because both check the
  // limit BEFORE verifying the token, which is the right order — you don't
  // want to pay for token verification on a flood. That makes them subject to
  // the same NAT crowding as the public routes, so both carry headroom. The
  // real protection on welcome is elsewhere anyway: it claims once per uid, so
  // calling it a thousand times still sends one email.
  "account-welcome": { limit: 60, windowMs: MINUTE },
  "account-email-prefs": { limit: 120, windowMs: MINUTE },
  "session-delete": { limit: 20, windowMs: HOUR },

  // --- Unauthenticated surfaces. Anyone on the internet can reach these. ----
  leads: { limit: 10, windowMs: MINUTE },
  // The Firestore read behind /api/flags is already capped by getOpsFlags' 60s
  // cache, so what's worth limiting is the FUNCTION INVOCATION, which the cache
  // doesn't touch. Every client polls this on load, so it claims in blocks and
  // carries the same NAT headroom as daily-flood above.
  flags: { limit: 600, windowMs: MINUTE, batch: 25, failOpen: true },
  // The same ceiling we'd want on a login route.
  "auth-audit": { limit: 10, windowMs: MINUTE },
  "email-preview": { limit: 60, windowMs: MINUTE },
  "email-unsubscribe": { limit: 30, windowMs: MINUTE },

  // --- Cron. Secret-gated; this only bounds the unauthenticated dev path. ---
  "cron-email": { limit: 6, windowMs: HOUR, failOpen: true },
  "cron-purge": { limit: 6, windowMs: HOUR, failOpen: true },

  // --- Admin. Gated on an admin claim, so these bound a leaked admin token --
  // rather than the public. Reads fail open so the console stays usable.
  "admin-account": { limit: 10, windowMs: HOUR },
  "admin-audit": { limit: 60, windowMs: HOUR, failOpen: true },
  "admin-billing": { limit: 60, windowMs: HOUR, failOpen: true },
  "admin-coins": { limit: 30, windowMs: HOUR },
  "admin-comp": { limit: 30, windowMs: HOUR },
  "admin-daily": { limit: 30, windowMs: HOUR },
  "admin-email": { limit: 60, windowMs: HOUR },
  // Exports read a whole subtree; a support queue needs a handful a day.
  "admin-export": { limit: 10, windowMs: HOUR },
  "admin-leaderboard": { limit: 60, windowMs: HOUR, failOpen: true },
  "admin-leads": { limit: 60, windowMs: HOUR, failOpen: true },
  "admin-moderation": { limit: 30, windowMs: HOUR },
  "admin-ops": { limit: 60, windowMs: HOUR, failOpen: true },
  "admin-revenue": { limit: 30, windowMs: HOUR, failOpen: true },
  "admin-stats": { limit: 60, windowMs: HOUR, failOpen: true },
  "admin-subscription": { limit: 20, windowMs: HOUR },
  "admin-usage": { limit: 30, windowMs: HOUR, failOpen: true },
  "admin-user": { limit: 120, windowMs: HOUR, failOpen: true },
  "admin-users": { limit: 30, windowMs: HOUR, failOpen: true },
} as const satisfies Record<string, Policy>;

export type Scope = keyof typeof LIMITS;

/**
 * The key is hashed for the reason loginGuard hashes its own: these documents
 * are an abuse ledger, and an abuse ledger must not double as a log of which
 * user or which IP used which feature and when. The salt is shared with the
 * login ledger so there is one secret to rotate, not two.
 */
function docId(scope: string, key: string, windowStart: number): string {
  return createHash("sha256")
    .update(
      `${process.env.LOGIN_HASH_SALT ?? "elovox-rate-ledger"}:${scope}:${key}:${windowStart}`
    )
    .digest("hex");
}

/* --- The in-memory layer ---------------------------------------------------
   Per instance, so never a ceiling on its own — that was the original bug. It
   earns its place by making the common case free: a client stuck in a retry
   loop is refused here without a database round trip. */

interface MemoryState {
  /** Hits counted against the current window on THIS instance. */
  hits: number;
  /** Durable units claimed but not yet spent (see Policy.batch). */
  credit: number;
  /** Window this state belongs to; stale windows are reset on read. */
  windowStart: number;
  /** Set when the durable layer has refused this key for this window. */
  blocked: boolean;
}

const memory = new Map<string, MemoryState>();

function stateFor(cacheKey: string, windowStart: number): MemoryState {
  const existing = memory.get(cacheKey);
  if (existing && existing.windowStart === windowStart) return existing;
  const fresh: MemoryState = { hits: 0, credit: 0, windowStart, blocked: false };
  memory.set(cacheKey, fresh);
  // Same unbounded-growth trap the original limiter had to fix: without this
  // the map keeps an entry for every key the instance has ever seen.
  if (memory.size > 5000) {
    for (const [k, v] of memory) {
      if (v.windowStart !== windowStart) memory.delete(k);
    }
  }
  return fresh;
}

export interface LimitResult {
  allowed: boolean;
  /** Milliseconds until the window rolls over. 0 when allowed. */
  retryAfterMs: number;
}

/**
 * Claim one unit against a scope's ceiling. The whole check, both layers.
 *
 * Fixed window rather than the sliding array loginGuard uses: the window start
 * is part of the document id, so a window expires by no longer being written to
 * rather than by being pruned, and the document stays a single integer instead
 * of a growing list of timestamps.
 *
 * On Firestore's ~1 write/second per document ceiling: a legitimate caller
 * never approaches it, and a flood that does gets contention failures, which
 * fail closed into exactly the refusal it was heading for anyway.
 */
export async function checkLimit(
  db: Firestore | null,
  scope: Scope,
  key: string,
  now: number = Date.now()
): Promise<LimitResult> {
  const policy: Policy = LIMITS[scope];
  const windowStart = Math.floor(now / policy.windowMs) * policy.windowMs;
  const windowEnd = windowStart + policy.windowMs;
  const cacheKey = `${scope}:${key}:${windowStart}`;
  const state = stateFor(cacheKey, windowStart);

  // Already refused durably this window. This is what keeps the durable layer
  // affordable under the attack it exists for: without it a 10k-request flood
  // would cost 10k Firestore transactions — the flood billing us for its own
  // rejection. With it, the first request over the line costs one transaction
  // and every one after it is refused for free. It can only ever repeat a
  // refusal the database already issued.
  if (state.blocked) return { allowed: false, retryAfterMs: windowEnd - now };

  // The per-instance ceiling. Can't be the only check, but a single instance
  // has no business exceeding the global limit by itself.
  state.hits += 1;
  if (state.hits > policy.limit) {
    return { allowed: false, retryAfterMs: windowEnd - now };
  }

  // Spend a unit already claimed durably.
  if (state.credit > 0) {
    state.credit -= 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  // No database configured (local dev without credentials). The in-memory
  // ceiling above still applies; there is nothing durable to add, and refusing
  // every request would make `next dev` unusable.
  if (!db) return { allowed: true, retryAfterMs: 0 };

  const want = policy.batch ?? 1;
  const ref = db.doc(`${COLLECTION}/${docId(scope, key, windowStart)}`);

  try {
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used = Number(snap.data()?.n ?? 0);
      if (used >= policy.limit) return 0;
      // Never claim past the ceiling: the last block of a window is short.
      const grant = Math.min(want, policy.limit - used);
      tx.set(
        ref,
        {
          n: used + grant,
          // The scope names a feature, not a person, so it is safe to store and
          // makes the ledger legible for abuse triage. The key itself is only
          // ever present as part of the hash.
          scope,
          // Swept by the daily cron, same as the login ledgers. Kept well past
          // the window so a sweep that misses a day still finds it.
          expiresAt: new Date(windowEnd + policy.windowMs * 10),
        },
        { merge: true }
      );
      return grant;
    });

    if (claimed <= 0) {
      state.blocked = true;
      return { allowed: false, retryAfterMs: windowEnd - now };
    }
    state.credit = claimed - 1; // one is spent by this request
    return { allowed: true, retryAfterMs: 0 };
  } catch (err) {
    console.error(`[rate] ${scope} check failed`, err);
    return policy.failOpen
      ? { allowed: true, retryAfterMs: 0 }
      : { allowed: false, retryAfterMs: windowEnd - now };
  }
}

/**
 * The form most routes use, shaped to drop into the `if (rateLimited(key))`
 * they already had:
 *
 *   if (await limited(db, "shop", uid)) {
 *     return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
 *   }
 */
export async function limited(
  db: Firestore | null,
  scope: Scope,
  key: string
): Promise<boolean> {
  const { allowed } = await checkLimit(db, scope, key);
  return !allowed;
}

/**
 * The same check, returning a ready 429 with Retry-After. Used on the paid
 * routes, where telling a client when to come back is worth the extra line: a
 * client that only sees 429 usually retries at once and becomes the next spike.
 */
export async function limitOr429(
  db: Firestore | null,
  opts: { scope: Scope; key: string; message?: string }
): Promise<NextResponse | null> {
  const result = await checkLimit(db, opts.scope, opts.key);
  if (result.allowed) return null;
  const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  return NextResponse.json(
    { error: opts.message ?? "Slow down a moment.", retryAfterMs: result.retryAfterMs },
    { status: 429, headers: { "Retry-After": String(seconds) } }
  );
}

/**
 * Delete expired counters. Best effort; never throws.
 *
 * Called by the daily cron alongside the other ledger sweeps, for the same
 * reason they are swept in-app rather than by a Firestore TTL policy: creating
 * one needs `datastore.indexes.update`, which the project's operator console
 * answers 403 for. If a TTL policy is added later the two are complementary —
 * both only delete rows that are already expired.
 */
export async function purgeExpiredRateLimits(
  db: Firestore | null,
  limit = 500
): Promise<number> {
  if (!db) return 0;
  try {
    const snap = await db
      .collection(COLLECTION)
      .where("expiresAt", "<", new Date())
      .limit(limit)
      .get();
    if (snap.empty) return 0;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    return snap.size;
  } catch (err) {
    console.error("[rate] purge failed", err);
    return 0;
  }
}
