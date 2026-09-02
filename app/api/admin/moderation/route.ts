import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { adminIdentity, adminEmailList, clientIp } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";
import { recordAdminDenied } from "@/lib/opsMetrics";
import { recordAdminAction } from "@/lib/adminAudit";
import { sanitizeText } from "@/lib/validation";
import {
  applyStrike,
  liftSuspension,
  reinstate,
  getModerationStatus,
  effectiveState,
} from "@/lib/moderation";
import { readJsonObject } from "@/lib/requestBody";

// Manual moderation, the operator side of lib/moderation.ts. Strikes are
// about CONDUCT the operator can point to (a user report, abuse in the ops
// log, an offensive public handle) — the reason field says what, and it goes
// in two durable logs (moderationEvents + adminAudit). Nothing here reads or
// asks for practice content.
//
// POST {uid, action:"strike", severity:1|2|3, reason}
// POST {uid, action:"lift"}       — end a suspension early (strikes stand)
// POST {uid, action:"reinstate"}  — wipe the slate, re-enable the login
//
// A strike that lands on "banned" also disables the Firebase account (the
// full lock the word means), except for ADMIN_EMAILS accounts — the console
// must not be able to eat its operators. Billing is deliberately untouched:
// the response flags a live subscription so the operator settles it from the
// Billing controls, where the refund rules live.

export const runtime = "nodejs";

const UID_RE = /^[A-Za-z0-9]{1,128}$/;

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  // Through the shared reader (lib/requestBody.ts): size cap + shape check,
  // one implementation. Admin routes are authenticated, which bounds WHO can
  // post a huge body, not how big it is.
  const parsed = await readJsonObject(req);
  return parsed.ok ? parsed.body : {};
}

export async function POST(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/moderation", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const app = getAdminApp();
  const db = getAdminDb();
  if (!app || !db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (await limited(getAdminDb(), "admin-moderation", admin.uid)) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const body = await readBody(req);
  const uid = typeof body.uid === "string" ? body.uid : "";
  const action = body.action;
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
  const targetIsAdmin =
    !!targetEmail && adminEmailList().includes(targetEmail);

  if (action === "strike") {
    const severity = Number(body.severity);
    const reason = sanitizeText(body.reason).slice(0, 300).trim();
    if (severity !== 1 && severity !== 2 && severity !== 3) {
      return NextResponse.json({ error: "severity must be 1, 2, or 3." }, { status: 400 });
    }
    if (reason.length < 3) {
      return NextResponse.json(
        { error: "A strike needs a written reason — it goes in the record." },
        { status: 400 }
      );
    }
    if (targetIsAdmin) {
      return NextResponse.json(
        {
          error:
            "That account is on ADMIN_EMAILS. Operator accounts are managed in the Firebase console, not from here.",
        },
        { status: 403 }
      );
    }

    const outcome = await applyStrike(db, uid, {
      severity: severity as 1 | 2 | 3,
      reason,
      source: "manual",
      actor: admin.email,
    });

    // Crossing into "banned" is the full lock. lookupUser (lib/verify.ts)
    // already treats a disabled account as no valid caller, so API access
    // dies with the token inside the hour; sign-in dies immediately.
    let lockedLogin = false;
    if (outcome.state === "banned" && !user.disabled) {
      await getAuth(app).updateUser(uid, { disabled: true });
      lockedLogin = true;
    }

    // Billing is the operator's next decision, not this route's side effect.
    const planSnap = await db.doc(`users/${uid}/profile/plan`).get();
    const planStatus = planSnap.data()?.status;
    const hasLiveSubscription =
      typeof planStatus === "string" &&
      ["trialing", "active", "past_due", "unpaid"].includes(planStatus);

    await recordAdminAction(db, {
      action: "moderation.strike",
      actor: admin.email,
      targetUid: uid,
      targetEmail: targetEmail ?? undefined,
      detail: {
        severity,
        reason,
        strikesAfter: outcome.strikes,
        stateAfter: outcome.state,
        lockedLogin,
      },
    });

    return NextResponse.json({
      ok: true,
      strikes: outcome.strikes,
      state: outcome.state,
      suspendedUntil: outcome.suspendedUntil ?? null,
      lockedLogin,
      hasLiveSubscription,
    });
  }

  if (action === "lift") {
    const { ok } = await liftSuspension(db, uid, admin.email);
    if (!ok) {
      return NextResponse.json(
        { error: "That account isn't suspended." },
        { status: 409 }
      );
    }
    await recordAdminAction(db, {
      action: "moderation.lift",
      actor: admin.email,
      targetUid: uid,
      targetEmail: targetEmail ?? undefined,
    });
    return NextResponse.json({ ok: true, state: "warned" });
  }

  if (action === "reinstate") {
    await reinstate(db, uid, admin.email);
    // A reinstated account gets its login back too. Harmless if it was never
    // locked; deliberate if a ban (or a manual disable) put it down.
    if (user.disabled) {
      await getAuth(app).updateUser(uid, { disabled: false });
    }
    await recordAdminAction(db, {
      action: "moderation.reinstate",
      actor: admin.email,
      targetUid: uid,
      targetEmail: targetEmail ?? undefined,
      detail: { reEnabledLogin: user.disabled },
    });
    return NextResponse.json({ ok: true, state: "ok" });
  }

  return NextResponse.json({ error: "Bad action." }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/moderation", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (await limited(getAdminDb(), "admin-moderation", clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const uid = new URL(req.url).searchParams.get("uid") ?? "";
  if (!UID_RE.test(uid)) {
    return NextResponse.json({ error: "Bad uid." }, { status: 400 });
  }

  const status = await getModerationStatus(db, uid);
  // Per-uid event tail. Filter-only query (no orderBy) so no composite index
  // is needed; sorted in memory — moderation histories are short.
  const events = await db
    .collection("moderationEvents")
    .where("uid", "==", uid)
    .limit(50)
    .get();
  const list = events.docs
    .map((d) => {
      const e = d.data();
      return {
        id: d.id,
        kind: typeof e.kind === "string" ? e.kind : "strike",
        severity: typeof e.severity === "number" ? e.severity : null,
        reason: typeof e.reason === "string" ? e.reason : null,
        actor: typeof e.actor === "string" ? e.actor : null,
        strikesAfter: typeof e.strikesAfter === "number" ? e.strikesAfter : null,
        stateAfter: typeof e.stateAfter === "string" ? e.stateAfter : null,
        at: typeof e.at === "number" ? e.at : 0,
      };
    })
    .sort((a, b) => b.at - a.at);

  return NextResponse.json(
    {
      generatedAt: Date.now(),
      status: status ?? { strikes: 0, state: "ok" },
      effectiveState: effectiveState(status),
      events: list,
    },
    { headers: { "cache-control": "private, no-store" } }
  );
}
