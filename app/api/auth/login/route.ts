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
  checkLoginAllowed,
  clearLoginFailures,
  rateLimitIp,
  recordLoginFailure,
} from "@/lib/loginGuard";
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
 *  the real limit: this trims noise, it does not set policy. */
const burst = makeRateLimiter(60, 60_000);

/**
 * The only response this route ever returns on refusal. One status, one body,
 * one sentence, NO variable headers.
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

  let link: string;
  try {
    link = await getAuth(app).generatePasswordResetLink(email);
  } catch {
    // No such account, or Firebase refused. Either way there is nobody to
    // warn. Nothing is logged about which — that would be the enumeration
    // oracle this whole route exists to avoid.
    return;
  }

  // Category "security" in lib/email/config.ts, which is what makes this
  // message unstoppable by a preference, unsuppressible by an unsubscribe, and
  // entitled to the last of the day's send allowance if it comes to that.
  await send(getAdminDb(), lockoutNotice(email, link, Math.round(LOCKOUT_MS / 60000)));
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

  // BOTH phases, not just `check`. The durable per-IP window used to sit
  // inside the check branch, which left `result` fronted by nothing but an
  // in-process Map that is empty on every cold start and shared with nobody.
  // The ticket requirement below is the real control on that path; this is the
  // second lock on the same door, and it is one line.
  const perIp = await rateLimitIp(db, ip, now).catch(() => null);
  if (perIp && !perIp.allowed) {
    logRejectedInput("auth/login", "ip_rate_limited");
    return refuse();
  }

  if (phase === "check") {
    const verdict = await checkLoginAllowed(db, email.value, now).catch(
      () => null
    );
    // A Firestore blip fails open for the same reason the missing-credential
    // branch does.
    if (verdict && !verdict.allowed) return refuse();
    return allow(verdict?.ticket);
  }

  /* phase === "result" — reporting what Firebase said.
     Neither branch below takes the caller's word for it. */

  if (payload.outcome === "success") {
    // PROOF, not a claim. A successful sign-in leaves the client holding a
    // Firebase ID token; the server verifies it and checks it belongs to the
    // address whose counters are being cleared. Without this, one anonymous
    // POST wiped any account's lockout — the control undone by the thing it
    // was controlling.
    const cleared = await clearIfProven(req, email.value, db);
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
  db: Firestore
): Promise<boolean> {
  const identity = await verifiedIdentity(req);
  if (!identity?.email) return false;
  if (identity.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
    return false;
  }
  await clearLoginFailures(db, email);
  return true;
}
