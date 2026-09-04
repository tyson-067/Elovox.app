import type { App } from "firebase-admin/app";
import { readTermsAcceptance } from "./termsConsent";
import type { DocumentReference, Firestore, Query } from "firebase-admin/firestore";

// The data-portability payload, shared by the self-serve route
// (/api/account/export — GDPR Art. 20 / CCPA "right to know") and the
// operator route (/api/admin/export — servicing the same right when it
// arrives by email instead of by button, inside the 30-day window /privacy
// promises). One builder so the two exports can never diverge on what
// "everything" means — the failure mode of two lists is a silently
// incomplete export, which is exactly what the right is meant to prevent.
//
// AUTH IS THE CALLER'S JOB: the self route only ever exports the verified
// token's own uid; the admin route requires adminIdentity and audit-logs
// every export it generates.
//
// THE OTHER FAILURE MODE, and the reason `related` exists: the walk below
// covers users/{uid} and the Auth record, which is not the same thing as the
// account. lib/accountDeletion.ts is the list of everywhere else a uid or an
// address actually lives — the public leaderboard row and its handle
// reservation, the invite codes, the tips-list lead, the deletion-reason log
// — and moderationEvents holds the strike record on top of that. An export
// that omitted them still said "every record we hold", which is worst for the
// person it matters most to: someone struck by the automated language scan
// received a file that positively denied the existence of the one record they
// would need to contest it.
//
// accountDeletion is NOT the whole list, though, and treating it as one was the
// second version of the same bug. Three more stores are keyed to a user and
// live outside users/{uid}: `emailLog` (every message we sent to the address,
// for 30 days), `emailSuppression` (the standing "do not mail this address"
// note) and `billingAlerts` (a payment that needed a human). None are touched
// by the erasure — two of them deliberately — so mirroring accountDeletion
// step by step left all three out of a file that claimed to cover everything
// keyed to the user. They are here now, and `emailSuppression`, which outlives
// the account on purpose, is named in `related.retained` as well.
//
// The rule the file keeps: everything keyed to this user is either IN the
// payload, or NAMED in `related.withheld` with the reason — never silently
// dropped.

/** Firestore Timestamps don't survive JSON.stringify; render them readably. */
function serialize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(serialize);
  // Timestamp instances expose toDate(); anything else falls through.
  const maybeTs = value as { toDate?: () => Date };
  if (typeof maybeTs.toDate === "function") {
    return maybeTs.toDate().toISOString();
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = serialize(v);
  }
  return out;
}

// Bounded per collection. Each session carries a full transcript plus its
// analysis, so an unbounded read of a heavy account both blew the function's
// memory and produced a body past the platform's response cap — turning a
// data-portability request into a 500 the user has no way around, which is
// worse than a large-but-complete file. The cap is far above any real
// account, and when it does bite the export says so in the payload instead
// of silently truncating.
const MAX_DOCS_PER_COLLECTION = 5000;

/**
 * How many levels of subcollection the walk follows below users/{uid}.
 *
 * listCollections() on the root doc only names the collections directly under
 * it, so a flat walk missed everything nested one level further down —
 * concretely users/{uid}/sessions/{id}/felix/voice, the cached Felix take,
 * which is depth 2 and was in nobody's export. Bounded rather than open-ended
 * because the recursion is driven by data the user can create.
 */
const MAX_DEPTH = 3;

/**
 * How many nested listCollections() probes the whole walk may spend.
 *
 * This is the real cost, not the depth: finding out whether a document has
 * subcollections is one round trip PER DOCUMENT, so probing every doc of a
 * 5000-session account is 5000 sequential calls and a timed-out export. The
 * budget keeps the walk proportional to a normal account, and when it runs
 * out the payload says so rather than quietly returning a shallow file.
 */
const MAX_NESTED_PROBES = 750;

interface WalkState {
  /** Collection paths that hit MAX_DOCS_PER_COLLECTION. */
  truncated: string[];
  /** Remaining nested probes; see MAX_NESTED_PROBES. */
  probes: number;
  /** Set once the budget above is exhausted, so the payload can admit it. */
  probesExhausted: boolean;
}

