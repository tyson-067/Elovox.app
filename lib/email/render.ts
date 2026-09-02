/**
 * The email design system: one shell, a handful of blocks, and a text version
 * generated from the same structure so the two can never drift.
 *
 * WHY THIS IS TABLES AND INLINE STYLES. Email clients are not browsers.
 * Outlook renders with Word's HTML engine, Gmail strips `<style>` blocks in
 * some contexts and rewrites classes, and roughly nobody supports flexbox
 * reliably. Every rule here is either inline or inside a `<style>` block whose
 * loss is survivable — the layout must still be correct with the whole block
 * thrown away, which is why the widths and colours are also inline.
 *
 * WHY EVERY MESSAGE HAS A TEXT PART. A multipart message with only HTML is a
 * strong spam signal, it's unreadable in a screen reader that's given up on
 * the HTML part, and it's what a watch shows. Building both from one `Block[]`
 * means the text version is never the stale one.
 *
 * The voice is the app's voice: short, plain, no exclamation marks, no
 * "we're thrilled". If a sentence would be embarrassing to read aloud it
 * doesn't go in an email either.
 */

import { LEGAL } from "../legal";
import { siteUrl } from "./config";

/* --- Palette (from app/globals.css, inlined because email has no CSS vars) - */

const INK = "#0b0829"; // Bleu Oxford
const SOFT = "#4a5068";
const LAPIS = "#004e89";
const ORANGE = "#c2410c"; // accent-strong: the accessible orange on white
const WARM = "#fdf6ee";
const LINE = "#e6e1d8";
const PAGE = "#f4f1ea";

/* --- Blocks --------------------------------------------------------------- */

export type Block =
  | { kind: "p"; text: string }
  /** Emphasised lead paragraph, one per email at most. */
  | { kind: "lead"; text: string }
  | { kind: "bullets"; items: string[] }
  /** The single call to action. More than one and neither gets pressed. */
  | { kind: "cta"; label: string; href: string }
  /** A row of numbers — reps, scores, streak. Renders as a table, so it
   *  survives Outlook, and as "label: value" lines in the text part. */
  | { kind: "stats"; items: Array<{ label: string; value: string }> }
  /** A bare link on its own line, for things that must be copyable — a
   *  password-reset URL that a mail client mangles is a dead end. */
  | { kind: "link"; href: string }
  | { kind: "rule" }
  /** Small print under the body, above the footer. */
  | { kind: "note"; text: string };

export interface EmailDoc {
  /** The line shown after the subject in an inbox list. Unset, clients show
   *  the first words of the body, which is usually "View this email in". */
  preheader: string;
  heading: string;
  blocks: Block[];
  /** Rendered as the unsubscribe line. Omitted for non-optional mail. */
  unsubscribeUrl?: string | null;
  /** Names the stream, so the footer can say what they'd be leaving. */
  unsubscribeLabel?: string;
}

/* --- Escaping ------------------------------------------------------------- */

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A URL safe to put in `href`.
 *
 * Every link in every email comes from this codebase, not from users — but
 * "comes from this codebase" has included interpolated display names before,
 * in every app that ever shipped a `javascript:` href. Anything that isn't
 * plainly http(s) becomes the site root rather than a live payload.
 */
function safeHref(href: string): string {
  const trimmed = href.trim();
  return /^https?:\/\//i.test(trimmed) ? esc(trimmed) : esc(siteUrl());
}

/**
 * The postal address CAN-SPAM wants in every commercial message, or "" when
 * the operator has not supplied one yet.
 *
 * Both footers go through this so the two halves cannot disagree, and both
 * drop the line entirely when it is empty: a footer reading "Elovox &middot;
 * undefined" or ending in a bare separator is worse than one that is merely
 * missing a line, and it is the failure mode a template string invites.
 * lib/legal.ts carries the full note on why the value is blank today.
 */
function postalAddress(): string {
  return LEGAL.postalAddress.trim();
}

/* --- HTML ----------------------------------------------------------------- */

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function blockHtml(b: Block): string {
  switch (b.kind) {
    case "lead":
      return `<p style="margin:0 0 18px;font-size:17px;line-height:1.55;color:${INK};font-weight:600;">${esc(b.text)}</p>`;
    case "p":
      return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${SOFT};">${esc(b.text)}</p>`;
    case "bullets":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tbody>${b.items
        .map(
          (i) =>
            `<tr><td style="padding:0 10px 8px 0;font-size:15px;line-height:1.6;color:${ORANGE};vertical-align:top;">&bull;</td><td style="padding:0 0 8px;font-size:15px;line-height:1.6;color:${SOFT};">${esc(i)}</td></tr>`
        )
        .join("")}</tbody></table>`;
    case "cta":
      // Padding on the anchor, not the cell: Outlook drops cell padding around
      // a link and leaves an unclickable coloured box.
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;"><tbody><tr><td style="border-radius:999px;background:${ORANGE};"><a href="${safeHref(
        b.href
      )}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;font-family:${FONT};">${esc(
        b.label
      )}</a></td></tr></tbody></table>`;
    case "stats":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;background:${WARM};border:1px solid ${LINE};border-radius:14px;"><tbody><tr>${b.items
        .map(
          (s) =>
            `<td align="center" style="padding:16px 10px;"><div style="font-size:24px;line-height:1.1;font-weight:700;color:${INK};">${esc(
              s.value
            )}</div><div style="margin-top:4px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:${SOFT};">${esc(
              s.label
            )}</div></td>`
        )
        .join("")}</tr></tbody></table>`;
    case "link":
      // `word-break` matters: a long signed URL otherwise stretches the table
      // and horizontally scrolls the whole email on a phone.
      return `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${safeHref(
        b.href
      )}" style="color:${LAPIS};">${esc(b.href)}</a></p>`;
    case "rule":
      return `<div style="height:1px;background:${LINE};margin:24px 0;"></div>`;
    case "note":
      return `<p style="margin:0 0 12px;font-size:13px;line-height:1.55;color:${SOFT};">${esc(b.text)}</p>`;
  }
}

