import { NextRequest, NextResponse } from "next/server";
import { adminIdentity, clientIp } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { render } from "@/lib/email/render";
import * as messages from "@/lib/email/messages";
import type { AppMessage } from "@/lib/email/send";
import { unsubUrl } from "@/lib/email/prefs";
import { CATEGORY } from "@/lib/email/config";

/**
 * See an email without sending one.
 *
 * Email templates are the one part of a codebase with no feedback loop — the
 * only way to know what a change looks like is to receive it, and receiving it
 * costs a message out of a hundred-a-day allowance and thirty seconds of
 * waiting. So: the same builders the real sends use, rendered into the
 * response.
 *
 * `?type=welcome` for the HTML, `&text=1` for the plain-text half — worth
 * looking at, since it is what a watch shows and what a spam filter reads.
 *
 * ACCESS: an operator (ADMIN_EMAILS) anywhere, or anyone in development.
 * Never both open in production — these carry no real user data, but a public
 * endpoint that renders Elovox-branded pages from a query parameter is a
 * phishing kit somebody else gets to host on our domain.
 */

export const runtime = "nodejs";

/**
 * Rendering a template is cheap, but it is still a serverless invocation, and
 * this was the one route in the tree without a ceiling. In production it is
 * admin-gated so the exposure is small; in development it is wide open, which
 * is exactly where a runaway script points at it.
 */

const SAMPLE = "you@example.com";
const UID = "preview-uid";

/** Every message, with plausible arguments. Adding one here is the whole cost
 *  of making it previewable. */
const GALLERY: Record<string, () => AppMessage> = {
  lockout: () =>
    messages.lockoutNotice(SAMPLE, "https://elovox.app/reset?oob=sample", 15),
  welcome: () => messages.welcome(SAMPLE, UID, "Sam"),
  "tips-welcome": () => messages.tipsWelcome(SAMPLE),
  "subscription-started": () =>
    messages.subscriptionStarted(SAMPLE, UID, "monthly", "September 4, 2026"),
  "payment-failed": () =>
    messages.paymentFailed(SAMPLE, UID, "https://elovox.app/account"),
  "subscription-canceled": () =>
    messages.subscriptionCanceled(SAMPLE, UID, "September 4, 2026"),
  refund: () => messages.refundIssued(SAMPLE, UID, "$8.32"),
  "trial-ending": () =>
    messages.trialEnding(
      SAMPLE,
      UID,
      "August 7, 2026",
      "$79.99",
      "year",
      "https://elovox.app/account"
    ),
  "weekly-progress": () =>
    messages.weeklyProgress(SAMPLE, UID, "2026-07-28", {
      sessions: 5,
      bestScore: 87,
      streak: 12,
      minutes: 14,
    }),
  "streak-at-risk": () => messages.streakAtRisk(SAMPLE, UID, 12, "2026-08-04"),
  "win-back": () => messages.winBack(SAMPLE, UID, 4),
  "operator-test": () => messages.operatorTest(SAMPLE),
  "ops-alert": () =>
    messages.operatorAlert(
      SAMPLE,
      [
        {
          level: "urgent",
          title: "2 unresolved billing alerts",
          detail:
            "1 × unused-portion-refund, 1 × duplicate-subscription. Admin → Billing. These are refunds that didn't complete or duplicate subscriptions.",
        },
        {
          level: "urgent",
          title: "Analysis is paused",
          detail: "Nobody can get feedback on a recording. Admin → Ops to resume.",
        },
        {
          level: "watch",
          title: "Email: 84 of 100 sent today",
          detail: "Close to the daily cap. Optional mail will be trimmed first.",
        },
      ],
      "2026-08-04"
    ),
  "ops-all-clear": () => messages.operatorAlert(SAMPLE, [], "2026-08-04"),
};

export async function GET(req: NextRequest) {
  if (await limited(getAdminDb(), "email-preview", clientIp(req))) {
    return new NextResponse("Slow down", { status: 429 });
  }
  const allowed =
    process.env.NODE_ENV !== "production" || (await adminIdentity(req)) !== null;
  if (!allowed) return new NextResponse("Not found", { status: 404 });

  const type = req.nextUrl.searchParams.get("type");
  if (!type || !GALLERY[type]) {
    // The index. Plain, deliberately — this is a tool, not a page.
    const links = Object.keys(GALLERY)
      .map(
        (t) =>
          `<li><a href="?type=${t}">${t}</a> &middot; <a href="?type=${t}&text=1">text</a></li>`
      )
      .join("");
    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><title>Email previews</title>
<body style="font:15px/1.7 system-ui;padding:32px;max-width:40rem">
<h1 style="font-size:20px">Email previews</h1><ul>${links}</ul></body>`,
      { headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } }
    );
  }

  const message = GALLERY[type]();
  const policy = CATEGORY[message.category];
  const { html, text } = render({
    ...message.doc,
    // Rendered exactly as the real send would: optional categories get the
    // footer link, non-optional ones must not — a security notice with an
    // unsubscribe line is a lie about what the message is.
    unsubscribeUrl: policy.optional
      ? unsubUrl(SAMPLE, message.prefKey ?? policy.prefKey ?? undefined)
      : null,
    unsubscribeLabel: message.prefLabel,
  });

  if (req.nextUrl.searchParams.get("text")) {
    return new NextResponse(`Subject: ${message.subject}\n\n${text}`, {
      headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
    });
  }
  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" },
  });
}