/** Read a collection or query under the shared cap, recording truncation. */
async function readCapped(
  query: Query,
  label: string,
  state: WalkState
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const snap = await query.limit(MAX_DOCS_PER_COLLECTION + 1).get();
  if (snap.docs.length > MAX_DOCS_PER_COLLECTION) state.truncated.push(label);
  return snap.docs
    .slice(0, MAX_DOCS_PER_COLLECTION)
    .map((d) => ({ id: d.id, data: serialize(d.data()) as Record<string, unknown> }));
}

/**
 * The document id an address-keyed store uses, or null if it can't have one.
 *
 * Firestore throws synchronously out of `db.doc()` for an id matching `__x__`,
 * and `__a@b.co__` is a valid address — inside the Promise.all below that
 * throw would take down the whole export rather than skip one lookup. Same
 * guard, for the same reason, as lib/email/suppression.ts.
 */
function addressDocId(address: string): string | null {
  const id = encodeURIComponent(address.trim().toLowerCase());
  if (!id || /^__.*__$/.test(id) || id === "." || id === "..") return null;
  return id;
}

/** Merge rows read by two different keys, keeping the first of each id. */
function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

/**
 * Every subcollection under `parent`, and — within the bounds above — the
 * subcollections of those documents in turn, nested under `subcollections` so
 * the shape of the file matches the shape of the database.
 */
async function walkSubcollections(
  parent: DocumentReference,
  depth: number,
  state: WalkState
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  // Walked rather than named, so a collection added later is exported without
  // anyone remembering to edit this code.
  for (const col of await parent.listCollections()) {
    const snap = await col.limit(MAX_DOCS_PER_COLLECTION + 1).get();
    const docs = snap.docs.slice(0, MAX_DOCS_PER_COLLECTION);
    if (snap.docs.length > MAX_DOCS_PER_COLLECTION) state.truncated.push(col.path);

    const rows: Array<Record<string, unknown>> = [];
    for (const d of docs) {
      const row: Record<string, unknown> = {
        id: d.id,
        ...(serialize(d.data()) as object),
      };
      if (depth < MAX_DEPTH) {
        if (state.probes > 0) {
          state.probes -= 1;
          const nested = await walkSubcollections(d.ref, depth + 1, state);
          // Only when there is something there: an empty `subcollections` on
          // every session doc would triple the file for no information.
          if (Object.keys(nested).length > 0) row.subcollections = nested;
        } else {
          state.probesExhausted = true;
        }
      }
      rows.push(row);
    }
    out[col.id] = rows;
  }
  return out;
}

