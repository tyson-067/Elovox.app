import { FieldValue, type Firestore } from "firebase-admin/firestore";

// Invite links, and the friendship + bonus they create.
//
// Everything here runs on the server for the same reason the XP does: a
// referral pays out XP, XP ranks people, so the client cannot be allowed
// anywhere near the decision. See the header of lib/leaderboardServer.ts.
//
// Where it lives:
//   invites/{code}                 → { uid }, the code's owner. Deny-all to
//                                    clients (the catch-all rule), so codes
//                                    can't be enumerated to map users.
//   users/{uid}/score/referral     → who invited this account, and whether
//                                    the bonus has been paid.
//   users/{uid}/friends/{friendUid}→ the friendship, written both ways.

export { REFERRAL_BONUS_XP } from "./referralShared";
import { REFERRAL_BONUS_XP, MAX_PAID_REFERRALS } from "./referralShared";

/**
 * Paid on the invitee's first SCORED session, not at signup. An account that
 * exists is worth nothing; an account that recorded a real minute and pushed
 * it through the paid pipeline costs an abuser more than 100 XP is worth,
 * which is the only thing making this farm-resistant.
 */
export const BONUS_TRIGGER = "first scored session";

/**
 * Codes are random, not derived from the uid — a code is handed to strangers
 * and must not be reversible into an account id. No 0/O/1/I/L, because these
 * get read aloud and typed by hand.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Normalizes what someone typed or what came off a URL. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9]{4,16}$/.test(code) ? code : null;
}

/**
 * This user's invite code, generating one the first time. Stable afterwards:
 * a link someone already shared has to keep working.
 */
