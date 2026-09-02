import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Login throttling: per-IP rate limiting, per-account lockout, and a
 * progressive delay between attempts.
 *
 * WHAT THIS CAN AND CANNOT DO — read this before changing anything.
 *
 * Elovox uses Firebase Auth's client SDK, so a password goes from the browser
 * straight to Google. It never reaches this server, which means there is no
 * request here to intercept and no hash here to compare. Firebase owns the
 * password hashing (scrypt), the credential storage, and its own adaptive
 * throttling.
 *
 * What this file owns is the app's OWN login surface: the client calls
 * `/api/auth/login` before it calls Firebase, and reports the outcome after.
 * That gives us a real, durable, cross-instance control over the login form —
 * counters that survive a serverless cold start, a lockout that outlives the
 * tab, and a notification when an account comes under attack.
 *
 * It does NOT stop someone calling Google's identitytoolkit REST API directly
 * with the public web API key; nothing in this repo can. Firebase's own
 * throttling, email-enumeration protection and App Check are the controls at
 * that layer. Anyone reading this to answer "are we protected against
 * credential stuffing" needs both halves of that sentence.
 *
 * PRIVACY: an email address is never stored here. The document key is a
 * salted SHA-256 of the normalized address, so the attempt ledger cannot be
 * mined for a user list, and it lines up with nothing else in the database.
 * The address itself is held only in memory, only long enough to send the
 * lockout notice.
 */

/* --- The policy, in one place ---------------------------------------------- */

/**
 * Requests to the login endpoint allowed per IP per minute.
 *
 * WHY THIS IS NOT A SMALL NUMBER, and what raising it did and did not cost.
 *
 * One sign-in costs TWO requests here — `check` before the credentials go to
 * Firebase and `result` after — so this number halved is how many sign-in
 * attempts an entire egress address gets in a minute. It was 10, which is five
 * attempts a minute shared by everyone behind one IP, and Elovox is mostly a
 * phone app: carrier-grade NAT puts thousands of unrelated people behind a
 * single address and an office or a campus puts hundreds. The refusal is
 * deliberately indistinguishable from a wrong password, so the user who tripped
 * it was told "Incorrect email or password" about a password that was correct —
 * a limit that misfires on real people and lies to them while doing it.
 *
 * 120 is 60 attempts a minute from one address: above any real crowd this app
 * will see, and still orders of magnitude below a script running flat out.
 *
 * WHAT THE RAISE DID LOOSEN, because it is one thing and it is not nothing.
 * The per-ACCOUNT ledger below is untouched: five failures lock the account no
 * matter how many addresses they arrive from, the progressive delay climbs per
 * account, and every failure must carry a ticket that only `check` can mint. The
 * one axis a per-account ledger cannot see is password SPRAYING — a single
 * attempt each against many DIFFERENT addresses, where no account ever reaches
 * its second failure. This limit was the only thing bounding that, and raising
 * it took a sprayer from 5 attempts a minute to 60: a 12x loosening on the one
 * axis this number ever covered. LOGIN_IP_FAILURE_LIMIT is what puts that back,
 * and puts it back tighter than 10 ever had it.
 *
 * The in-process prefilter in app/api/auth/login/route.ts must stay LOOSER than
 * this, or it, and not this, becomes the policy.
 */
export const LOGIN_IP_LIMIT = 120;
export const LOGIN_IP_WINDOW_MS = 60_000;

