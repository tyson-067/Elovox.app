import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import {
  adminIdentity,
  adminEmailList,
  makeRateLimiter,
  clientIp,
} from "@/lib/verify";
import { recordAdminDenied } from "@/lib/opsMetrics";
import { recordAdminAction } from "@/lib/adminAudit";
import { eraseAccount } from "@/lib/accountDeletion";

// Operator account controls — the two heaviest levers in the console, both
// grounded in commitments the site already makes:
//
//   POST {uid, action: "disable" | "enable"}
//     The suspension right /terms reserves ("We may suspend or end your
//     access if you break these terms"). Uses Firebase Auth's own `disabled`
//     flag: sign-in stops immediately, and lib/verify.ts lookupUser already
//     treats a disabled account as no valid caller, so API access dies with
//     it inside the token's ≤1h window. Fully reversible.
//
//   DELETE {uid, confirmEmail}
//     The operator half of the deletion promises in /privacy (requests by
//     email, 30-day window) and /children (delete an under-13's data on
//     report). Runs the SAME fail-closed sequence as self-serve deletion via
//     lib/accountDeletion.ts. confirmEmail must match the target account's
//     email exactly — a server-side type-to-confirm, so a fat-fingered uid
//     can never erase the wrong person.
//
// Accounts on ADMIN_EMAILS can't be disabled or deleted from here: an
// operator console must not be able to eat its own operators (or be used by
// one compromised admin session to silently lock out the rest). Those go
// through the Firebase console, deliberately out of band.
//
// Everything is audit-logged, including failures of the dangerous half.

export const runtime = "nodejs";

const rateLimited = makeRateLimiter(10);

const UID_RE = /^[A-Za-z0-9]{1,128}$/;

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/account", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const app = getAdminApp();
  const db = getAdminDb();
  if (!app || !db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (rateLimited(admin.uid)) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const body = await readBody(req);
  const uid = typeof body.uid === "string" ? body.uid : "";
  const action = body.action;
  if (!UID_RE.test(uid)) {
    return NextResponse.json({ error: "Bad uid." }, { status: 400 });
  }
  if (action !== "disable" && action !== "enable") {
    return NextResponse.json({ error: "Bad action." }, { status: 400 });
  }

  const { getAuth } = await import("firebase-admin/auth");
  let user;
  try {
    user = await getAuth(app).getUser(uid);
  } catch (err) {
    if ((err as { code?: string })?.code === "auth/user-not-found") {
      return NextResponse.json({ error: "No such account." }, { status: 404 });
    }
    throw err;
  }

  const targetEmail = user.email?.toLowerCase() ?? null;
  if (
    action === "disable" &&
    targetEmail &&
    adminEmailList().includes(targetEmail)
  ) {
    return NextResponse.json(
      {
        error:
          "That account is on ADMIN_EMAILS. Operator accounts are managed in the Firebase console, not from here.",
      },
      { status: 403 }
    );
  }

  await getAuth(app).updateUser(uid, { disabled: action === "disable" });

  await recordAdminAction(db, {
    action: action === "disable" ? "account.disable" : "account.enable",
    actor: admin.email,
    targetUid: uid,
    targetEmail: targetEmail ?? undefined,
  });

  return NextResponse.json({ ok: true, disabled: action === "disable" });
}

export async function DELETE(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/account", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const app = getAdminApp();
  const db = getAdminDb();
  if (!app || !db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (rateLimited(admin.uid)) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const body = await readBody(req);
  const uid = typeof body.uid === "string" ? body.uid : "";
  const confirmEmail =
    typeof body.confirmEmail === "string"
      ? body.confirmEmail.trim().toLowerCase()
      : "";
  if (!UID_RE.test(uid)) {
    return NextResponse.json({ error: "Bad uid." }, { status: 400 });
  }

  const { getAuth } = await import("firebase-admin/auth");
  let user;
  try {
    user = await getAuth(app).getUser(uid);
  } catch (err) {
    if ((err as { code?: string })?.code === "auth/user-not-found") {
      return NextResponse.json({ error: "No such account." }, { status: 404 });
    }
    throw err;
  }

  const targetEmail = user.email?.toLowerCase() ?? null;
  // The typed confirmation is validated SERVER-side, against the live auth
  // record: the UI asks the operator to type the email, but a direct curl
  // gets the same protection.
  if (!targetEmail || targetEmail !== confirmEmail) {
    return NextResponse.json(
      {
        error:
          "confirmEmail doesn't match the account's email. Nothing was deleted.",
      },
      { status: 400 }
    );
  }
  if (adminEmailList().includes(targetEmail)) {
    return NextResponse.json(
      {
        error:
          "That account is on ADMIN_EMAILS. Remove it from the allow-list first, or use the account's own settings.",
      },
      { status: 403 }
    );
  }

  const result = await eraseAccount(app, db, uid, {
    refundContext: "admin-deletion",
  });

  await recordAdminAction(db, {
    action: "account.delete",
    actor: admin.email,
    targetUid: uid,
    targetEmail,
    ok: result.ok,
    detail: result.ok ? undefined : { failedStep: result.step },
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          result.step === "billing"
            ? "Couldn't confirm the subscription is stopped, so nothing was deleted. Try again in a moment."
            : result.step === "auth-record"
              ? "The data was removed but the login itself couldn't be closed. Try again in a moment."
              : "The deletion couldn't finish. Check the account and try again.",
        step: result.step,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({ deleted: true });
}
