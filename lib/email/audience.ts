/**
 * Resend Audiences and Broadcasts — the one-to-many half of the free plan.
 *
 * Everything else in lib/email is one message to one person. This is the other
 * shape: a contact list Resend holds, and a broadcast composed once and fanned
 * out by them. It matters for two reasons beyond convenience.
 *
 *   1. Resend's own unsubscribe handling. A broadcast to an Audience gets a
 *      managed unsubscribe link and the contact is marked `unsubscribed` at
 *      their end, permanently, whether or not our webhook is up.
 *   2. It is one API request regardless of list size, so it doesn't touch the
 *      2-requests-per-second ceiling at all.
 *
 * THE THING TO WATCH: a broadcast still spends the monthly quota, one message
 * per contact, and Resend does that counting on their side where this app
 * cannot see it. So `estimateAndReserve` claims the budget up front from the
 * contact count. Skip it and a 400-person broadcast quietly takes an eighth of
 * the month while our own counters still read zero.
 *
 * CONSENT NOTE, specific to Elovox: /privacy tells the tips list their address
 * is used "only to send those tips". The audience mirrored here IS the tips
 * list, so a broadcast to it may contain tips and nothing else. It is not a
 * general-purpose announcement channel, and pointing product marketing at it
 * would break a promise made in writing.
 */

import type { Firestore } from "firebase-admin/firestore";
import { audienceId, mailFrom, mailReplyTo } from "./config";
import { resendCall } from "./client";
import { reserve } from "./budget";

/* --- Contacts -------------------------------------------------------------- */

export interface ContactInput {
  email: string;
  firstName?: string;
  unsubscribed?: boolean;
}

/**
 * Add or update a contact. Idempotent by address: Resend treats a repeat
 * create as an update, so a resubmitted signup is one contact.
 *
 * Best-effort by design. The address is already durably in Firestore before
 * this is called; the Audience is a mirror, and a mirror that lags is a
 * far smaller problem than a signup form that 500s because a third-party
 * list API was slow.
 */
export async function upsertContact(contact: ContactInput): Promise<boolean> {
  const id = audienceId();
  if (!id) return false;
  const res = await resendCall(`/audiences/${encodeURIComponent(id)}/contacts`, {
    method: "POST",
    body: {
      email: contact.email.trim().toLowerCase(),
      first_name: contact.firstName,
      unsubscribed: contact.unsubscribed ?? false,
    },
  });
  return res.ok;
}

/**
 * Mark a contact unsubscribed on Resend's side.
 *
 * Called alongside the local suppression write, never instead of it. The
 * local list is what this app checks before every send and it is the one that
 * must be right; this keeps Resend's copy honest so a Broadcast — which we do
 * not filter ourselves — also respects the opt-out.
 */
export async function markUnsubscribed(email: string): Promise<boolean> {
  const id = audienceId();
  if (!id) return false;
  const path = `/audiences/${encodeURIComponent(id)}/contacts/${encodeURIComponent(
    email.trim().toLowerCase()
  )}`;
  const res = await resendCall(path, {
    method: "PATCH",
    body: { unsubscribed: true },
  });
  return res.ok;
}

/** Remove a contact outright. Used by account deletion — an unsubscribed
 *  contact is still a stored address, and a deletion request means gone. */
export async function deleteContact(email: string): Promise<boolean> {
  const id = audienceId();
  if (!id) return false;
  const res = await resendCall(
    `/audiences/${encodeURIComponent(id)}/contacts/${encodeURIComponent(
      email.trim().toLowerCase()
    )}`,
    { method: "DELETE" }
  );
  return res.ok;
}

export interface AudienceContact {
  id: string;
  email: string;
  unsubscribed: boolean;
  createdAt: string | null;
}

/** The list, for the admin console and for sizing a broadcast. */
export async function listContacts(): Promise<AudienceContact[] | null> {
  const id = audienceId();
  if (!id) return null;
  const res = await resendCall(`/audiences/${encodeURIComponent(id)}/contacts`, {
    method: "GET",
  });
  if (!res.ok) return null;
  const rows = (res.data as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: typeof row.id === "string" ? row.id : "",
      email: typeof row.email === "string" ? row.email : "",
      unsubscribed: row.unsubscribed === true,
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
    };
  });
}

/* --- Broadcasts ------------------------------------------------------------ */

export interface BroadcastInput {
  /** Internal name, shown in the Resend dashboard. Not seen by recipients. */
  name: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Compose a broadcast against the audience. Creates it as a DRAFT — sending is
 * a separate, deliberate call, because "create" and "mail several hundred
 * people" should never be the same button.
 */
export async function createBroadcast(
  input: BroadcastInput
): Promise<{ id: string } | null> {
  const id = audienceId();
  const from = mailFrom();
  if (!id || !from) return null;

  const res = await resendCall("/broadcasts", {
    method: "POST",
    body: {
      audience_id: id,
      from,
      reply_to: mailReplyTo(),
      name: input.name,
      subject: input.subject,
      html: input.html,
      text: input.text,
    },
  });
  if (!res.ok) return null;
  const created = (res.data as { id?: unknown })?.id;
  return typeof created === "string" ? { id: created } : null;
}

/**
 * Claim budget for a broadcast before it goes out.
 *
 * Counts only subscribed contacts, because those are the ones Resend will
 * actually bill. Returns false when the day's `marketing` allowance can't
 * cover the whole list — a broadcast is all-or-nothing at the provider, so a
 * partial reservation is no use, and the reservation is handed straight back.
 */
export async function estimateAndReserve(
  db: Firestore | null
): Promise<{ ok: boolean; recipients: number; granted: number }> {
  const contacts = await listContacts();
  if (!contacts) return { ok: false, recipients: 0, granted: 0 };
  const recipients = contacts.filter((c) => !c.unsubscribed).length;
  if (recipients === 0) return { ok: false, recipients: 0, granted: 0 };

  // See the note in send.ts: release() must credit the day the reservation was
  // made, not the day the failure happened to land on.
  const reservedAt = Date.now();
  const budget = await reserve(db, "marketing", recipients, reservedAt);
  if (budget.granted < recipients) {
    const { release } = await import("./budget");
    await release(db, "marketing", budget.granted, reservedAt);
    return { ok: false, recipients, granted: budget.granted };
  }
  return { ok: true, recipients, granted: budget.granted };
}

/** Send (or schedule) a created broadcast. `scheduledAt` accepts ISO 8601 or
 *  natural language, e.g. "tomorrow at 9am". */
export async function sendBroadcast(
  broadcastId: string,
  scheduledAt?: string
): Promise<boolean> {
  const res = await resendCall(
    `/broadcasts/${encodeURIComponent(broadcastId)}/send`,
    { method: "POST", body: scheduledAt ? { scheduled_at: scheduledAt } : {} }
  );
  return res.ok;
}