/**
 * Wrong passwords allowed per IP per hour, net of that address's successes.
 *
 * THE CONTROL THAT ACTUALLY BOUNDS SPRAYING, and why it counts failures rather
 * than requests.
 *
 * A request ceiling has to be generous enough for a whole carrier NAT signing in
 * at once, and anything that generous is generous to a sprayer too. The two
 * populations do not separate on volume; they separate on outcome. People behind
 * a shared address overwhelmingly SUCCEED, and a sprayer — one password against
 * a list of addresses — overwhelmingly FAILS. So the request window above stays
 * wide, and this one, which counts only wrong passwords, stays narrow.
 *
 * THE ARITHMETIC, because a ceiling without one is a guess. Spraying spends
 * exactly one failure per address it tries, so failures per hour IS distinct
 * accounts per hour from that address:
 *
 *   - at 30 failures/hour: at most 30 accounts an hour from one address;
 *   - at the old limit of 10 requests/min: 10 / 2 requests per sign-in = 5
 *     attempts a minute = 300 an hour, so 300 accounts. This is 10x tighter
 *     than the control it replaces;
 *   - at the raised request ceiling alone: 120 / 2 = 60 a minute = 3600 an
 *     hour, so 3600 accounts. This is 120x tighter than that.
 *
 * WHY A REAL CROWD NEVER FEELS IT. Every sign-in that is PROVEN successful — an
 * ID token verified at Google, not a claim in a request body — forgives one
 * recorded failure for that address, so what is counted is failures minus
 * successes, floored at zero. An address whose users are getting in never
 * accumulates, however many of them there are and however often they mistype.
 * Reaching 30 takes thirty more wrong passwords than sign-ins inside one hour,
 * and a real user who has genuinely forgotten their password contributes at most
 * LOCKOUT_AFTER_FAILURES of them before the per-account lock stops that account
 * cold — so 30 is six such people behind one address in one hour with not a
 * single successful sign-in between them.
 *
 * WHAT IT COSTS WHEN IT DOES FIRE, stated rather than glossed. The ceiling
 * blocks the address, not the account, so a real user who shares an address with
 * a sprayer is throttled alongside them until the failures age out of the window
 * one at a time — or sooner, because any success that does get through forgives
 * one. That is the trade, and it is now charged at thirty NET failures instead
 * of at the five attempts a minute the old request limit charged everybody.
 *
 * WHAT IT DOES NOT COVER. A caller that simply never reports its failures is not
 * counted here. It gains nothing by that: it could skip this route altogether
 * and talk to Google's identitytoolkit directly, which no code in this
 * repository can see. Read the note at the top of this file for that half.
 */
export const LOGIN_IP_FAILURE_LIMIT = 30;
export const LOGIN_IP_FAILURE_WINDOW_MS = 60 * 60_000;

/** Consecutive failures that trigger a lockout. */
export const LOCKOUT_AFTER_FAILURES = 5;

/** How long an account stays locked once it trips. */
export const LOCKOUT_MS = 15 * 60_000;

/**
 * How many times one account may be hard-locked inside LOCK_WINDOW_MS before
 * the lock stops re-arming and only the progressive delay remains.
 *
 * THE TRADE THIS SETTLES. Account lockout has one well-known cost: anyone who
 * knows an address can spend failed attempts against it and shut its owner
 * out. The tickets above make each of those attempts cost a rate-limited
 * request, which is most of the fix — but nothing stops a determined attacker
 * re-locking an account the moment each 15-minute window expires, and an owner
 * who is locked out of the login form all day has been denied service just as
 * effectively as if the lock never expired.
 *
 * So the hard lock is a burst control, not a permanent state: it fires for the
 * first few rounds (which is where it does its work against a real guessing
 * run) and then steps aside, leaving the progressive delay — which throttles
 * an attacker just as well and never fully closes the door on the owner.
 * Crossing this line is logged, because an account being hammered for an hour
 * is something an operator should know about.
 */
export const MAX_LOCKS_PER_WINDOW = 3;
export const LOCK_WINDOW_MS = 60 * 60_000;

/**
 * Progressive delay after each failure: 0s, 1s, 2s, 4s, 8s… capped.
 *
 * The first failure costs nothing — typos are the common case and punishing
 * them punishes the account's real owner. From the second on, each failure
 * doubles the wait, so a guessing loop's cost grows faster than its progress
 * while a human retyping a password barely notices.
 */
export function delayForFailures(failures: number): number {
  if (failures <= 1) return 0;
  return Math.min(30_000, 2 ** (failures - 2) * 1000);
}

