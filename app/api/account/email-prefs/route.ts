import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import {
  clientIp,
  logRejectedInput,
  makeRateLimiter,
  verifyVerifiedUser,
} from "@/lib/verify";
import { readJsonObject } from "@/lib/requestBody";
import { getSuppression } from "@/lib/email/suppression";
import { markUnsubscribed, upsertContact } from "@/lib/email/audience";
import {
  PREF_KEYS,
  PREF_LABELS,
  readPrefs,
  writePrefs,
  type PrefState,
} from "@/lib/email/prefs";
import type { EmailPrefKey } from "@/lib/email/config";

/**
 * The email switches on /account.
 *
 * These read and write the SAME store the unsubscribe link does — the
 * suppression list, keyed by address (see the note at the top of
 * lib/email/prefs.ts). One store, so a link clicked on a phone and a toggle
 * flipped on a laptop cannot disagree.
 *
 * The address is taken from the verified ID token, never from the body. A
 * route that accepted an address would let anyone unsubscribe anyone, which is
 * exactly what the signed token on the public link exists to prevent — it
 * would be odd to close that door and leave this one open.
 *
 * Requires a VERIFIED email for the same reason: an unverified address belongs
 * to whoever actually owns it, and their preferences are not this account's to
 * change.
 */

export const runtime = "nodejs";

const rateLimited = makeRateLimiter(30, 60 * 1000);

interface Payload {
  prefs: PrefState;
  /** Present when the address is blocked for a reason no switch can undo. */
  blocked: "hard-bounce" | "complaint" | null;
  labels: typeof PREF_LABELS;
  order: EmailPrefKey[];
}

/** The address on the account, or null. Admin SDK only — the token gives a
 *  uid, and the uid is what the address is looked up from. */
async function addressFor(req: NextRequest): Promise<string | null> {
  const uid = await verifyVerifiedUser(req);
  if (!uid || uid === "unverified") return null;
  const app = getAdminApp();
  if (!app) return null;
  try {
    const { getAuth } = await import("firebase-admin/auth");
    const user = await getAuth(app).getUser(uid);
    return user.email ?? null;
  } catch {
    return null;
  }
}

async function payloadFor(email: string): Promise<Payload> {
  const db = getAdminDb();
  const [prefs, record] = await Promise.all([
    readPrefs(db, email),
    getSuppression(db, email),
  ]);
  const blocked =
    record && (record.reason === "hard-bounce" || record.reason === "complaint")
      ? record.reason
      : null;
  return { prefs, blocked, labels: PREF_LABELS, order: PREF_KEYS };
}

export async function GET(req: NextRequest) {
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }
  const email = await addressFor(req);
  if (!email) return NextResponse.json({ error: "Not available." }, { status: 401 });

  return NextResponse.json(await payloadFor(email), {
    headers: { "cache-control": "private, no-store" },
  });
}

export async function POST(req: NextRequest) {
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }
  const email = await addressFor(req);
  if (!email) return NextResponse.json({ error: "Not available." }, { status: 401 });

  const parsed = await readJsonObject(req);
  if (!parsed.ok) {
    logRejectedInput("account/email-prefs", parsed.reason);
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  // Only the four known keys, only booleans. Anything else is dropped rather
  // than rejected: a client sending an unknown key is a version skew, and the
  // switches it DID send should still take effect.
  const incoming = (parsed.body as { prefs?: unknown }).prefs;
  const next: Partial<PrefState> = {};
  if (incoming && typeof incoming === "object" && !Array.isArray(incoming)) {
    for (const key of PREF_KEYS) {
      const value = (incoming as Record<string, unknown>)[key];
      if (typeof value === "boolean") next[key] = value;
    }
  }
  if (Object.keys(next).length === 0) {
    // Either the body carried no known switch, or every value was the wrong
    // type. Recorded as a machine reason; the caller is told only that there
    // was nothing to change.
    logRejectedInput("account/email-prefs", "no-valid-prefs");
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const db = getAdminDb();
  // Returns what is ACTUALLY in force, which can differ from what was asked:
  // a bounced or complained address can't switch anything back on.
  const prefs = await writePrefs(db, email, next);

  // Keep Resend's own contact record in step, so a Broadcast — which this app
  // does not filter itself — respects the tips switch too. Best-effort: the
  // local store is the one that decides, and it has already been written.
  if (next.tips === false) {
    void markUnsubscribed(email).catch(() => {});
  } else if (next.tips === true) {
    void upsertContact({ email, unsubscribed: false }).catch(() => {});
  }

  return NextResponse.json(
    { ...(await payloadFor(email)), prefs },
    { headers: { "cache-control": "private, no-store" } }
  );
}
