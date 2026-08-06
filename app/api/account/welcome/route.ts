import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { clientIp, verifyVerifiedUser } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";
import { isMailConfigured } from "@/lib/email/config";
import { send } from "@/lib/email/send";
import { welcome } from "@/lib/email/messages";
import { claimOnce, confirmOnce, releaseOnce } from "@/lib/email/once";

/**
 * The welcome email, sent once per account.
 *
 * WHY THERE IS A ROUTE FOR THIS AT ALL. Sign-up happens entirely in the
 * browser against Firebase Auth — there is no server step to hang this off,
 * and no webhook from Firebase to receive. The alternatives were a nightly
 * cron scanning every auth record for new accounts (a welcome that arrives up
 * to a day late, and a full user-table scan every night forever) or this: the
 * client says "I'm here" once, and the server decides whether that is news.
 *
 * The client cannot cause a second send. `claimOnce` is a durable Firestore
 * claim keyed on the uid, so calling this endpoint a thousand times sends one
 * email — which matters, because the caller is a browser and browsers are not
 * trusted here for anything.
 *
 * Requires a VERIFIED email. Sending a welcome to an address nobody has proved
 * they own is how a stranger's inbox learns they have an Elovox account.
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (await limited(getAdminDb(), "account-welcome", clientIp(req))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const uid = await verifyVerifiedUser(req);
  // No token, unverified address, or Firebase unreachable. Answer the same
  // bland ok in every case: this endpoint reveals nothing about accounts.
  if (!uid || uid === "unverified") return NextResponse.json({ ok: true });

  const app = getAdminApp();
  if (!isMailConfigured() || !app) return NextResponse.json({ ok: true });

  const db = getAdminDb();
  if (!(await claimOnce(db, "welcome", uid))) {
    return NextResponse.json({ ok: true, already: true });
  }

  // The address and name come from the Admin SDK, never from the request
  // body. A client that could name its own recipient would be a way to send
  // Elovox-branded mail to anyone.
  const { getAuth } = await import("firebase-admin/auth");
  let email: string | null = null;
  let firstName: string | undefined;
  try {
    const user = await getAuth(app).getUser(uid);
    email = user.email ?? null;
    firstName = user.displayName?.trim().split(/\s+/)[0] || undefined;
  } catch {
    await releaseOnce(db, "welcome", uid);
    return NextResponse.json({ ok: true });
  }
  if (!email) {
    await releaseOnce(db, "welcome", uid);
    return NextResponse.json({ ok: true });
  }

  const result = await send(db, welcome(email, uid, firstName));
  if (result.sent) {
    // Mark the claim as actually fulfilled. This was missing, so every
    // successful welcome sat in `emailOnce` reading `sent: false` — harmless
    // for the guard itself (the claim's existence is what blocks a second
    // send) but a straight lie to anyone later asking "did this account get
    // its welcome?", which is the only reason the field exists.
    await confirmOnce(db, "welcome", uid);
  } else {
    // Hand the claim back so tomorrow's first visit can try again. Without
    // this, an account created during a provider outage never gets a welcome.
    await releaseOnce(db, "welcome", uid);
  }

  return NextResponse.json({ ok: true, sent: result.sent });
}
