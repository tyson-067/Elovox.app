import type { User } from "firebase/auth";
import { getAuthInstance, isFirebaseConfigured } from "./firebase";
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
// straight to Google's servers, they never touch our own server, so there
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
  // Kick off email verification. Still non-fatal — the account exists and is
  // usable, and refusing to complete a signup because one email didn't go out
  // would be a worse outcome than the missing email.
  //
  // But it is no longer SILENT, which it was, and which made "I never got the
  // verification email" impossible to explain: the throw was discarded
  // unexamined, so there was no error to read, nothing in the console, and the
  // user was dropped on a screen telling them to check an inbox nothing had
  // been sent to. The failure is recorded here and the waiting-room screen
  // reads it (see components/VerifyEmailScreen.tsx), so the user is told to
  // press Resend rather than left watching an empty inbox.
  try {
    await sendEmailVerification(cred.user, VERIFY_ACTION);
    clearVerificationSendFailure();
  } catch (err) {
    console.error("[auth] signup verification email failed to send", err);
    recordVerificationSendFailure(err);
  }
}

/* --- Did the automatic verification email get out? ------------------------
   sessionStorage, not a module variable: RequireAuth sends a fresh signup to
   /verify-email, and that can arrive as a full document load rather than a
   client-side navigation, which resets module state. Session scope is also
   the right lifetime — it is a fact about this signup attempt, not about the
   account. */

const SEND_FAILED_KEY = "elovox.verifyEmailSendFailed";

function recordVerificationSendFailure(err: unknown): void {
  try {
    const code = (err as { code?: string })?.code ?? "";
    sessionStorage.setItem(SEND_FAILED_KEY, code || "unknown");
  } catch {
    // Private mode. The screen just won't get the hint.
  }
}

function clearVerificationSendFailure(): void {
  try {
    sessionStorage.removeItem(SEND_FAILED_KEY);
  } catch {
    /* nothing stored, nothing to clear */
  }
}

/**
 * The Firebase error code from a failed automatic verification email, or null
 * if the last signup's email went out fine (or there wasn't one).
 */
export function verificationSendFailure(): string | null {
  try {
    return sessionStorage.getItem(SEND_FAILED_KEY);
  } catch {
    return null;
  }
}

/** Called once the user has successfully re-sent it by hand. */
export function clearVerificationSendFailed(): void {
  clearVerificationSendFailure();
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

/**
 * Ask the native Google account picker for an ID token.
 *
 * Only reachable on iOS/Android. Returns the raw Google ID token, which the
 * caller exchanges for a Firebase session on the JS side — we deliberately do
 * NOT let the native layer own the session, so App Check, the Firestore rules,
 * and `verifyVerifiedUser` in the API routes all keep seeing exactly the same
 * user object they see on the web.
 */
async function nativeGoogleIdToken(): Promise<string> {
  const { FirebaseAuthentication } = await import(
    "@capacitor-firebase/authentication"
  );
  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result.credential?.idToken;
  // No token means the user backed out of the system sheet. Not an error
  // worth reporting, but the caller still needs a rejected promise.
  if (!idToken) throw new Error("Google sign-in was canceled.");
  return idToken;
}

/**
 * Signs in with Google, and reports whether that call CREATED the account.
 *
 * The distinction matters because Firebase provisions a user the first time a
 * Google identity appears — there is no separate "sign up" call. So the
 * "Continue with Google" button on the LOGIN screen creates accounts too, and
 * the login screen has no age gate. `isNewUser` lets the caller send a
 * first-time Google user through the same date-of-birth check that every
 * email signup clears. See components/AuthForm.tsx.
 */
export async function signInWithGoogle(): Promise<{ isNewUser: boolean }> {
  const {
    GoogleAuthProvider,
    signInWithPopup,
    signInWithCredential,
    getAdditionalUserInfo,
  } = await import("firebase/auth");

  // Popups do not exist in a WKWebView, and Google increasingly refuses OAuth
  // inside embedded webviews outright (disallowed_useragent). signInWithRedirect
  // is no better: it leans on cross-origin storage that Safari's ITP degrades.
  // So native gets the system account picker, web keeps the popup that works.
  const { Capacitor } = await import("@capacitor/core");
  if (Capacitor.isNativePlatform()) {
    const idToken = await nativeGoogleIdToken();
    const cred = await signInWithCredential(
      getAuthInstance(),
      GoogleAuthProvider.credential(idToken)
    );
    return { isNewUser: getAdditionalUserInfo(cred)?.isNewUser === true };
  }

  const cred = await signInWithPopup(getAuthInstance(), new GoogleAuthProvider());
  return { isNewUser: getAdditionalUserInfo(cred)?.isNewUser === true };
}

/**
 * Warm everything the first "Continue with Google" click needs, ahead of the
 * click. Call it when the auth form mounts.
 *
 * The bug this fixes: signInWithGoogle `await import()`s firebase/auth and
 * @capacitor/core BEFORE it calls signInWithPopup. On the very first click those
 * modules aren't in cache yet, so fetching+parsing them spends the browser's
 * user-activation window — by the time signInWithPopup tries to open the popup
 * the click no longer counts as a user gesture, the browser blocks it
 * (auth/popup-blocked), and the caller shows the generic "Something went wrong".
 * The second click finds the modules cached, reaches signInWithPopup inside the
 * gesture, and works. Pre-loading them on mount means the first real click is
 * already the "second click".
 *
 * Fire-and-forget: every step is optional and self-healing (the real call
 * imports again if this didn't finish), so failures here are safe to ignore.
 */
export function prewarmProviderSignIn(): void {
  void import("firebase/auth");
  void import("@capacitor/core");
  // Also nudge the Firebase app + App Check to initialize now, so a reCAPTCHA
  // attestation token is being fetched ahead of the first sign-in rather than
  // during it.
  if (isFirebaseConfigured()) {
    try {
      getAuthInstance();
    } catch {
      // Not configured, or no window (SSR): nothing to warm.
    }
  }
}

/**
 * Deletes the account that was just created by a provider sign-in, for the
 * case where it should never have existed (a first-time Google user who has
 * not cleared the age gate). Falls back to signing out: leaving them signed
 * in would be the one outcome we can't accept, since the whole point is that
 * no under-age account gets through.
 */
export async function discardJustCreatedUser(): Promise<void> {
  const auth = getAuthInstance();
  const user = auth.currentUser;
  try {
    if (user) await user.delete();
    else await signOutUser();
  } catch {
    // A delete can be refused (requires-recent-login shouldn't apply here,
    // but never assume). Signing out still closes the session.
    await signOutUser();
  }
}

export async function signOutUser(): Promise<void> {
  const { signOut } = await import("firebase/auth");

  // On iOS the Google sign-in also authenticates the NATIVE Firebase/GIDSignIn
  // layer, and signing out of the JS SDK alone left that session standing: on
  // a shared device the next "Continue with Google" silently re-authenticated
  // the previous person with no account picker, and the same stale session
  // survived account deletion and undermined the re-auth prompt that gates
  // deleting an account or changing a password.
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { FirebaseAuthentication } = await import(
        "@capacitor-firebase/authentication"
      );
      await FirebaseAuthentication.signOut();
    }
  } catch {
    // Never let a native teardown failure stop the JS sign-out below, which
    // is the one that actually ends the session this app reads.
  }

  await signOut(getAuthInstance());
}

