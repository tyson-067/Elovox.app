import type { Firestore } from "firebase-admin/firestore";

// The operator action log. Every MUTATING /api/admin route writes one entry
// here after the action lands: who (the admin's email, from adminIdentity),
// what (a machine slug), to whom, and the handful of values needed to answer
// "why does this account have Premium?" six months from now.
//
// Append-only by convention — nothing in the codebase updates or deletes an
// entry, and firestore.rules' catch-all denies every client. This mirrors the
// audit-log posture in docs/strike-system-design.md: enforcement/ops state
// you might have to explain later gets a durable, ordered record.
//
// Best-effort BY DESIGN, like lib/refunds.ts: the action the admin asked for
// must never fail because the log write hiccuped. A lost entry is logged to
// the console so it isn't silent, but it never blocks or throws.

export interface AdminAuditEntry {
  /** Machine slug, dot-namespaced: "comp.grant", "account.disable", … */
  action: string;
  /** Admin's email, from adminIdentity — never a client-supplied value. */
  actor: string;
  targetUid?: string;
  targetEmail?: string;
  /** Small scalars only (amounts, dates, ids). Never practice content. */
  detail?: Record<string, string | number | boolean | null>;
  /** Whether the action succeeded. Defaults to true; deletion/disable record
   *  failures too, so a half-done dangerous action is visible. */
  ok?: boolean;
}

export async function recordAdminAction(
  db: Firestore | null,
  entry: AdminAuditEntry
): Promise<void> {
  if (!db) return;
  try {
    await db.collection("adminAudit").add({
      ...entry,
      ok: entry.ok ?? true,
      at: Date.now(),
    });
  } catch (err) {
    console.error(`[admin-audit] couldn't record ${entry.action}`, err);
  }
}
