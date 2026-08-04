import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { adminIdentity, clientIp, makeRateLimiter } from "@/lib/verify";
import { recordAdminDenied } from "@/lib/opsMetrics";
import { recordAdminAction } from "@/lib/adminAudit";
import { validateEmail } from "@/lib/validation";
import { readJsonObject } from "@/lib/requestBody";
import {
  audienceId,
  isMailConfigured,
  mailFrom,
  mailReplyTo,
} from "@/lib/email/config";
import { listDomains } from "@/lib/email/client";
import { recentDays, snapshot } from "@/lib/email/budget";
import { getSuppression, listSuppressed, unsuppress } from "@/lib/email/suppression";
import { listContacts } from "@/lib/email/audience";
import { send } from "@/lib/email/send";
import { operatorTest } from "@/lib/email/messages";
import {
  announcementBlocks,
  announcementId,
  estimate as estimateAnnounce,
  sendAnnouncement,
  type Announcement,
} from "@/lib/email/announce";
import { render } from "@/lib/email/render";
import { TIPS } from "@/lib/email/tips";

/**
 * The Email tab.
 *
 * Answers the four questions an operator actually has about email, none of
 * which the Resend dashboard answers on its own:
 *
 *   How much of the free plan is left today, and this month?
 *   Is the sending domain still verified? (DNS rots silently; nothing errors,
 *     mail simply starts landing in spam.)
 *   Who has been suppressed, and why?
 *   Does sending work RIGHT NOW? — the test send, which goes through the real
 *     path rather than a special one, so a green result means the real thing.
 *
 * Same access story as every other admin route: the ADMIN_EMAILS allow-list, a
 * flat 404 for everyone else so the endpoint's existence isn't advertised, and
 * nothing served at all without the Admin SDK.
 */

export const runtime = "nodejs";

const rateLimited = makeRateLimiter(60);

export async function GET(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/email", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }
  const db = getAdminDb();

  // Provider calls are best-effort and run alongside the Firestore reads. A
  // Resend outage should leave the budget and suppression panes working, not
  // blank the whole tab.
  const [budget, history, suppressed, domains, contacts, recent, announce, tips] =
    await Promise.all([
      snapshot(db),
      recentDays(db, 30),
      listSuppressed(db, 200),
      isMailConfigured() ? listDomains() : Promise.resolve(null),
      audienceId() ? listContacts() : Promise.resolve(null),
      recentLog(db),
      estimateAnnounce(getAdminApp(), db).catch(() => null),
      tipsProgress(db),
    ]);

  return NextResponse.json(
    {
      generatedAt: Date.now(),
      config: {
        configured: isMailConfigured(),
        from: mailFrom(),
        replyTo: mailReplyTo(),
        audienceConfigured: Boolean(audienceId()),
        // Named rather than valued: whether the webhook secret EXISTS is the
        // operationally interesting fact (without it, bounce suppression is
        // off), and the value itself never leaves the server.
        webhookConfigured: Boolean(process.env.RESEND_WEBHOOK_SECRET),
        unsubTokensConfigured: Boolean(
          process.env.EMAIL_TOKEN_SECRET || process.env.FIREBASE_SERVICE_ACCOUNT
        ),
      },
      budget,
      history,
      suppressed,
      domains: domains?.map((d) => ({
        name: typeof d.name === "string" ? d.name : "?",
        status: typeof d.status === "string" ? d.status : "unknown",
        region: typeof d.region === "string" ? d.region : null,
      })),
      audience: contacts
        ? {
            total: contacts.length,
            subscribed: contacts.filter((c) => !c.unsubscribed).length,
          }
        : null,
      recent,
      announce,
      tips,
    },
    { headers: { "cache-control": "private, no-store" } }
  );
}

/**
 * How far through the tips sequence the list has got.
 *
 * The drip runs itself, which is exactly why it needs a readout: a schedule
 * nobody has to touch is also a schedule nobody would notice had stopped.
 * `due` is the number who would be sent to on the next run — a number stuck at
 * zero while subscribers exist is the shape of a broken drip.
 */
