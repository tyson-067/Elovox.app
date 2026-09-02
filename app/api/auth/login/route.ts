import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { clientIp, logRejectedInput, makeRateLimiter, verifiedIdentity } from "@/lib/verify";
import type { Firestore } from "firebase-admin/firestore";
import { validateEmail } from "@/lib/validation";
import { GENERIC_CREDENTIALS } from "@/lib/authMessages";
import { isMailConfigured } from "@/lib/email/config";
import { send } from "@/lib/email/send";
import { lockoutNotice } from "@/lib/email/messages";
import {
  LOCKOUT_AFTER_FAILURES,
  LOCKOUT_MS,
  LOGIN_IP_LIMIT,
  LOGIN_IP_WINDOW_MS,
  checkLoginAllowed,
  clearLoginFailures,
  creditIpSuccess,
  rateLimitIp,
  recordIpFailure,
  recordLoginFailure,
} from "@/lib/loginGuard";
import { limited } from "@/lib/rateLimit";
import { readJsonObject } from "@/lib/requestBody";

/**
 * The login gate.
 *
 * The client calls this BEFORE handing credentials to Firebase (`phase:
 * "check"`) and again AFTER Firebase answers (`phase: "result"`). That gives
 * the app a durable, cross-instance record of failed sign-ins for an endpoint
 * whose actual authentication happens at Google — see the long note at the top
 * of lib/loginGuard.ts for exactly what this does and does not defend.
 *
 * THE ONE RULE THIS ROUTE MUST NEVER BREAK: no response distinguishes a locked
 * account from a wrong password from an address that has never existed. Every
 * refusal is the same status, the same body, the same sentence. The route
 * never looks up whether an account exists, so it cannot leak that even by
 * timing — the ledger is keyed on a hash of the address, and a hash exists for
 * an address whether or not an account does.
 */

export const runtime = "nodejs";

/** Cheap per-instance guard in front of the durable one, so a flood costs a
 *  Map lookup rather than a Firestore transaction. Deliberately looser than
 *  the real limit: this trims noise, it does not set policy. It has to be
 *  raised whenever LOGIN_IP_LIMIT is — at 60 against a durable 120 the
 *  prefilter would bind first on any single instance, and the number nobody
 *  reasoned about would quietly become the policy. */
const burst = makeRateLimiter(LOGIN_IP_LIMIT * 3, LOGIN_IP_WINDOW_MS);

/**
 * The refusal for the `result` phase and for a malformed request. One status,
 * one body, one sentence, NO variable headers. The `check` phase has its own,
 * uniform shape — see `checkAnswer` below for why it needs one.
 *
 * It used to carry `retry-after`, which was a nice touch and a hole: a wrong
 * password produced no header, a progressive delay produced a small one, and a
 * lockout produced one in the hundreds. Anyone could therefore tell those three
 * apart from outside — which is the exact distinction the whole design exists
 * to hide, restored in a header nobody was looking at. The argument for it
 * ("advisory, so clients back off") was not worth an oracle: the client already
 * knows to stop, because it was told no.
 */
function refuse() {
  return NextResponse.json(
    { ok: false, message: GENERIC_CREDENTIALS },
    { status: 200, headers: { "cache-control": "no-store" } }
  );
}

function allow(ticket?: string) {
  return NextResponse.json(
    { ok: true, ...(ticket ? { ticket } : {}) },
    { status: 200, headers: { "cache-control": "no-store" } }
  );
}

/**
 * The ONE response shape the `check` phase ever returns.
 *
 * `allow()` and `refuse()` answer with different bodies — `{ok, ticket}` against
 * `{ok, message}` — and in the check phase that difference was itself the
 * oracle this route exists to close. A locked or throttled account came back
 * with a body of a different shape, a different length and a different key set
 * from a healthy one, BEFORE any password had been tried. The rendered sentence
 * was identical, so the leak was invisible to anyone reading the UI and obvious
 * to anyone reading the wire.
 *
 * Both answers now carry the same two keys in the same order, and a refusal
 * carries a DECOY ticket: a nonce of the same 32 hex characters that was never
 * written to any ledger. It is indistinguishable on the wire and worthless if
 * replayed — `result` will not find it and answers exactly as it answers every
 * other invalid ticket.
 *
 * THE RESIDUAL SIGNAL, stated instead of papered over. `ok` is still false, and
 * `false` is one byte longer than `true`. That flag cannot go: the client has to
 * know not to spend the attempt at Google, and a check that always said yes
 * would be a lockout that does nothing. So a locked account remains
 * distinguishable from a wrong password by anyone who reads this route's raw
 * response — which is a different and much smaller thing than it being
 * distinguishable to anyone using the login form. The client's own behaviour
 * leaks it more loudly anyway: on `ok: false` it never calls Firebase, so the
 * whole sign-in returns in a fraction of the time a real attempt takes, and
 * that is not fixable from this file. docs/AUTH_SECURITY.md says so plainly
 * rather than claiming a property the code does not have.
 */
