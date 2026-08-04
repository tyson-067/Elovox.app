/**
 * The one place this app sends an email itself.
 *
 * Everything transactional — verification, password reset when the user asks
 * for it — is sent by Firebase Auth from its own templates. This exists for
 * the one message Firebase has no concept of: telling an account's owner that
 * someone has been trying to get in.
 *
 * Provider-agnostic on purpose, and dependency-free: it POSTs to Resend's REST
 * API with `fetch`. Set RESEND_API_KEY and MAIL_FROM and mail goes out; leave
 * them unset and `sendMail` returns `{ sent: false }` — it never throws, and
 * it never pretends. A caller that reports "we emailed you" on the strength of
 * this function without checking `sent` is lying to a user about a security
 * notice, which is worse than not sending it.
 */

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text. There is no HTML half — a security notice does not need one. */
  text: string;
}

export interface MailResult {
  sent: boolean;
  /** Machine reason when `sent` is false. Never contains the address. */
  reason?: "not-configured" | "rejected" | "error";
}

export function isMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return { sent: false, reason: "not-configured" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
      // A mail send must never hold a request open. The caller is always doing
      // something more important than this.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      // Status only. The body can echo the recipient address, and this line
      // goes to a shared log.
      console.warn(`[mail] send rejected: ${res.status}`);
      return { sent: false, reason: "rejected" };
    }
    return { sent: true };
  } catch (err) {
    console.warn(
      `[mail] send failed: ${err instanceof Error ? err.name : "unknown"}`
    );
    return { sent: false, reason: "error" };
  }
}