export function renderHtml(doc: EmailDoc): string {
  const site = siteUrl();
  // Its own paragraph rather than a fourth item on the brand line: the statute
  // asks for the address to be there, and a phone-width footer that wraps a
  // street address mid-town around three middots is how it stops being read.
  const postal = postalAddress();
  const footerPostal = postal
    ? `<p style="margin:6px 0 0;font-size:12px;line-height:1.5;color:${SOFT};">${esc(postal)}</p>`
    : "";
  const footerUnsub = doc.unsubscribeUrl
    ? `<p style="margin:10px 0 0;font-size:12px;line-height:1.5;color:${SOFT};">You're getting this because of your ${esc(
        doc.unsubscribeLabel ?? "email settings"
      )}. <a href="${safeHref(doc.unsubscribeUrl)}" style="color:${LAPIS};">Unsubscribe</a>.</p>`
    : "";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(doc.heading)}</title>
<style>
  /* LIGHT ONLY, on purpose, and the two meta tags above are the load-bearing
     part — they ask Apple Mail and Outlook not to auto-invert.

     The tempting thing is a prefers-color-scheme block. Don't. Every colour in
     this document is INLINE (it has to be; Gmail strips and rewrites CSS), and
     a media query can only override the handful of elements you remember to
     give a class to. The half that gets overridden goes dark, the half that
     doesn't stays light, and body text ends up dark-on-dark — which is exactly
     what happened here the first time. A light design that a client inverts
     wholesale is legible; a half-inverted one is not.

     What's left is genuinely optional: a client that drops this block gets the
     same layout with slightly roomier padding on a phone. */
  @media (max-width: 600px) {
    .card { padding: 24px 20px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${PAGE};font-family:${FONT};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(doc.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAGE};padding:28px 12px;"><tbody><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">
<tbody>
  <tr><td style="padding:0 4px 14px;">
    <a href="${safeHref(site)}" style="font-size:17px;font-weight:800;letter-spacing:-.01em;color:${INK};text-decoration:none;">${esc(
      LEGAL.serviceName
    )}</a>
  </td></tr>
  <tr><td class="card" style="background:#ffffff;border:1px solid ${LINE};border-radius:20px;padding:32px 30px;">
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:800;color:${INK};">${esc(
      doc.heading
    )}</h1>
    ${doc.blocks.map(blockHtml).join("\n    ")}
  </td></tr>
  <tr><td style="padding:18px 6px 0;">
    <p style="margin:0;font-size:12px;line-height:1.5;color:${SOFT};">
      ${esc(LEGAL.serviceName)} &middot; <a href="${safeHref(site)}" style="color:${LAPIS};">${esc(
        site.replace(/^https?:\/\//, "")
      )}</a> &middot; <a href="mailto:${esc(LEGAL.emails.support)}" style="color:${LAPIS};">${esc(
        LEGAL.emails.support
      )}</a>
    </p>
    ${footerPostal}
    ${footerUnsub}
  </td></tr>
</tbody>
</table>
</td></tr></tbody></table>
</body></html>`;
}

/* --- Text ----------------------------------------------------------------- */

function blockText(b: Block): string | null {
  switch (b.kind) {
    case "lead":
    case "p":
    case "note":
      return b.text;
    case "bullets":
      return b.items.map((i) => `- ${i}`).join("\n");
    case "cta":
      return `${b.label}: ${b.href}`;
    case "stats":
      return b.items.map((s) => `${s.label}: ${s.value}`).join("\n");
    case "link":
      return b.href;
    case "rule":
      return "---";
  }
}

export function renderText(doc: EmailDoc): string {
  const site = siteUrl();
  const body = doc.blocks
    .map(blockText)
    .filter((l): l is string => Boolean(l))
    .join("\n\n");

  // `filter(Boolean)` is what keeps an empty postal address from leaving a
  // blank line in the middle of the footer, the same way it already handles
  // mail that carries no unsubscribe link.
  const footer = [
    `— ${LEGAL.serviceName}`,
    site,
    postalAddress() || null,
    doc.unsubscribeUrl ? `Unsubscribe: ${doc.unsubscribeUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `${doc.heading}\n\n${body}\n\n---\n${footer}\n`;
}

/** Both halves at once. Every message builder returns this. */
export function render(doc: EmailDoc): { html: string; text: string } {
  return { html: renderHtml(doc), text: renderText(doc) };
}