/** How long an idle ledger row lives before it is treated as absent. */
const LEDGER_TTL_MS = 24 * 60 * 60_000;

/* --- Keys ------------------------------------------------------------------ */

/**
 * Salted hash of the address, used as the ledger's document id.
 *
 * LOGIN_HASH_SALT should be set (any long random string) so the ledger can't
 * be checked against a guessed address by anyone who obtains a database dump.
 * Without it the hash is still not reversible, but it is enumerable against a
 * word list — so the fallback is a constant, and the constant is documented as
 * the weaker mode rather than pretending the salt is optional.
 */
function accountKey(email: string): string {
  const salt = process.env.LOGIN_HASH_SALT ?? "elovox-login-ledger";
  return createHash("sha256")
    .update(`${salt}:${email.trim().toLowerCase()}`)
    .digest("hex");
}

/* --- The ledger ------------------------------------------------------------ */

export interface LoginLedger {
  failures: number;
  /** Epoch ms of the most recent failure. */
  lastFailureAt: number;
  /** Epoch ms the lockout ends, or 0 when not locked. */
  lockedUntil: number;
  /** Epoch ms the lockout notice was last sent, so one attack sends one email. */
  notifiedAt: number;
  /** Hard locks inside the current window, and when that window opened. */
  locks: number;
  lockWindowAt: number;
  /**
   * Outstanding attempt tickets, `${nonce}:${expiresAtMs}`.
   *
   * WHY THIS EXISTS — the failure this closes was real and serious. Without it,
   * `phase: "result"` was an unauthenticated endpoint that took the caller's
   * word for what happened: anyone could POST five
   * `{email: victim, outcome: "failure"}` bodies and lock a stranger out of
   * their own account (and mail-bomb them), or POST one
   * `{outcome: "success"}` and wipe a lockout that was doing its job.
   *
   * A ticket is issued only by `phase: "check"`, which is IP-rate-limited, and
   * is single-use. So every forged failure now costs one of that address's
   * LOGIN_IP_LIMIT requests a minute instead of being free — and, because only
   * a failure the ledger accepted feeds the per-IP spray ceiling, a forged one
   * cannot get a shared address throttled on somebody else's behalf either. The
   * constant is named rather than spelled out: this sentence said "ten" for a
   * while after the number became 120, contradicting the policy it cited.
   *
   * It does NOT make lockout-as-denial-of-service impossible — an attacker with
   * many source IPs can still spend 5 tickets against an address. That is
   * inherent to *any* account-lockout policy and is the reason the notice email
   * exists: the owner is told, with a working reset link, rather than being
   * silently shut out. Raising the cost from "free and instant" to "rate-limited
   * per source" is the part that is actually available to us.
   */
  tickets: string[];
}

const EMPTY: LoginLedger = {
  failures: 0,
  lastFailureAt: 0,
  lockedUntil: 0,
  notifiedAt: 0,
  locks: 0,
  lockWindowAt: 0,
  tickets: [],
};

/** How long an issued attempt ticket is good for. Long enough for a person to
 *  finish typing a password, short enough that a stockpile is worthless. */
const TICKET_TTL_MS = 3 * 60_000;

/** Ceiling on outstanding tickets per account, so `check` can't be looped into
 *  an unbounded array write. Several is enough for a few open tabs. */
const MAX_TICKETS = 6;

function ledgerRef(db: Firestore, key: string) {
  return db.doc(`loginAttempts/${key}`);
}

/** Live tickets only — anything expired is dropped on every read. */
function liveTickets(raw: unknown, now: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is string => {
    if (typeof t !== "string") return false;
    const at = Number(t.split(":")[1]);
    return Number.isFinite(at) && at > now;
  });
}