async function tipsProgress(db: FirebaseFirestore.Firestore | null) {
  const empty = { subscribers: 0, finished: 0, due: 0, total: TIPS.length };
  if (!db) return empty;
  try {
    const snap = await db.collection("leads").get();
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let finished = 0;
    let due = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      const index = typeof d.tipIndex === "number" ? d.tipIndex : 0;
      if (index >= TIPS.length) {
        finished++;
        continue;
      }
      const raw = d.lastTipAt ?? d.since;
      const last =
        typeof raw === "number"
          ? raw
          : raw && typeof raw.toMillis === "function"
            ? raw.toMillis()
            : null;
      if (last == null || now - last >= WEEK) due++;
    }
    return { subscribers: snap.size, finished, due, total: TIPS.length };
  } catch (err) {
    console.warn("[admin/email] tips progress failed", err);
    return empty;
  }
}

/** The last few messages sent, newest first. Addresses are in here, which is
 *  why this route 404s rather than 403s and is marked no-store. */
async function recentLog(db: FirebaseFirestore.Firestore | null) {
  if (!db) return [];
  try {
    const snap = await db
      .collection("emailLog")
      .orderBy("at", "desc")
      .limit(50)
      .get();
    return snap.docs.map((d) => {
      const row = d.data();
      return {
        to: typeof row.to === "string" ? row.to : "?",
        category: typeof row.category === "string" ? row.category : "?",
        type: typeof row.type === "string" ? row.type : "?",
        status: typeof row.status === "string" ? row.status : "sent",
        at: typeof row.at === "number" ? row.at : null,
      };
    });
  } catch (err) {
    console.warn("[admin/email] recent log read failed", err);
    return [];
  }
}

