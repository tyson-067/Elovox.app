import type { Firestore } from "firebase-admin/firestore";
import { LEGAL } from "./legal";

// What each account agreed to, and when.
//
// WHY THIS EXISTS. The sign-up screen names the Terms version at the moment of
// consent (components/AuthForm.tsx), which is what makes the agreement
// sign-up-wrap rather than browsewrap. But naming it on screen and being able
// to PROVE it later are different things: the Terms now carry an arbitration
// agreement, a class-action waiver and an indemnity, and those are precisely
// the clauses a person disputes by saying they never agreed to them. "The
// Terms" is not an answer to that. "Version 2026-09-02, accepted at this
// timestamp" is.
//
// It is also the clock the arbitration opt-out runs from: the window is 30
// days from first accepting, so without a stored date there is no way to say
// whether an opt-out arrived in time — which cuts both ways, and is worse for
// us than for the user.
//
// WHERE IT IS WRITTEN, AND WHY NOT users/{uid}. This is a record ABOUT the
// user, not FOR them, and a consent record the user can rewrite is worth
// nothing as evidence. `users/{uid}` and its subcollections are client-
// writable by design (firestore.rules). This collection is not named in the
// rules at all, so the catch-all at the bottom denies every client both ways —
// the same posture as adminAudit and the login ledgers.
//
// FIRST ACCEPTANCE WINS. Written with create(), never set() or update(), so a
// second call cannot move the timestamp. The legally interesting fact is when
// someone FIRST agreed, and a record that quietly re-stamps itself on every
// sign-in is a record that says nothing. A later version being accepted is a
// separate event and would need its own row; today the app has one version in
// flight, so the existing row is the answer.
//
// Best-effort BY DESIGN, like lib/adminAudit.ts: nobody's sign-in may fail
// because a consent write hiccuped. A lost row is logged so it is not silent.

export interface TermsConsentRecord {
  /** LEGAL.termsVersion as published when the acceptance was recorded. */
  version: string;
  /** Epoch ms. */
  at: number;
}

/**
 * Record that `uid` accepted the currently published Terms.
 *
 * The version comes from LEGAL, never from the request: a client that could
 * name the version it accepted could name an older one, and under-record
 * exactly the clause it later wants to dispute.
 */
export async function recordTermsAcceptance(
  db: Firestore | null,
  uid: string
): Promise<void> {
  if (!db || !uid) return;
  try {
    await db.doc(`termsAcceptances/${uid}`).create({
      version: LEGAL.termsVersion,
      at: Date.now(),
    });
  } catch (err) {
    // ALREADY_EXISTS is the expected path, not a failure: this runs on every
    // "I'm here" ping, and the second one onwards is meant to do nothing.
    const code = (err as { code?: number | string })?.code;
    if (code === 6 || code === "already-exists") return;
    console.error(`[terms] could not record acceptance for ${uid}`, err);
  }
}

/** The stored record, for the account export. Null when nothing was written. */
export async function readTermsAcceptance(
  db: Firestore | null,
  uid: string
): Promise<TermsConsentRecord | null> {
  if (!db || !uid) return null;
  try {
    const snap = await db.doc(`termsAcceptances/${uid}`).get();
    const data = snap.data();
    if (!data) return null;
    return {
      version: typeof data.version === "string" ? data.version : "",
      at: typeof data.at === "number" ? data.at : 0,
    };
  } catch {
    return null;
  }
}