function readLedger(
  data: FirebaseFirestore.DocumentData | undefined,
  now: number
): LoginLedger {
  if (!data) return { ...EMPTY, tickets: [] };
  const lastFailureAt = Number(data.lastFailureAt ?? 0);
  const lockedUntil = Number(data.lockedUntil ?? 0);
  // A row nobody has touched in a day is stale: a wrong password last Tuesday
  // must not count toward a lockout today. Expired lockouts clear the same
  // way — the counter resets, so the next failure starts a fresh climb rather
  // than instantly re-locking.
  const stale = now - lastFailureAt > LEDGER_TTL_MS;
  const lockExpired = lockedUntil > 0 && lockedUntil <= now;
  const tickets = liveTickets(data.tickets, now);
  // The lock-burst window is its own clock and survives a counter reset —
  // that is the whole point of it: it counts how many times this account has
  // been locked lately, across those resets.
  const rawWindowAt = Number(data.lockWindowAt ?? 0);
  const windowLive = now - rawWindowAt < LOCK_WINDOW_MS;
  const locks = windowLive ? Number(data.locks ?? 0) : 0;
  const lockWindowAt = windowLive ? rawWindowAt : 0;

  if (stale || lockExpired) {
    return {
      ...EMPTY,
      notifiedAt: Number(data.notifiedAt ?? 0),
      locks,
      lockWindowAt,
      // Tickets survive a counter reset: they are about an attempt in flight,
      // not about the account's history.
      tickets,
    };
  }
  return {
    failures: Number(data.failures ?? 0),
    lastFailureAt,
    lockedUntil,
    notifiedAt: Number(data.notifiedAt ?? 0),
    locks,
    lockWindowAt,
    tickets,
  };
}

/** Constant-time membership test, so the ticket list can't be walked by timing. */
function hasTicket(tickets: string[], nonce: string): boolean {
  const want = createHash("sha256").update(nonce).digest();
  let found = false;
  for (const t of tickets) {
    const got = createHash("sha256").update(t.split(":")[0] ?? "").digest();
    if (timingSafeEqual(want, got)) found = true;
  }
  return found;
}

/**
 * Is this account allowed to attempt a sign-in right now?
 *
 * Returns the same shape whether the answer is "locked out" or "still inside
 * the progressive delay" — the CALLER must not tell those apart to the user
 * either. A locked account and a wrong password produce the same sentence on
 * screen; that is the whole point of the lockout being invisible.
 */
export async function checkLoginAllowed(
  db: Firestore,
  email: string,
  now = Date.now()
): Promise<{ allowed: boolean; retryAfterMs: number; ticket?: string }> {
  const ref = ledgerRef(db, accountKey(email));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const ledger = readLedger(snap.data(), now);

    // Both refusals below write the one field the allow path writes anyway, so
    // a refused check costs the same single read and single write a permitted
    // one does. Without it the two branches had visibly different Firestore
    // profiles: the refusal skipped the commit and came back sooner, which
    // made "this account is locked" separable from "that password was wrong"
    // by timing alone — the same oracle the identical response body exists to
    // close, restored in the latency. It also keeps a locked row from being
    // swept while the lock is still open.
    const touch = () =>
      tx.set(ref, { expiresAt: new Date(now + LEDGER_TTL_MS) }, { merge: true });

    if (ledger.lockedUntil > now) {
      touch();
      return { allowed: false, retryAfterMs: ledger.lockedUntil - now };
    }
    const wait = delayForFailures(ledger.failures);
    const readyAt = ledger.lastFailureAt + wait;
    if (wait > 0 && readyAt > now) {
      touch();
      return { allowed: false, retryAfterMs: readyAt - now };
    }

    // Allowed: hand out the ticket that lets the caller report this attempt's
    // outcome. Issued here and nowhere else.
    const nonce = randomBytes(16).toString("hex");
    const tickets = [
      ...ledger.tickets.slice(-(MAX_TICKETS - 1)),
      `${nonce}:${now + TICKET_TTL_MS}`,
    ];
    tx.set(
      ref,
      { tickets, expiresAt: new Date(now + LEDGER_TTL_MS) },
      { merge: true }
    );
    return { allowed: true, retryAfterMs: 0, ticket: nonce };
  });
}

