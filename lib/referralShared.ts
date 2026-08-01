// Referral constants both halves need.
//
// Separate from lib/referral.ts because that file imports firebase-admin,
// which must never be pulled into a client bundle — importing it from a
// "use client" component would drag a server SDK (and the shape of our
// service-account handling) into the browser.

/** XP each side gets, once, when the invited user finishes their first rep. */
export const REFERRAL_BONUS_XP = 100;
