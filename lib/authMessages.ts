/**
 * Every sentence the app is allowed to say when authentication goes wrong.
 *
 * They live in one file, isomorphic and dependency-free, so the client that
 * renders them and the server that returns them can never drift apart — and so
 * that the rule they encode is auditable in one place instead of grepped for
 * across twenty call sites.
 *
 * THE RULE: a message about credentials must be identical for every cause.
 * Wrong password, no such account, malformed address, disabled account,
 * rate-limited, locked out — one sentence. Anything that varies is an oracle:
 * an attacker who can tell "no such user" from "wrong password" has a free
 * account-enumeration endpoint, and one who can tell "locked out" from "wrong
 * password" knows which addresses are real AND when to come back.
 *
 * The specific reason is not thrown away, it is just not told to the caller:
 * every rejection is logged server-side as a machine code (see
 * `logRejectedInput` in lib/verify.ts), which is where it is actually useful.
 */

/** Sign-in failed. The only sentence. Never say which half was wrong. */
export const GENERIC_CREDENTIALS = "Incorrect email or password";

/**
 * Password reset. Said whether or not the address is registered, and said
 * even when the send itself failed — the caller must not be able to tell.
 */
export const RESET_SENT =
  "If that email is registered, you will receive a reset link.";

/**
 * Anything a form rejected. Deliberately does not name the field: a
 * field-specific message on an auth form tells a script which half of a
 * guessed pair to keep.
 */
export const GENERIC_INVALID = "Please check your details and try again.";

/** The catch-all for an unexpected failure. */
export const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Policy on a password being CREATED, not one being checked. Safe to be
 * specific: it describes our rule, not the state of any account.
 */
export const PASSWORD_POLICY = "Password needs to be at least 8 characters.";