export interface FailureOutcome {
  failures: number;
  /** True on the transition INTO a lockout — the one moment worth an email. */
  justLocked: boolean;
  lockedUntil: number;
}

/**
 * Record a failed attempt and return what it triggered.
 *
 * Transactional because two tabs (or two hosts in a stuffing run) racing on
 * the same account would otherwise both read 4 and both write 5, and the fifth
 * failure — the one that locks — would be counted once instead of twice.
 *
 * A failure arriving while a lock is ALREADY open is counted and nothing else:
 * see `alreadyLocked` below for the invariant that protects.
 */
export async function recordLoginFailure(
  db: Firestore,
  email: string,
  ticket: string,
  now = Date.now()
): Promise<FailureOutcome | null> {
  const ref = ledgerRef(db, accountKey(email));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const ledger = readLedger(snap.data(), now);

    // No valid ticket, no vote. This is what stops a stranger POSTing five
    // failures at somebody else's address; see the note on `tickets` above.
    if (!ticket || !hasTicket(ledger.tickets, ticket)) return null;
    // Consumed whether or not the rest succeeds — a ticket is one attempt.
    const remaining = ledger.tickets.filter(
      (t) => t.split(":")[0] !== ticket
    );

    const failures = ledger.failures + 1;
    /**
     * AN OPEN LOCK IS NEVER EXTENDED. This is the whole of that guarantee.
     *
     * A lock does not stop tickets that were already issued: up to MAX_TICKETS
     * of them survive the lock and stay valid for TICKET_TTL_MS afterwards, so
     * someone with a few tabs open can hold spare tickets when the fifth
     * failure trips the lock and spend them a minute later. Before this check
     * the branch below simply ran again — `lockedUntil` was pushed another
     * LOCKOUT_MS into the future and another of the account's three hourly
     * locks was spent, so the owner's fifteen minutes became half an hour and
     * their lock budget was burned by someone else's requests. Under the
     * documented policy the owner can wait out a lock; under that behaviour
     * they could not, which is a denial of service the docs promised was
     * closed. The failure still counts (the operator log wants to see it), the
     * clock does not move, and no notice is re-sent.
     */
    const alreadyLocked = ledger.lockedUntil > now;
    // A hard lock is available only while this account has locks left in the
    // current window. Past that the failures still count and the progressive
    // delay still climbs — the door just stops being bolted shut. See
    // MAX_LOCKS_PER_WINDOW.
    const locksLeft = ledger.locks < MAX_LOCKS_PER_WINDOW;
    const trip =
      !alreadyLocked && failures >= LOCKOUT_AFTER_FAILURES && locksLeft;
    const exhausted =
      !alreadyLocked && failures >= LOCKOUT_AFTER_FAILURES && !locksLeft;
    if (exhausted) {
      console.warn(
        "[login] lock budget exhausted for one account this hour — throttling only. Someone is hammering it."
      );
    }
    const lockedUntil = alreadyLocked
      ? ledger.lockedUntil
      : trip
        ? now + LOCKOUT_MS
        : 0;
    // One notice per lockout, not one per failed attempt after it: a stuffing
    // run against a real address would otherwise mail its owner every second.
    const justLocked = trip && now - ledger.notifiedAt > LOCKOUT_MS;


    tx.set(
      ref,
      {
        failures,
        lastFailureAt: now,
        lockedUntil,
        tickets: remaining,
        ...(trip
          ? {
              locks: ledger.locks + 1,
              lockWindowAt: ledger.lockWindowAt || now,
            }
          : {}),
        ...(justLocked ? { notifiedAt: now } : {}),
        // Firestore TTL policy target. Set a real Timestamp, not a number —
        // a numeric field is silently ignored by the TTL service.
        expiresAt: new Date(now + LEDGER_TTL_MS),
      },
      { merge: true }
    );

    return { failures, justLocked, lockedUntil };
  });
}