export async function POST(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/email", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  if (rateLimited(admin.uid)) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const parsed = await readJsonObject(req);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const body = parsed.body as {
    action?: unknown;
    email?: unknown;
    announcement?: unknown;
    confirm?: unknown;
  };
  const db = getAdminDb();

  /* --- Test send --------------------------------------------------------- */
  if (body.action === "test") {
    if (!isMailConfigured()) {
      return NextResponse.json(
        { error: "RESEND_API_KEY / MAIL_FROM aren't set." },
        { status: 400 }
      );
    }
    // ALWAYS to the operator's own verified address, never to one supplied in
    // the body. A test endpoint that mails an arbitrary address is a way to
    // send Elovox-branded mail to anyone, from an account whose only
    // credential is being on a list of emails.
    const result = await send(db, operatorTest(admin.email));
    await recordAdminAction(db, {
      action: "email.test",
      actor: admin.email,
      detail: { outcome: result.outcome },
      ok: result.sent,
    });
    return NextResponse.json({
      ok: result.sent,
      outcome: result.outcome,
      detail: result.detail ?? null,
    });
  }

  /* --- Un-suppress ------------------------------------------------------- */
  if (body.action === "unsuppress") {
    const check = validateEmail(body.email);
    if (!check.ok) {
      return NextResponse.json({ error: "Bad email." }, { status: 400 });
    }
    const email = check.value.toLowerCase();
    const record = await getSuppression(db, email);
    if (!record) {
      return NextResponse.json({ error: "Not on the list." }, { status: 404 });
    }
    // A bounce can be a mailbox that has since been fixed, and a manual entry
    // can be a mistake — both are an operator's to undo. A COMPLAINT is not:
    // somebody pressed the spam button, and an operator deciding to mail them
    // again anyway is precisely how a sending domain gets filtered. Nor is an
    // UNSUBSCRIBE, which is the user's own choice and theirs alone to reverse.
    if (record.reason === "complaint" || record.reason === "unsubscribe") {
      return NextResponse.json(
        {
          error:
            record.reason === "complaint"
              ? "They marked it as spam. That one isn't ours to undo."
              : "They unsubscribed. They can turn it back on from their account.",
        },
        { status: 409 }
      );
    }

    const ok = await unsuppress(db, email);
    await recordAdminAction(db, {
      action: "email.unsuppress",
      actor: admin.email,
      targetEmail: email,
      detail: { reason: record.reason },
      ok,
    });
    return NextResponse.json({ ok });
  }


  /* --- Announcements ----------------------------------------------------- */
  //
  // Three actions on the same content, and the split is the safety design:
  // "announce-preview" renders it, "announce-test" sends it to the operator
  // only, and "announce-send" mails every account holder who hasn't opted out.
  // Nobody should reach the third without having seen the first two, and the
  // console won't let them.
  if (
    body.action === "announce-preview" ||
    body.action === "announce-test" ||
    body.action === "announce-send"
  ) {
    const draft = readAnnouncement(body.announcement);
    if (!draft) {
      return NextResponse.json(
        { error: "Needs a subject, a heading, and something to say." },
        { status: 400 }
      );
    }

    if (body.action === "announce-preview") {
      // Rendered through the real pipeline, unsubscribe line and all, so what
      // the operator approves is what recipients get.
      const { html, text } = render({
        preheader: draft.body.slice(0, 120),
        heading: draft.heading,
        blocks: announcementBlocks(draft),
        unsubscribeUrl: "https://elovox.app/api/email/unsubscribe?t=preview",
        unsubscribeLabel: "occasional product emails",
      });
      // The id goes back with the render: the console echoes it as `confirm` on
      // the real send, so editing the draft after previewing invalidates it and
      // the operator is made to look again.
      return NextResponse.json({
        ok: true,
        html,
        text,
        subject: draft.subject,
        id: announcementId(draft),
      });
    }

    if (!isMailConfigured()) {
      return NextResponse.json(
        { error: "RESEND_API_KEY / MAIL_FROM aren't set." },
        { status: 400 }
      );
    }

    if (body.action === "announce-test") {
      // To the operator's own verified address, never one from the body.
      const result = await send(db, {
        ...announcementMessageForSelf(admin.email, draft),
      });
      return NextResponse.json({
        ok: result.sent,
        outcome: result.outcome,
        detail: result.detail ?? null,
      });
    }

    // The real thing. Requires an explicit `confirm` matching the content's
    // own id — so a stale browser tab, a double-click, or a retried request
    // cannot send an announcement the operator didn't just read.
    const id = announcementId(draft);
    if (body.confirm !== id) {
      return NextResponse.json(
        { error: "Confirmation didn't match the draft. Preview it again." },
        { status: 409 }
      );
    }

    const result = await sendAnnouncement(getAdminApp(), db, draft);
    await recordAdminAction(db, {
      action: "email.announce",
      actor: admin.email,
      detail: {
        announcementId: id,
        subject: draft.subject.slice(0, 80),
        attempted: result.attempted,
        sent: result.sent,
        overBudget: result.overBudget,
      },
      ok: result.failed === 0,
    });
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

/** Validate and clamp an operator-supplied draft. Lengths are capped so a
 *  paste accident can't produce a megabyte email, and the CTA is all-or-
 *  nothing — a button with no link is worse than no button. */
function readAnnouncement(raw: unknown): Announcement | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";

  const subject = str(r.subject, 160);
  const heading = str(r.heading, 160);
  const body = str(r.body, 8000);
  if (!subject || !heading || !body) return null;

  const ctaLabel = str(r.ctaLabel, 60);
  const ctaHref = str(r.ctaHref, 500);
  // Only http(s). lib/email/render.ts would neutralize anything else anyway,
  // but a link silently rewritten to the homepage is a confusing thing to
  // discover after pressing send.
  const linkOk = /^https?:\/\//i.test(ctaHref);
  return {
    subject,
    heading,
    body,
    ...(ctaLabel && linkOk ? { ctaLabel, ctaHref } : {}),
  };
}

/** The operator's own copy of a draft. Same renderer, same category, but keyed
 *  per-send so repeated tests aren't collapsed by Resend's idempotency. */
function announcementMessageForSelf(email: string, a: Announcement) {
  return {
    to: email,
    subject: `[test] ${a.subject}`,
    category: "transactional" as const,
    type: "announcement-test",
    key: `announce-test:${announcementId(a)}:${Date.now()}`,
    doc: {
      preheader: a.body.slice(0, 120),
      heading: a.heading,
      blocks: announcementBlocks(a),
    },
  };
}
