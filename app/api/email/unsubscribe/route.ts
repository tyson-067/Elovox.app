import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clientIp, logRejectedInput } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";
import { applyUnsubscribe, verifyUnsubToken, PREF_LABELS } from "@/lib/email/prefs";
import { markUnsubscribed } from "@/lib/email/audience";
import { esc } from "@/lib/email/render";
import { siteUrl } from "@/lib/email/config";
import { LEGAL } from "@/lib/legal";

/**
 * Unsubscribe. Works with no account, no session, no login.
 *
 * That is the whole requirement. A link that opens a sign-in page is not an
 * unsubscribe link — the reliable next step is the spam button, and a spam
 * complaint costs the sending domain far more than one lost subscriber. The
 * signed token in the URL is what makes that safe: it proves Elovox minted
 * this link for this address, so nobody can unsubscribe a stranger by
 * guessing.
 *
 * WHY GET DOESN'T UNSUBSCRIBE. Corporate mail scanners and link-preview
 * fetchers follow every URL in every email, with GET, before a human sees it.
 * If GET acted, those scanners would unsubscribe users who never clicked
 * anything — silently, and unfixably from the user's side. So GET renders a
 * one-button page and POST does the work. RFC 8058's one-click flow, which
 * Gmail and Outlook drive from their own Unsubscribe button, is a POST and
 * therefore lands in the right place with no extra click for the user.
 */

export const runtime = "nodejs";

/* --- The page -------------------------------------------------------------- */

function page(body: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email settings · ${esc(LEGAL.serviceName)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    background:#f4f1ea; color:#0b0829; padding:24px;
    font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  .card { background:#fff; border:1px solid #e6e1d8; border-radius:20px;
    padding:32px 30px; max-width:460px; width:100%; }
  h1 { margin:0 0 12px; font-size:22px; line-height:1.3; }
  p { margin:0 0 16px; color:#4a5068; }
  button { appearance:none; border:0; border-radius:999px; background:#c2410c;
    color:#fff; font:700 15px/1 inherit; padding:14px 26px; cursor:pointer; }
  a { color:#004e89; }
  @media (prefers-color-scheme: dark) {
    body { background:#0b0829; color:#fff; }
    .card { background:#14112f; border-color:#2a2550; }
    p { color:#c8cadb; }
    a { color:#8fa0d8; }
  }
</style></head><body><div class="card">${body}
<p style="margin-top:22px;font-size:13px;"><a href="${esc(siteUrl())}">Back to ${esc(LEGAL.serviceName)}</a></p>
</div></body></html>`;
  return new NextResponse(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Never cached, never indexed: the URL carries a token.
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
    },
  });
}

const BAD_LINK = page(
  `<h1>That link didn't work</h1>
   <p>It may have been copied incompletely. You can change your email settings from your account, or reply to any Elovox email and we'll take you off by hand.</p>`,
  400
);

/* --- GET: confirm ---------------------------------------------------------- */

export async function GET(req: NextRequest) {
  if (await limited(getAdminDb(), "email-unsubscribe", clientIp(req))) {
    return page("<h1>One moment</h1><p>Try that again shortly.</p>", 429);
  }

  const token = req.nextUrl.searchParams.get("t") ?? "";
  const claim = token ? verifyUnsubToken(token) : null;
  if (!claim) {
    logRejectedInput("email/unsubscribe", token ? "bad-token" : "no-token");
    return BAD_LINK;
  }

  const what = claim.key
    ? PREF_LABELS[claim.key].title.toLowerCase()
    : "all optional Elovox email";

  return page(`<h1>Unsubscribe?</h1>
<p>We'll stop sending <strong>${esc(what)}</strong> to ${esc(claim.email)}.</p>
<p>Account and billing emails still come through. Those aren't marketing, and you'd want the one about a failed sign-in.</p>
<form method="post">
  <input type="hidden" name="t" value="${esc(token)}">
  <button type="submit">Unsubscribe</button>
</form>`);
}

/* --- POST: act ------------------------------------------------------------- */

export async function POST(req: NextRequest) {
  if (await limited(getAdminDb(), "email-unsubscribe", clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  // Two shapes arrive here, and they are told apart by the BODY, not the
  // content type — RFC 8058 specifies form-encoding for the one-click POST,
  // which is exactly what our own button sends too. What only the provider
  // sends is the literal `List-Unsubscribe=One-Click` field.
  let token = req.nextUrl.searchParams.get("t") ?? "";
  let oneClick = false;
  try {
    const form = await req.formData();
    if (form.get("List-Unsubscribe") === "One-Click") oneClick = true;
    const field = form.get("t");
    if (!token && typeof field === "string") token = field;
  } catch {
    // No parseable body. The token can still be in the query string, which is
    // where the List-Unsubscribe header puts it, so this is not fatal.
    oneClick = true;
  }

  const claim = token ? verifyUnsubToken(token) : null;
  if (!claim) {
    logRejectedInput("email/unsubscribe", token ? "bad-token" : "no-token");
    // A mail client's one-click POST wants a status, not a page.
    return oneClick ? new NextResponse(null, { status: 400 }) : BAD_LINK;
  }

  const db = getAdminDb();
  await applyUnsubscribe(db, claim);
  // Keep Resend's own contact record in step, so a Broadcast — which this app
  // doesn't filter itself — respects the opt-out too. Best-effort.
  await markUnsubscribed(claim.email).catch(() => {});

  console.info(`[mail] unsubscribe applied (${claim.key ?? "all"})`);

  // A provider's automated one-click wants a bare status code; there is no
  // human on the other end to render a page for.
  if (oneClick) return new NextResponse(null, { status: 200 });

  const what = claim.key ? PREF_LABELS[claim.key].title.toLowerCase() : "optional email";
  return page(`<h1>Done</h1>
<p>We've stopped sending ${esc(what)} to ${esc(claim.email)}.</p>
<p>Changed your mind? The switches are in your account, under Email.</p>`);
}
