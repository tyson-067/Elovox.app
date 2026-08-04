/**
 * Kept as the front door for callers that already import from here.
 *
 * The real implementation moved to lib/email/ when this app grew past its one
 * message. That directory is where the interesting decisions now live —
 * lib/email/send.ts is the door every message goes through, lib/email/budget.ts
 * is why a digest run can't starve a security notice, lib/email/config.ts is
 * what the Resend free plan actually allows.
 *
 * `sendMail` below is the old plain-text one-shot, re-expressed on top of the
 * new pipeline so that anything still calling it gets the suppression check,
 * the budget, tagging and the delivery log for free. Prefer building a message
 * in lib/email/messages.ts and calling `send` — that gets you the branded HTML
 * half and a stable idempotency key, neither of which this shim can invent.
 */

import { getAdminDb } from "./firebaseAdmin";
import { send } from "./email/send";
import type { Block } from "./email/render";

export { isMailConfigured } from "./email/config";

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text. Rendered into the standard shell so it still arrives with an
   *  HTML half — a text-only message is a measurable spam signal. */
  text: string;
}

export interface MailResult {
  sent: boolean;
  /** Machine reason when `sent` is false. Never contains the address. */
  reason?: "not-configured" | "rejected" | "error" | "suppressed" | "budget";
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const blocks: Block[] = message.text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((text) =>
      // A bare URL on its own line was the old format's way of saying "this
      // is a link the user must be able to copy". Keep that meaning.
      /^https?:\/\/\S+$/.test(text)
        ? { kind: "link", href: text }
        : { kind: "p", text }
    );

  const result = await send(getAdminDb(), {
    to: message.to,
    subject: message.subject,
    // Non-optional by default. A caller reaching this shim believes the user
    // needs the message; anything opt-in should go through
    // lib/email/messages.ts, where its category is declared explicitly.
    category: "transactional",
    type: "legacy",
    doc: {
      preheader: message.subject,
      heading: message.subject,
      blocks,
    },
  });

  if (result.sent) return { sent: true };
  return {
    sent: false,
    reason: result.outcome === "failed" ? "error" : (result.outcome as MailResult["reason"]),
  };
}