export async function buildAccountExport(
  app: App,
  db: Firestore,
  uid: string
): Promise<Record<string, unknown>> {
  const { getAuth } = await import("firebase-admin/auth");
  const user = await getAuth(app).getUser(uid);

  const state: WalkState = {
    truncated: [],
    probes: MAX_NESTED_PROBES,
    probesExhausted: false,
  };
  const data = await walkSubcollections(db.doc(`users/${uid}`), 1, state);

  // Three of the stores below are keyed by ADDRESS, not by uid, and every
  // writer normalizes it the same way (trim + lowercase, then URI-encode for
  // the doc id). Reading it any other way finds nothing and reports an empty
  // section as if it were an empty store.
  const address = user.email ? user.email.trim().toLowerCase() : null;
  const addressId = address ? addressDocId(address) : null;

  // The stores outside users/{uid}: first the ones lib/accountDeletion.ts
  // touches, in its order, then the three it doesn't. Keep the two files in
  // step — anything erased there is something a user is entitled to see here —
  // but do NOT treat that list as the boundary: `emailSuppression` and
  // `billingAlerts` are keyed to this user and survive the erasure, and
  // following accountDeletion alone is exactly how they went missing.
  const [
    leaderboardSnap,
    invites,
    leadSnap,
    sessionDeletions,
    moderationEvents,
    suppressionSnap,
    logByAddress,
    logByUid,
    billingAlerts,
  ] = await Promise.all([
    db.doc(`leaderboard/${uid}`).get(),
    readCapped(db.collection("invites").where("uid", "==", uid), "invites", state),
    addressId ? db.doc(`leads/${addressId}`).get() : Promise.resolve(null),
    readCapped(
      db.collection("sessionDeletions").where("uid", "==", uid),
      "sessionDeletions",
      state
    ),
    readCapped(
      db.collection("moderationEvents").where("uid", "==", uid),
      "moderationEvents",
      state
    ),
    addressId
      ? db.doc(`emailSuppression/${addressId}`).get()
      : Promise.resolve(null),
    // The delivery log is read twice and merged. `to` is the canonical key,
    // but rows also carry a uid, and an account that has changed its address
    // has rows under the old one — reading either alone silently returns half
    // the history of what we sent them.
    address
      ? readCapped(db.collection("emailLog").where("to", "==", address), "emailLog", state)
      : Promise.resolve([]),
    readCapped(db.collection("emailLog").where("uid", "==", uid), "emailLog", state),
    readCapped(
      db.collection("billingAlerts").where("uid", "==", uid),
      "billingAlerts",
      state
    ),
  ]);

  const emailLog = dedupeById([...logByAddress, ...logByUid]);

  // The handle reservation is keyed by the FOLDED name rather than by uid, so
  // it can only be found through the row that holds the name — the same route
  // eraseAccount takes to release it.
  const handle = leaderboardSnap.data()?.handle;
  let handleReservation: Record<string, unknown> | null = null;
  if (typeof handle === "string") {
    const { foldHandle } = await import("./leaderboardServer");
    const folded = foldHandle(handle);
    if (folded) {
      const claim = await db.doc(`handles/${folded}`).get();
      if (claim.exists) {
        handleReservation = {
          id: folded,
          ...(serialize(claim.data()) as object),
        };
      }
    }
  }

  // Which version of the Terms this account accepted, and when. Kept outside
  // users/{uid} precisely so the person it is evidence about cannot rewrite it
  // — which is also why it has to be surfaced here rather than left invisible.
  const termsAcceptance = await readTermsAcceptance(db, uid);

  const related = {
    termsAcceptance,
    // The public projection: the row strangers see on /leaderboard.
    leaderboard: leaderboardSnap.exists
      ? { id: uid, ...(serialize(leaderboardSnap.data()) as object) }
      : null,
    handleReservation,
    invites: invites.map((r) => ({ id: r.id, ...r.data })),
    // The tips-list signup, keyed by address rather than by uid.
    tipsListSignup:
      leadSnap && leadSnap.exists
        ? { id: leadSnap.id, ...(serialize(leadSnap.data()) as object) }
        : null,
    sessionDeletions: sessionDeletions.map((r) => ({ id: r.id, ...r.data })),
    // The strike record, minus `actor`. Everything that makes a decision
    // contestable — severity, reason, source, the state it produced — is here;
    // the operator who made the call is a third party, and their name is not
    // part of this user's data. An automated strike has no operator anyway,
    // and `source` already says which kind it was.
    moderationEvents: moderationEvents.map((r) => {
      const row = { ...r.data };
      delete row.actor;
      return { id: r.id, ...row };
    }),
    // Every message we sent to this address, for as long as the delivery log
    // keeps it (30 days — see lib/email/retention.ts, and "Server logs: a
    // short operational window" in /privacy). It is what answers "did my
    // receipt actually go out, and did it bounce?", which is unanswerable from
    // anywhere else in this file.
    emailLog: emailLog.map((r) => ({ id: r.id, ...r.data })),
    // The standing "do not mail this address" note, if there is one: what it
    // says, why, and when. Included because being told we have stopped mailing
    // you — and on what grounds — is the whole point of the record, and
    // because it is the only thing here that outlives the account (see
    // `retained` below).
    emailSuppression:
      suppressionSnap && suppressionSnap.exists
        ? { id: suppressionSnap.id, ...(serialize(suppressionSnap.data()) as object) }
        : null,
    // Payments that needed a person: a refund we owed and could not put back
    // on the card, a duplicate subscription we cancelled. Minus `resolvedBy`,
    // for the same reason moderationEvents loses `actor` — the operator who
    // closed it is a third party, and everything that makes the entry mean
    // something to the user (what happened, to which subscription, for how
    // much, and whether it is settled) is still here.
    billingAlerts: billingAlerts.map((r) => {
      const row = { ...r.data };
      delete row.resolvedBy;
      return { id: r.id, ...row };
    }),
    // Kept after the account goes, and said so plainly. This is not the same
    // list as `withheld`: these records ARE in the file, and this says what
    // happens to them next.
    retained: [
      {
        record: "termsAcceptance",
        what: "Which version of the Terms you accepted, and the date. It is included in full above, under related.termsAcceptance.",
        reason:
          "It is the record of an agreement between you and us, so it has to outlast the account: without it neither side can show what was agreed if there is ever a dispute about it, including the 30-day window for opting out of the arbitration section, which runs from this date. It holds a version string, a timestamp and your account id, and nothing else.",
        howToGet:
          "It is above. It is kept after deletion; the account id it is filed under points to nothing once the account is gone.",
      },
      {
        record: "emailSuppression",
        what: "The note that this address must not be emailed, and why: a bounce, a spam complaint, or an unsubscribe. It is included in full above, under related.emailSuppression, whenever there is one.",
        reason:
          "This record is the thing that stops us mailing you. Deleting it along with the account would simply start the mail again the next time the address appeared, which is the opposite of what it records you asking for, so it is kept on the basis of that request and of our legitimate interest in not mailing addresses that bounce or that reported us. It holds the address, the reason and the date, and nothing else.",
        howToGet:
          "It is above. If you want it removed anyway, understanding that it is what suppresses future mail, email us and say so.",
      },
    ],
    // Named, not silently dropped: an export that omits something without
    // saying so is the failure this file exists to prevent.
    withheld: [
      {
        record: "adminAudit",
        what: "Operator actions taken on this account (a plan grant, a reinstate, an account closure serviced by hand).",
        reason:
          "Every entry names the operator who took the action, and some carry internal detail about other accounts. That makes them another person's data as much as yours, so they are reviewed by a human before release rather than exported automatically.",
        howToGet: "Ask us and we will send the entries that concern you, with the operator's identity removed.",
      },
      {
        record: "friend mirrors held by other users",
        what: "The reciprocal copy of a friendship, stored under the other person's account.",
        reason:
          "That row lives in someone else's account and identifies them. Your own side of every friendship is included above, under data.friends.",
      },
    ],
  };

  const incomplete: string[] = [];
  if (state.truncated.length) {
    incomplete.push(
      `These sections hit the ${MAX_DOCS_PER_COLLECTION}-record export limit and are not complete: ${state.truncated.join(", ")}.`
    );
  }
  if (state.probesExhausted) {
    incomplete.push(
      `This account has more documents than the walk checks for nested subcollections (${MAX_NESTED_PROBES}), so a few nested records may be missing.`
    );
  }

  return {
    exportedAt: new Date().toISOString(),
    account: {
      uid,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      emailVerified: user.emailVerified,
      createdAt: user.metadata.creationTime ?? null,
      lastSignInAt: user.metadata.lastSignInTime ?? null,
      // Which sign-in methods are attached (password, google.com, …).
      providers: user.providerData.map((p) => p.providerId),
    },
    data,
    related,
    // Named so the file is self-explanatory to whoever receives it, a
    // regulator, or the user moving to another service. Deliberately not a
    // claim of completeness any more: it says what is here, points at what is
    // not, and the file itself names both.
    note: `Your account data: everything stored under your account (in "data", following subcollections ${MAX_DEPTH} levels deep), plus the records stored outside it that are keyed to you or to your email address (in "related"): the Terms version you accepted, your public leaderboard row and handle, invite codes, tips-list signup, deletion-reason log, any enforcement record, the log of emails we sent you, any suppression note on your address, and any billing alert raised on your account. Anything deliberately left out is listed with its reason in related.withheld; anything we keep after an account is deleted is listed with its reason in related.retained; and any section that hit an export limit is named in "incomplete". Payment records live with Stripe, which retains them for tax and accounting purposes; request those from Stripe or via the billing portal. If you joined the tips list, our email provider Resend also holds a copy of your address until the signup is removed.`,
    ...(incomplete.length ? { incomplete: `${incomplete.join(" ")} Contact us and we'll send the rest.` } : {}),
  };
}