/** A successful sign-in wipes the slate. */
export async function clearLoginFailures(
  db: Firestore,
  email: string
): Promise<void> {
  await ledgerRef(db, accountKey(email))
    .delete()
    .catch(() => {
      // Best effort. A surviving row costs the user one progressive delay on
      // their next sign-in, which is not worth failing a successful login for.
    });
}

/* --- Durable per-IP limiting ----------------------------------------------- */

/**
 * How long a per-IP row lives after it is last touched.
 *
 * It has to outlive the LONGER of the two windows below, not the shorter one.
 * This used to be ten request windows — ten minutes — which was fine while
 * `hits` was the only thing in the row, and would silently have handed a
 * sprayer a free reset once `fails` moved in: the daily purge (or a Firestore
 * TTL policy, which deletes on exactly the same field) would drop a row whose
 * failure history still had fifty minutes left to run.
 */
const IP_ROW_TTL_MS = Math.max(
  LOGIN_IP_WINDOW_MS * 10,
  LOGIN_IP_FAILURE_WINDOW_MS
);

/**
 * The IP is hashed for the same reason the address is: this collection is an
 * attack ledger, and it should not double as a visitor log.
 */
function ipKey(ip: string): string {
  return createHash("sha256")
    .update(`${process.env.LOGIN_HASH_SALT ?? "elovox-login-ledger"}:ip:${ip}`)
    .digest("hex");
}

/** Timestamps still inside their window. Dropping the stale ones on every read
 *  is what makes both counters sliding windows rather than fixed buckets that
 *  hand out a full allowance the instant the clock rolls over. */
function liveHits(raw: unknown, cutoff: number): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t: unknown): t is number => typeof t === "number" && t > cutoff);
}

/**
 * The two cross-instance sliding windows for one IP: how many REQUESTS it made
 * in the last minute, and how many WRONG PASSWORDS it has to its name in the
 * last hour. They share one document, so checking both costs the one
 * transaction checking either used to.
 *
 * A login limit has to hold across instances or it isn't a limit at all, so
 * this one lives in Firestore. It costs one transaction per login attempt,
 * which is the right trade on the app's lowest-volume endpoint. The
 * per-instance `makeRateLimiter` cannot do this job: it is empty after every
 * cold start and every instance keeps its own copy, so on Vercel the real
 * ceiling would be `instances x limit` and would reset whenever the platform
 * felt like it.
 *
 * This predates lib/rateLimit.ts, which now does the same job generically for
 * every other route, and it stays separate on purpose: a login refusal has to
 * be indistinguishable from a wrong password, so it can carry neither the
 * Retry-After header nor the distinct body that `limitOr429` returns. Either
 * would re-open the enumeration oracle this whole file exists to close.
 */
export async function rateLimitIp(
  db: Firestore,
  ip: string,
  now = Date.now()
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const ref = db.doc(`loginRates/${ipKey(ip)}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    const hits = liveHits(data?.hits, now - LOGIN_IP_WINDOW_MS);
    const fails = liveHits(data?.fails, now - LOGIN_IP_FAILURE_WINDOW_MS);
    // The spray ceiling is asked first because it is the tighter of the two,
    // but the two refusals are the same refusal: same shape, same caller
    // handling, and nothing in the answer says which window closed. A caller
    // able to tell "you are throttled" from "you have been guessing" would
    // learn which of its guesses were wrong, which is the whole game.
    if (fails.length >= LOGIN_IP_FAILURE_LIMIT) {
      return {
        allowed: false,
        retryAfterMs: fails[0] + LOGIN_IP_FAILURE_WINDOW_MS - now,
      };
    }
    if (hits.length >= LOGIN_IP_LIMIT) {
      return { allowed: false, retryAfterMs: hits[0] + LOGIN_IP_WINDOW_MS - now };
    }
    hits.push(now);
    // `fails` is written back pruned, so an address that stops failing sheds
    // its history on its own traffic rather than waiting for the sweep.
    tx.set(
      ref,
      { hits, fails, expiresAt: new Date(now + IP_ROW_TTL_MS) },
      { merge: true }
    );
    return { allowed: true, retryAfterMs: 0 };
  });
}

/**
 * Charge this address for one wrong password. See LOGIN_IP_FAILURE_LIMIT.
 *
 * The caller must only reach this for a failure the ACCOUNT ledger accepted —
 * one that carried a valid single-use ticket. A failure anyone can assert is a
 * failure anyone can use to throttle a shared address on purpose, which would
 * turn a spray control into a denial-of-service tool aimed at a carrier NAT.
 */
export async function recordIpFailure(
  db: Firestore,
  ip: string,
  now = Date.now()
): Promise<void> {
  const ref = db.doc(`loginRates/${ipKey(ip)}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const fails = liveHits(snap.data()?.fails, now - LOGIN_IP_FAILURE_WINDOW_MS);
    // Never grows past the ceiling. Past it every request from this address is
    // refused anyway, so the extra entries would buy nothing and an array that
    // grows with an attacker's patience is a write-amplification bug.
    if (fails.length >= LOGIN_IP_FAILURE_LIMIT) return;
    fails.push(now);
    tx.set(
      ref,
      { fails, expiresAt: new Date(now + IP_ROW_TTL_MS) },
      { merge: true }
    );
  });
}