/**
 * Send a password-reset email. Deliberately resolves the SAME way whether or
 * not the address has an account, the caller shows one neutral message, so
 * this can't be used to probe which emails are registered. (Enable "Email
 * enumeration protection" in the Firebase console to close the same leak at
 * the source, since the SDK still returns auth/user-not-found to the client.)
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const { validateEmail } = await import("./validation");
  const check = validateEmail(email);
  if (!check.ok) {
    reportValidationFailure("login", [check.reason ?? "email_format"]);
    return; // stay silent, the neutral message is shown regardless
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
// verifyBeforeUpdateEmail, the link is sent to the NEW address and the email
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
    // Google (or other federated) account, confirm via a fresh sign-in.
    // Same webview constraint as signInWithGoogle: no popup on native. Miss
    // this branch and change-email, change-password and delete-account all
    // hang silently on iOS for anyone who signed up with Google.
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const idToken = await nativeGoogleIdToken();
      await auth.reauthenticateWithCredential(
        user,
        auth.GoogleAuthProvider.credential(idToken)
      );
      return;
    }
    await auth.reauthenticateWithPopup(user, new auth.GoogleAuthProvider());
  }
}

/** (Re)send the "verify your email" message to the signed-in user. */
export async function resendVerificationEmail(): Promise<void> {
  const user = getAuthInstance().currentUser;
  if (!user) throw new Error("You're not signed in.");
  const { sendEmailVerification } = await import("firebase/auth");
  await sendEmailVerification(user, VERIFY_ACTION);
}

/**
 * Where the verification email's link sends people afterwards. Without this,
 * clicking the link strands the user on the Firebase-hosted action page at
 * the legacy sonoria-212c1.firebaseapp.com domain (roadmap 7.4) with no way
 * back into the product — and a bare "continue" URL on our own domain also
 * gives the message one more signal that it belongs to elovox.app, which is
 * where deliverability reputation accrues. The domain must stay listed in
 * Firebase Auth's authorized domains, which it already is.
 */
const VERIFY_ACTION = {
  url: (process.env.NEXT_PUBLIC_APP_URL || "https://elovox.app") + "/verify-email",
};

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
  try {
    await verifyBeforeUpdateEmail(user, check.value);
  } catch (err) {
    // The change-email target is an arbitrary address in the global account
    // namespace, not the caller's own, so a distinct "already in use" error
    // here is an email-enumeration oracle: sign in once, then probe addresses
    // one by one. Swallow exactly that code so the caller always sees the
    // same EMAIL_CHANGE_NOTICE. Nothing is leaked and nothing is wrongly
    // changed: the address only switches when the user clicks the link, which
    // is never sent for an in-use target.
    if ((err as { code?: string })?.code !== "auth/email-already-in-use") {
      throw err;
    }
  }
}

/** Notice shown after an email-change request, the switch is not immediate. */
export const EMAIL_CHANGE_NOTICE =
  "Check your new inbox, the change takes effect once you click the link we sent.";

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
 * Re-authenticates first, this is the most destructive action in the app,
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
 * named plainly, there's no enumeration risk in your own settings.
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
      return "Too many attempts. Wait a moment and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return ""; // user backed out of the Google confirmation
    // App Check failures used to land in `default` and read as "Something went
    // wrong. Please try again." — advice that cannot work, since retrying
    // an unattested client fails identically every time. These are the codes
    // Firebase raises when enforcement is on and this client could not mint a
    // token; naming them is what makes a report of "it never sends" traceable
    // to a console setting rather than to the mail.
    case "auth/firebase-app-check-token-is-invalid":
    case "auth/app-check-token-invalid":
    case "auth/unverified-app":
      return "We couldn't verify this device with our security check. Reload and try again — if it keeps happening, get in touch.";
    case "auth/quota-exceeded":
      return "We've hit our email limit for now. Try again in a little while.";
    case "auth/network-request-failed":
      return "No connection. Check your network and try again.";
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
  // Our own local validation failure, already generic.
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
