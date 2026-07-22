// Shared, framework-agnostic validation + sanitization for anything a user
// types that reaches auth or a server route. Runs in the browser (before the
// Firebase client SDK is called) AND on the server (API routes), so the same
// rules apply no matter what the HTML form did — never trust client-side
// checks alone.
//
// Design rules baked in here:
//  - Validate format AND length for every field.
//  - Sanitize: strip HTML/script tags and control/special characters.
//  - Callers surface a single GENERIC message to the user; the specific
//    field/reason is only ever returned for server-side logging, never shown.

export interface FieldResult {
  ok: boolean;
  /** Sanitized value, safe to forward. Only meaningful when ok is true. */
  value: string;
  /** Machine reason for logs/monitoring only — never shown to the user. */
  reason?: string;
}

// Generic, non-specific message. Deliberately does not say which field or why.
export const GENERIC_INVALID = "Please check your details and try again.";

const EMAIL_MAX = 254; // RFC 5321
const PASSWORD_MIN = 8; // Firebase minimum is 6; we require a bit more
const PASSWORD_MAX = 128; // cap to stop a megabyte-password DoS
const NAME_MIN = 1;
const NAME_MAX = 60;

// Reasonably strict single-address email shape. Not a full RFC parser — it
// rejects the obvious junk (spaces, missing @, missing TLD) and defers the
// real check to Firebase / an actual verification email.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Names/display names: letters (incl. accented + CJK), digits, spaces, and a
// small set of real-name punctuation. Everything else is stripped.
const NAME_ALLOWED = /[^\p{L}\p{M}\p{N} '.\-]/gu;

// ASCII control characters, excluding tab/newline/carriage-return.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Strip HTML tags, `<script>` payloads, angle brackets, and control chars.
 * Used on every free-text field before it is stored, forwarded, or echoed.
 */
export function sanitizeText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    // Drop whole <script>…</script> blocks including their contents.
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    // Drop any remaining tags.
    .replace(/<\/?[a-z][^>]*>/gi, "")
    // Neutralize stray angle brackets so nothing can be reconstructed.
    .replace(/[<>]/g, "")
    .replace(CONTROL_CHARS, "")
    .trim();
}

export function validateEmail(input: unknown): FieldResult {
  const value = sanitizeText(input).toLowerCase();
  if (!value) return { ok: false, value, reason: "email_empty" };
  if (value.length > EMAIL_MAX)
    return { ok: false, value, reason: "email_too_long" };
  if (!EMAIL_RE.test(value)) return { ok: false, value, reason: "email_format" };
  return { ok: true, value };
}

export function validatePassword(input: unknown): FieldResult {
  // Passwords are NOT sanitized (that would silently change the secret) —
  // they are only length/format-checked. They are also never returned to a
  // caller that logs, and never logged themselves.
  const value = typeof input === "string" ? input : "";
  if (value.length < PASSWORD_MIN)
    return { ok: false, value: "", reason: "password_too_short" };
  if (value.length > PASSWORD_MAX)
    return { ok: false, value: "", reason: "password_too_long" };
  if (!/\S/.test(value)) return { ok: false, value: "", reason: "password_blank" };
  return { ok: true, value };
}

export function validateName(input: unknown, required = false): FieldResult {
  const value = sanitizeText(input)
    .replace(NAME_ALLOWED, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) {
    return required
      ? { ok: false, value: "", reason: "name_empty" }
      : { ok: true, value: "" }; // name is optional at signup
  }
  if (value.length < NAME_MIN || value.length > NAME_MAX)
    return { ok: false, value, reason: "name_length" };
  return { ok: true, value };
}

export interface AuthInput {
  email?: unknown;
  password?: unknown;
  name?: unknown;
}

export interface AuthValidation {
  ok: boolean;
  /** Sanitized, safe-to-use values (only meaningful when ok). */
  clean: { email: string; password: string; name: string };
  /** Every failing field's machine reason — for server-side logs only. */
  reasons: string[];
}

/**
 * Validate a full auth payload as a schema. `mode` decides whether the
 * password policy applies (signup enforces it; login only checks that
 * something plausible was entered, so we never leak the policy to attackers).
 */
export function validateAuthInput(
  input: AuthInput,
  mode: "login" | "signup"
): AuthValidation {
  const reasons: string[] = [];

  const email = validateEmail(input.email);
  if (!email.ok) reasons.push(email.reason!);

  let password: FieldResult;
  if (mode === "signup") {
    password = validatePassword(input.password);
    if (!password.ok) reasons.push(password.reason!);
  } else {
    const pw = typeof input.password === "string" ? input.password : "";
    password =
      pw.length > 0 && pw.length <= PASSWORD_MAX
        ? { ok: true, value: pw }
        : { ok: false, value: "", reason: "password_empty" };
    if (!password.ok) reasons.push(password.reason!);
  }

  const name = validateName(input.name, false);
  if (!name.ok) reasons.push(name.reason!);

  return {
    ok: reasons.length === 0,
    clean: { email: email.value, password: password.value, name: name.value },
    reasons,
  };
}

export const LIMITS = {
  EMAIL_MAX,
  PASSWORD_MIN,
  PASSWORD_MAX,
  NAME_MIN,
  NAME_MAX,
} as const;