/**
 * Forgive one of this address's recorded failures, because somebody behind it
 * just signed in for real.
 *
 * This is the half that keeps the ceiling off real crowds: the count is
 * failures MINUS successes, so an address whose users are getting in sits at
 * zero no matter how many of them mistype. The oldest failure is the one
 * dropped, which keeps the remaining timestamps a true sliding window.
 *
 * THE PROOF IS THE POINT. The caller must have verified a Firebase ID token
 * belonging to the address being cleared before it gets here. A credit that
 * could be claimed by asserting success would be minted by the sprayer faster
 * than it spent failures, and the ceiling would be decoration.
 */
export async function creditIpSuccess(
  db: Firestore,
  ip: string,
  now = Date.now()
): Promise<void> {
  const ref = db.doc(`loginRates/${ipKey(ip)}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const fails = liveHits(snap.data()?.fails, now - LOGIN_IP_FAILURE_WINDOW_MS);
    // Floored at zero rather than banked: an address cannot build up credit
    // during a quiet hour and spend it on a burst of guesses later.
    if (fails.length === 0) return;
    tx.set(
      ref,
      { fails: fails.slice(1), expiresAt: new Date(now + IP_ROW_TTL_MS) },
      { merge: true }
    );
  });
}

/* --- Retention, without waiting on an IAM grant -----------------------------
   Both ledgers stamp `expiresAt`, and a Firestore TTL policy on that field is
   the natural way to clean them up. Creating one needs
   `datastore.indexes.update`, which the project's operator console does not
   currently hold — it answers 403 — and it is the same grant the opsEvents
   sweep already went around rather than waited for.

   So the app takes responsibility for its own data, the same way it already
   does for telemetry: the daily cron sweeps expired rows itself. If the TTL
   policies are added later the two are complementary — both only ever delete
   rows that are already expired, so whichever runs first leaves the other
   nothing to do. */

/** Delete expired rows from one ledger. Best effort; never throws. */
async function purgeExpired(
  db: Firestore,
  collection: string,
  limit: number
): Promise<number> {
  try {
    const snap = await db
      .collection(collection)
      .where("expiresAt", "<", new Date())
      .limit(limit)
      .get();
    if (snap.empty) return 0;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    return snap.size;
  } catch (err) {
    // An index that doesn't exist yet is the likeliest failure, and it is not
    // worth failing the whole cron run over.
    console.error(`[login] purge of ${collection} failed`, err);
    return 0;
  }
}

/** Sweep both login ledgers. Called by the daily cron. */
export async function purgeExpiredLoginRows(
  db: Firestore | null,
  limit = 500
): Promise<number> {
  if (!db) return 0;
  const [attempts, rates] = await Promise.all([
    purgeExpired(db, "loginAttempts", limit),
    purgeExpired(db, "loginRates", limit),
  ]);
  return attempts + rates;
}
