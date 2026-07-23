import type { User } from "firebase/auth";
import { getAuthInstance } from "./firebase";
import {
  validateAuthInput,
  validateEmail,
  validatePassword,
  GENERIC_INVALID,
} from "./validation";

// Thin wrappers around Firebase Auth for the onboarding pages. firebase/auth
// is imported dynamically so the landing page doesn't pay for it upfront.
//
// SECURITY NOTE: with Firebase Auth the credentials go from the browser
// straight to Google's servers — they never touch our own server, so there
// is no server route on which to validate or hash them. Firebase owns the
// password hashing (scrypt), the storage, and the adaptive login throttling.
// What we CAN own, and do here, is: validate + sanitize every field before
// the SDK is called (regardless of the HTML form's own checks), keep the
// user-facing errors generic, and report validation failures for monitoring.

/**
 * Fire-and-forget: tell the server a client-side auth validation failed, so
 * the failure is recorded server-side for monitoring. Best-effort telemetry,
 * never a security boundary, and it never carries the email or password.
 */
function reportValidationFailure(mode: "login" | "signup", reasons: string[]): void {
  try {
    void fetch("/api/auth/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, reasons }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Never let telemetry break the auth flow.
  }
}

/** Thrown when local validation rejects input; carries only a generic message. */
export class ValidationError extends Error {
  constructor() {
    super(GENERIC_INVALID);
    this.name = "ValidationError";
  }
}

export async function signUpWithEmail(
  name: string,
  email: string,
  password: string
): Promise<void> {
  const check = validateAuthInput({ name, email, password }, "signup");
  if (!check.ok) {
    reportValidationFailure("signup", check.reasons);
    throw new ValidationError();
  }

  const { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } =
    await import("firebase/auth");
  const cred = await createUserWithEmailAndPassword(
    getAuthInstance(),
    check.clean.email,
    check.clean.password
  );
  if (check.clean.name) {
    await updateProfile(cred.user, { displayName: check.clean.name });
  }
  // Kick off email verification. Non-fatal: a failure here (e.g. quota) must
  // not block an otherwise-successful signup.
  try {
    await sendEmailVerification(cred.user);
  } catch {
    /* verification email can be re-sent later from the dashboard */
  }
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<void> {
  const check = validateAuthInput({ email, password }, "login");
  if (!check.ok) {
    reportValidationFailure("login", check.reasons);
    throw new ValidationError();
  }
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  await signInWithEmailAndPassword(
    getAuthInstance(),
    check.clean.email,
    check.clean.password
  );
}

export async function signInWithGoogle(): Promise<void> {
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  await signInWithPopup(getAuthInstance(), new GoogleAuthProvider());
}

export async function signOutUser(): Promise<void> {
  const { signOut } = await import("firebase/auth");
  await signOut(getAuthInstance());
}

/**
 * Send a password-reset email. Deliberately resolves the SAME way whether or
 * not the address has an account — the caller shows one neutral message — so
 * this can't be used to probe which emails are registered. (Enable "Email
 * enumeration protection" in the Firebase console to close the same leak at
 * the source, since the SDK still returns auth/user-not-found to the client.)
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const { validateEmail } = await import("./validation");
  const check = validateEmail(email);
  if (!check.ok) {
    reportValidationFailure("login", [check.reason ?? "email_format"]);
    return; // stay silent — the neutral message is shown regardless
  }
  try {
    const { sendPasswordResetEmail } = await import("firebase/auth");
    await sendPasswordResetEmail(getAuthInstance(), check.value);
  } catch {
    // Swallow: never reveal whether the address exists.
  }
}

/** The one neutral line shown after any password-reset request. */
export const PASSWORD_RESET_NOTICE =
  "If that email is registered, you will receive a reset link.";

// --- Account management (signed-in user) --------------------------------
// Changing an email or password is a "sensitive" operation: Firebase requires
// a recent sign-in, so we re-authenticate first. Email changes go through
// verifyBeforeUpdateEmail — the link is sent to the NEW address and the email
// only changes once the user clicks it, so a typo can't lock anyone out and
// nobody can move their login to an address they don't control.

/** Does this account sign in with an email + password (vs. only Google)? */
export function hasPasswordProvider(user: User): boolean {
  return user.providerData.some((p) => p.providerId === "password");
}

/** Re-verify the current user before a sensitive change. */
async function reauthenticate(user: User, currentPassword?: string): Promise<void> {
  const auth = await import("firebase/auth");
  if (hasPasswordProvider(user)) {
    if (!currentPassword || !user.email) throw new ValidationError();
    const cred = auth.EmailAuthProvider.credential(user.email, currentPassword);
    await auth.reauthenticateWithCredential(user, cred);
  } else {
    // Google (or other federated) account — confirm via a fresh popup.
    await auth.reauthenticateWithPopup(user, new auth.GoogleAuthProvider());
  }
}

/** (Re)send the "verify your email" message to the signed-in user. */
export async function resendVerificationEmail(): Promise<void> {
  const user = getAuthInstance().currentUser;
  if (!user) throw new Error("You're not signed in.");
  const { sendEmailVerification } = await import("firebase/auth");
  await sendEmailVerification(user);
}

/**
 * Refresh the user from Firebase and return their current verified state.
 * Called after the user says they've clicked the verification link, since the
 * cached token won't reflect it until reloaded.
 */
export async function refreshVerifiedStatus(): Promise<boolean> {
  const user = getAuthInstance().currentUser;
  if (!user) return false;
  await user.reload();
  return user.emailVerified;
}

/**
 * Start an email change. Sends a confirmation link to `newEmail`; the address
 * only switches over after the user clicks it. Requires the current password
 * for email/password accounts (a Google account confirms via popup instead).
 */
export async function changeEmail(
  newEmail: string,
  currentPassword?: string
): Promise<void> {
  const check = validateEmail(newEmail);
  if (!check.ok) throw new ValidationError();
  const user = getAuthInstance().currentUser;
  if (!user) throw new Error("You're not signed in.");
  await reauthenticate(user, currentPassword);
  const { verifyBeforeUpdateEmail } = await import("firebase/auth");
  await verifyBeforeUpdateEmail(user, check.value);
}

/** Notice shown after an email-change request — the switch is not immediate. */
export const EMAIL_CHANGE_NOTICE =
  "Check your new inbox — the change takes effect once you click the link we sent.";

/**
 * Change the password on an email/password account. Re-authenticates with the
 * current password, then sets the new one (validated against the same policy
 * as signup).
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const check = validatePassword(newPassword);
  if (!check.ok) throw new ValidationError();
  const user = getAuthInstance().currentUser;
  if (!user) throw new Error("You're not signed in.");
  if (!hasPasswordProvider(user)) {
    throw new Error("This account signs in with Google, so it has no password.");
  }
  await reauthenticate(user, currentPassword);
  const { updatePassword } = await import("firebase/auth");
  await updatePassword(user, check.value);
}

/**
 * Permanently delete the signed-in user: their practice history, their
 * profile, their subscription, and the login itself.
 *
 * Re-authenticates first — this is the most destructive action in the app,
 * so an idle session someone walked away from can't trigger it. The actual
 * erasure runs server-side (/api/account/delete) because only the Admin SDK
 * can remove the plan doc and the whole subtree; the fresh ID token minted
 * here is what authorizes it.
 */
export async function deleteAccount(currentPassword?: string): Promise<void> {
  const user = getAuthInstance().currentUser;
  if (!user) throw new Error("You're not signed in.");
  await reauthenticate(user, currentPassword);

  const res = await fetch("/api/account/delete", {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken(true)}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Couldn't delete your account. Try again.");
  }

  // The server deleted the auth record; clear the local session so the app
  // doesn't sit on a token for a user that no longer exists.
  await signOutUser().catch(() => {});
}

/**
 * Error copy for the signed-in account settings screen. Unlike the sign-in
 * screen, this speaks to the account owner, so a wrong CURRENT password can be
 * named plainly — there's no enumeration risk in your own settings.
 */
export function accountErrorMessage(err: unknown): string {
  if (err instanceof ValidationError) return err.message;
  const code = (err as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "That current password is incorrect.";
    case "auth/requires-recent-login":
      return "For security, sign out and back in, then try again.";
    case "auth/email-already-in-use":
      return "That email is already in use.";
    case "auth/invalid-email":
      return "That email doesn't look right.";
    case "auth/weak-password":
      return "Password needs to be at least 8 characters.";
    case "auth/too-many-requests":
      return "Too many attempts — wait a moment and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return ""; // user backed out of the Google confirmation
    default:
      return "Something went wrong. Please try again.";
  }
}

/**
 * Maps Firebase Auth errors to SAFE, generic copy. Login and lockout failures
 * are indistinguishable on purpose (no email enumeration, no "wrong password
 * vs. locked out" tell); signup never confirms whether an email already exists.
 */
export function authErrorMessage(
  err: unknown,
  mode: "login" | "signup" = "login"
): string {
  // Our own local validation failure — already generic.
  if (err instanceof ValidationError) return err.message;

  const code = (err as { code?: string })?.code ?? "";
  switch (code) {
    // --- Login family: wrong email, wrong password, and account lockout /
    // rate-limiting ALL return the exact same line. Never reveal which. ---
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
    case "auth/too-many-requests":
    case "auth/user-disabled":
      if (mode === "login") return "Incorrect email or password";
      // On signup these mostly can't occur; fall through to the generic below.
      return GENERIC_INVALID;

    // --- Signup: do NOT confirm the email is already registered. ---
    case "auth/email-already-in-use":
      return GENERIC_INVALID;

    case "auth/weak-password":
      // Safe to state the policy for a password being created.
      return "Password needs to be at least 8 characters.";

    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return ""; // user changed their mind; not an error worth showing

    default:
      return "Something went wrong. Please try again.";
  }
}