function checkAnswer(allowed: boolean, ticket?: string) {
  return NextResponse.json(
    { ok: allowed, ticket: ticket ?? randomBytes(16).toString("hex") },
    { status: 200, headers: { "cache-control": "no-store" } }
  );
}

/**
 * Tell the account's owner that someone has been trying to get in, and give
 * them a way to take the account back.
 *
 * The reset link is minted by Firebase Admin so it is a real, single-use link
 * against the live account — not a URL we assembled. If the address has no
 * account, `generatePasswordResetLink` throws and we send nothing: an email
 * that arrives only for registered addresses is not a leak, because the person
 * receiving it is the account's owner, not the attacker.
 */
async function notifyLockout(email: string): Promise<void> {
  if (!isMailConfigured()) {
    // Say so once, loudly, in the operator log. A lockout that nobody is told
    // about is a support ticket waiting to happen, and silence here would let
    // that ship unnoticed.
    console.warn(
      "[login] account locked but no mailer is configured (RESEND_API_KEY / MAIL_FROM unset)"
    );
    return;
  }
  const app = getAdminApp();
  if (!app) return;
  const db = getAdminDb();

  let link: string;
  try {
    link = await getAuth(app).generatePasswordResetLink(email);
  } catch {
    // No such account, or Firebase refused. Either way there is nobody to
    // warn. Nothing is logged about which — that would be the enumeration
    // oracle this whole route exists to avoid.
    return;
  }

  // THE GLOBAL CEILING, and it is deliberately not per address.
  //
  // Nothing above this line is authenticated. A caller who knows a hundred
  // addresses can trip a hundred lockouts, each of which is one honest notice
  // to one real owner — and a hundred is the free plan's entire daily
  // allowance, after which every payment-failed, welcome and export-ready
  // email in the app is dropped until midnight. A per-address cap counts that
  // as a hundred separate, permissible sends and stops none of it, so the
  // limit is keyed on a constant and shared by every lockout in the app. See
  // LIMITS["lockout-notice"] in lib/rateLimit.ts for the number and the sums.
  //
  // Claimed AFTER the reset link, so a probe at an address with no account
  // cannot spend units that a real owner needs, and immediately before the
  // send, so a claimed unit means a message was actually attempted.
  if (await limited(db, "lockout-notice", "global")) {
    console.warn(
      "[login] lockout notice suppressed: the global daily cap is spent. The lockout itself still applies — only the email was dropped."
    );
    return;
  }

  // Category "security" in lib/email/config.ts, which is what makes this
  // message unstoppable by a preference and unsuppressible by an unsubscribe.
  // It no longer entitles the notice to the LAST message of the day: security
  // still ranks first when a queue has to be trimmed, but its share of the
  // daily budget is deliberately half, and below billing's and transactional's,
  // precisely because this is the message an unauthenticated caller can
  // provoke.
  const result = await send(
    db,
    lockoutNotice(email, link, Math.round(LOCKOUT_MS / 60000))
  );
  if (!result.sent) {
    // Said out loud, because the alternative is a log that implies a warning
    // reached somebody when it did not. `outcome` names which gate stopped it
    // — the budget, a suppression, or the provider.
    console.warn(
      `[login] lockout notice not sent (${result.outcome}). The lockout itself still applies.`
    );
  }
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (burst(ip)) return refuse();

  const parsed = await readJsonObject(req);
  if (!parsed.ok) {
    // Logged with its OWN reason. Falling through to the email check answered
    // correctly but recorded "email_empty" for an oversized or malformed body,
    // which is the difference between "a form field was blank" and "someone is
    // posting megabytes at the login endpoint".
    logRejectedInput("auth/login", parsed.reason);
    return refuse();
  }
  const payload: Record<string, unknown> = parsed.body;

  // Validated server-side regardless of what the form did, and the reason is
  // logged as a machine code while the CALLER is told only the generic line.
  const email = validateEmail(payload.email);
  if (!email.ok) {
    logRejectedInput("auth/login", email.reason ?? "email_invalid");
    return refuse();
  }

  const phase =
    payload.phase === "result" ? "result" : payload.phase === "check" ? "check" : null;
  if (!phase) {
    logRejectedInput("auth/login", "phase_invalid");
    return refuse();
  }

  const db = getAdminDb();
  if (!db) {
    // No Admin SDK means no durable ledger. FAIL OPEN, deliberately: this is a
    // throttle in front of an authentication that happens elsewhere, and
    // refusing every sign-in because a service account is missing would lock
    // out the whole product to protect nothing. The gap is logged so it can't
    // ship quietly.
    console.warn("[login] guard inactive: FIREBASE_SERVICE_ACCOUNT unset");
    return allow();
  }

  const now = Date.now();

  // BOTH phases, not just `check`. The durable per-IP windows used to sit
  // inside the check branch, which left `result` fronted by nothing but an
  // in-process Map that is empty on every cold start and shared with nobody.
  // The ticket requirement below is the real control on that path; this is the
  // second lock on the same door, and it is one line. It asks two questions —
  // the request ceiling and the spray ceiling — and answers them identically.
  const perIp = await rateLimitIp(db, ip, now).catch(() => null);
  if (perIp && !perIp.allowed) {
    logRejectedInput("auth/login", "ip_rate_limited");
    // Answered in the phase's own shape. A check refused for the CALLER's
    // traffic has to look exactly like a check refused for the ACCOUNT's
    // state, or the body says which of the two happened.
    return phase === "check" ? checkAnswer(false) : refuse();
  }

  if (phase === "check") {
    const verdict = await checkLoginAllowed(db, email.value, now).catch(
      () => null
    );
    // A Firestore blip fails open for the same reason the missing-credential
    // branch does.
    return checkAnswer(!verdict || verdict.allowed, verdict?.ticket);
  }

  /* phase === "result" — reporting what Firebase said.
     Neither branch below takes the caller's word for it. */

  if (payload.outcome === "success") {
    // PROOF, not a claim. A successful sign-in leaves the client holding a
    // Firebase ID token; the server verifies it and checks it belongs to the
    // address whose counters are being cleared. Without this, one anonymous
    // POST wiped any account's lockout — the control undone by the thing it
    // was controlling.
    const cleared = await clearIfProven(req, email.value, db, ip, now);
    if (!cleared) {
      logRejectedInput("auth/login", "unproven_success");
      return refuse();
    }
    return allow();
  }

  // A failure only counts if it carries the single-use ticket `check` issued.
  // See the long note on `tickets` in lib/loginGuard.ts for what this stops.
  const ticket = typeof payload.ticket === "string" ? payload.ticket : "";
  const outcome = await recordLoginFailure(db, email.value, ticket, now).catch(
    () => null
  );
  if (outcome === null) {
    logRejectedInput("auth/login", "no_valid_ticket");
    return refuse();
  }
  // Charged to the ADDRESS as well as to the account, and only now — a failure
  // the ledger accepted is one that carried a single-use ticket, so this cannot
  // be used to throttle a carrier NAT by POSTing failures at it. This is the
  // per-IP spray ceiling: the per-account ledger above cannot see one password
  // tried once each against a thousand different addresses, and this can.
  // Awaited, because a sprayer that outruns its own bookkeeping is not
  // throttled; it fails open on a Firestore blip like everything else here.
  await recordIpFailure(db, ip, now).catch(() => {
    // An uncounted failure is a smaller problem than a sign-in refused because
    // a counter was unreachable.
  });
  if (outcome.justLocked) {
    logRejectedInput("auth/login", "account_locked");
    // Not awaited into the response path — the caller is a browser waiting to
    // render an error, and an SMTP round trip has no business in that wait.
    void notifyLockout(email.value);
  } else {
    logRejectedInput(
      "auth/login",
      `failed_attempt_${Math.min(outcome.failures, LOCKOUT_AFTER_FAILURES)}`
    );
  }
  return refuse();
}

/**
 * Clear the ledger, but only on proof that the sign-in really happened.
 *
 * The bearer token is verified through the same path every other route uses
 * (`verifyUser` → Google's identitytoolkit), and the address on it must match
 * the one being cleared — otherwise anyone holding any valid Elovox session
 * could clear anyone else's lockout.
 */
async function clearIfProven(
  req: NextRequest,
  email: string,
  db: Firestore,
  ip: string,
  now: number
): Promise<boolean> {
  const identity = await verifiedIdentity(req);
  if (!identity?.email) return false;
  if (identity.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
    return false;
  }
  await clearLoginFailures(db, email);
  // The same proof pays for the ADDRESS too. A real sign-in from behind a
  // shared egress address forgives one of that address's recorded failures,
  // which is what keeps the spray ceiling off a carrier NAT whose users are
  // getting in — see LOGIN_IP_FAILURE_LIMIT. It is deliberately downstream of
  // the token check: a credit anyone could claim would be minted by a sprayer
  // faster than it spent failures.
  await creditIpSuccess(db, ip, now).catch(() => {
    // Best effort, like the ledger delete above: the credit is worth at most
    // one slot in an hour-long window and is not worth failing a real sign-in.
  });
  return true;
}