export async function getOrCreateInviteCode(
  db: Firestore,
  uid: string
): Promise<string> {
  const mineRef = db.doc(`users/${uid}/score/invite`);
  const mine = await mineRef.get();
  const existing = mine.data()?.code;
  if (typeof existing === "string" && existing) return existing;

  // create() fails if the doc is already there, which is the collision check.
  // Three tries is plenty at 31^8 codes; the loop exists so a freak collision
  // is a retry rather than an error handed to the user.
  for (let i = 0; i < 3; i++) {
    const code = randomCode();
    try {
      await db.doc(`invites/${code}`).create({
        uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      await mineRef.set({ code }, { merge: true });
      return code;
    } catch {
      // taken, try another
    }
  }
  throw new Error("could not allocate an invite code");
}

export type RedeemResult =
  | { ok: true; inviterUid: string }
  | { ok: false; reason: string };

/**
 * Redeem a code: records who invited this account and makes the two of them
 * friends. Pays nothing — the bonus lands on the first scored session, via
 * payReferralBonus below.
 *
 * Every guard here exists because the payout is real:
 *   - once per account, ever (the referral doc is created, never updated)
 *   - not your own code
 *   - not an account that has already been practicing, or two established
 *     users could swap codes and mint 200 XP between them
 */
export async function redeemInvite(
  db: Firestore,
  uid: string,
  code: string
): Promise<RedeemResult> {
  const inviteSnap = await db.doc(`invites/${code}`).get();
  const inviterUid = inviteSnap.data()?.uid;
  if (!inviteSnap.exists || typeof inviterUid !== "string") {
    return { ok: false, reason: "That invite link isn't valid." };
  }
  if (inviterUid === uid) {
    return { ok: false, reason: "That's your own invite link." };
  }

  const referralRef = db.doc(`users/${uid}/score/referral`);

  // An account that has already scored a session isn't a new signup, whatever
  // the link says. This is the check that stops existing users pairing up.
  const progress = await db.doc(`users/${uid}/score/progress`).get();
  if (progress.exists) {
    return { ok: false, reason: "Invite links are for new accounts." };
  }

  // Reciprocity: the check above only stops ESTABLISHED users pairing up. Two
  // brand-new accounts could still redeem each other's codes — neither has a
  // progress doc, so both passed — and collect 100 XP as invitee plus 100 as
  // inviter, 400 XP total for two free Daily Minutes. XP is what ranks the
  // public board, so that is the number worth forging.
  const inviterReferral = await db.doc(`users/${inviterUid}/score/referral`).get();
  if (inviterReferral.data()?.inviterUid === uid) {
    return { ok: false, reason: "You two can't invite each other." };
  }

  try {
    await referralRef.create({
      inviterUid,
      code,
      bonusPaid: false,
      at: FieldValue.serverTimestamp(),
    });
  } catch {
    // create() failed: this account already redeemed something.
    return { ok: false, reason: "This account already used an invite link." };
  }

  // Friendship is mutual and written from here, so neither side can add
  // themselves to anyone's list (both paths are deny-all in the rules).
  await Promise.all([
    db.doc(`users/${uid}/friends/${inviterUid}`).set({
      since: FieldValue.serverTimestamp(),
      via: "referral",
    }),
    db.doc(`users/${inviterUid}/friends/${uid}`).set({
      since: FieldValue.serverTimestamp(),
      via: "referral",
    }),
  ]);

  return { ok: true, inviterUid };
}

/**
 * Pay the referral bonus to both sides, once, when the invited account
 * finishes its first scored session. Called from awardXp.
 *
 * The `bonusPaid` flag is flipped inside a transaction and checked in the
 * same one, so two analyses finishing at the same moment can't both pay.
 * The inviter's XP is incremented rather than written, because their total
 * is being changed from outside their own request.
 */
export async function payReferralBonus(
  db: Firestore,
  uid: string
): Promise<{ paid: boolean; inviterUid?: string }> {
  const referralRef = db.doc(`users/${uid}/score/referral`);

  const inviterUid = await db.runTransaction(async (tx) => {
    const snap = await tx.get(referralRef);
    if (!snap.exists) return null;
    const data = snap.data();
    if (data?.bonusPaid) return null;
    const inviter = data?.inviterUid;
    if (typeof inviter !== "string") return null;

    tx.update(referralRef, {
      bonusPaid: true,
      paidAt: FieldValue.serverTimestamp(),
    });
    // XP only, deliberately no coins. If these 100 XP happen to cross a level
    // boundary, the 25 coins for that crossing are never paid: the next
    // awardXp compares against a prev.xp that already includes this bonus, so
    // it sees no level change. Left that way rather than reaching into the
    // coin ledger from here — a second writer to the balance is worth more
    // risk than 25 coins, and under-crediting is the safe direction (same
    // reasoning as BACKFILL_XP_PER_ATTEMPT in lib/leaderboardServer.ts).
    tx.set(
      db.doc(`users/${uid}/score/progress`),
      { xp: FieldValue.increment(REFERRAL_BONUS_XP) },
      { merge: true }
    );
    return inviter as string;
  });

  if (!inviterUid) return { paid: false };

  // The inviter's side is a separate write on purpose: if it fails, the
  // invitee still got theirs and we have a log line rather than a rolled-back
  // bonus for someone who did nothing wrong.
  //
  // But it must NOT unconditionally create the inviter's score/progress doc.
  // That doc's existence is the signal awardXp uses to decide whether to run
  // the one-time backfill and pay the inviter's OWN chained referral. Creating
  // it here with just the bonus would make the inviter's first real scored
  // session skip both. So: increment only if the doc already exists; otherwise
  // park the credit on score/invite, which awardXp folds into the seed when it
  // finally creates score/progress.
  try {
    const inviterProgressRef = db.doc(`users/${inviterUid}/score/progress`);
    const inviterInviteRef = db.doc(`users/${inviterUid}/score/invite`);
    await db.runTransaction(async (tx) => {
      const [snap, inviteSnap] = await Promise.all([
        tx.get(inviterProgressRef),
        tx.get(inviterInviteRef),
      ]);

      // Hard cap on how many referrals one account can be PAID for. The
      // invitee's own bonus is uncapped (it is once per account by
      // construction), but the inviter side had no limit at all: one operator
      // with N verified sock accounts could point all of them at a single
      // inviter for 100·(N−1) XP, funded entirely by the free Daily Minute.
      // The friendship and the invite still work past the cap; only the
      // payout stops.
      const paidSoFar = Number(inviteSnap.data()?.referralsPaid ?? 0);
      if (paidSoFar >= MAX_PAID_REFERRALS) return;

      if (snap.exists) {
        tx.update(inviterProgressRef, {
          xp: FieldValue.increment(REFERRAL_BONUS_XP),
        });
        tx.set(
          inviterInviteRef,
          { referralsPaid: FieldValue.increment(1) },
          { merge: true }
        );
      } else {
        tx.set(
          inviterInviteRef,
          {
            pendingBonusXp: FieldValue.increment(REFERRAL_BONUS_XP),
            referralsPaid: FieldValue.increment(1),
          },
          { merge: true }
        );
      }
    });
  } catch (err) {
    console.error("[referral] inviter payout failed", inviterUid, err);
  }

  return { paid: true, inviterUid };
}
