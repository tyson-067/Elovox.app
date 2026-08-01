// Referral constants both halves need.
//
// Separate from lib/referral.ts because that file imports firebase-admin,
// which must never be pulled into a client bundle — importing it from a
// "use client" component would drag a server SDK (and the shape of our
// service-account handling) into the browser.

/** XP each side gets, once, when the invited user finishes their first rep. */
export const REFERRAL_BONUS_XP = 100;

/**
 * How many referrals a single account can be PAID for. Well past anyone
 * genuinely sharing the app with friends, and low enough that a farm of
 * throwaway accounts pointed at one inviter stops being worth the effort —
 * the payout is XP, which is what ranks the public leaderboard.
 *
 * Only the payout is capped. Invites still work and friendships are still
 * made past this number.
 */
export const MAX_PAID_REFERRALS = 25;
