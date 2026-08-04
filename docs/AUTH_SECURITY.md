# Auth security: what protects what

The short version, because the long version keeps getting re-derived: **this
app never sees a password.** There is no password column, no hash to compare,
no `bcrypt`, no `argon2`, and there should never be one.

## Where credentials actually live

Sign-in, sign-up, password reset and password change all run through the
**Firebase Auth client SDK, in the browser**. The credential goes from the
user's device straight to Google. It does not pass through a Vercel function,
is never written to Firestore, and is never logged.

That means the standard password-storage checklist resolves like this:

| Requirement | Status |
| --- | --- |
| No plaintext password storage | **N/A — nothing to store.** Verified: no field, no collection, no write. |
| No MD5 / SHA-1 password hashing | **N/A, and verified absent.** `grep -riE "md5\|sha1"` over `app/ lib/ components/` returns nothing. |
| bcrypt (cost ≥ 12) or argon2id | **Delegated.** Firebase Auth hashes with **scrypt** (a memory-hard KDF in the same family as argon2, and a stronger choice than bcrypt for this purpose), with per-project parameters Google owns and rotates. Adding our own hashing would mean *receiving* the password server-side, which is strictly worse than not receiving it. |
| Hash on signup, rehash on change | Firebase. |
| Constant-time comparison | **N/A for passwords** (we compare none). Applied where we *do* compare a secret: `timingSafeCompare` in `lib/verify.ts`, used by `/api/cron/purge-ops`. Stripe's webhook HMAC is verified inside `constructEvent`, which is already constant-time. |
| Migration script to rehash weak hashes | **N/A — there are no legacy hashes to migrate.** The app has never stored a password in any form. A migration script would have nothing to read. |
| Never log passwords | **Verified.** No `console.*` call anywhere takes a password, a request body, an `authorization` header, or an ID token. `lib/validation.ts` deliberately returns `value: ""` from `validatePassword` on failure so a rejected password cannot travel with its own reason code. |

**Anyone auditing this should check the claim, not the table.** Two greps:

```bash
grep -rniE "md5|sha1|bcrypt|scrypt|pbkdf2" app lib components   # expect: nothing
grep -rn "console\." app lib components | grep -iE "password|token|secret|body"
```

## What WE own, and what we added

Firebase owns the credential. We own the login *surface*, and it now has:

- **`/api/auth/login`** (`app/api/auth/login/route.ts`) — the gate the client
  calls before and after every email sign-in.
- **`lib/loginGuard.ts`** — the policy:
  - 10 requests per IP per minute, in a **durable** Firestore sliding window
    (not the per-instance `makeRateLimiter`, which resets on every cold start
    and would have made the limit `instances × 10`).
  - A **progressive delay** after each failure: 0s, 1s, 2s, 4s, 8s … capped at
    30s. The first failure is free — that is a typo, and charging for it
    punishes the account's real owner.
  - **Lockout for 15 minutes after 5 consecutive failures**, cleared by a
    successful sign-in and by 24h of silence.
  - An **email to the account's owner** on the transition into lockout, with a
    real single-use Firebase reset link. Once per lockout, not once per
    attempt.
  - **Single-use attempt tickets.** `check` hands out a nonce; `result` will
    not move any counter without one. Without this, `result` was an
    unauthenticated endpoint that took the caller's word: five anonymous POSTs
    locked a stranger out of their own account, and one POST claiming success
    cleared a lockout that was doing its job.
  - **Proof of success, not a claim.** Clearing the ledger requires a valid
    Firebase ID token whose address matches the one being cleared.
  - **A bounded lock budget** (`MAX_LOCKS_PER_WINDOW`, 3 per hour). Past it the
    failures still count and the progressive delay still climbs, but the hard
    lock stops re-arming, and the operator log says so.

### The lockout tradeoff, stated plainly

Account lockout always has one cost: anyone who knows an address can spend
failed attempts against it and shut its owner out. The controls above raise the
price (each forged failure now costs a rate-limited request) and cap the damage
(a lock cannot be extended while open, and cannot re-arm more than three times
an hour), but they do not make it free of that cost, and nothing can — it is
the policy, not the implementation.

Four properties are covered by assertions rather than by hope: a forged failure
moves nothing; a ticket is single-use; five real failures still lock; an open
lock ends exactly when it said it would and cannot re-arm more than three times
an hour.

- **`lib/authMessages.ts`** — every sentence the app is allowed to say when
  auth fails, in one auditable place.

## The rule the messages encode

Wrong password, no such account, malformed address, disabled account,
rate-limited and locked out **all produce `"Incorrect email or password"`**.
Password reset always says `"If that email is registered, you will receive a
reset link."`, whether or not it is, and whether or not the send worked.
Registration never confirms an address is already taken.

The specific reason is not discarded — it is logged server-side as a machine
code via `logRejectedInput`, which is where it is useful and where an attacker
cannot read it.

## What this does NOT defend against — read this part

The guard protects **our login form**. It cannot stop someone calling Google's
`identitytoolkit` REST API directly with the public `NEXT_PUBLIC_FIREBASE_API_KEY`,
because that request never reaches us. Nothing in this repository can.

At that layer the controls are Firebase's, and two of them are **console
settings that cannot be verified from this codebase**:

1. **Email enumeration protection** (Authentication → Settings). Without it the
   SDK still returns `auth/user-not-found` to the client, so the raw error code
   is visible in devtools regardless of what we render. Our copy is clean; the
   wire is not, until this is on.
2. **App Check enforcement.** `APPCHECK_ENFORCE=true` makes `/api/analyze` and
   `/api/speech` reject unattested callers; it currently **soft-fails by
   default** (logs and allows). Firestore enforcement is already on.

Firebase's own adaptive throttling is live either way — the code maps
`auth/too-many-requests` and `auth/quota-exceeded`.

## Configuration this depends on

| Var | Effect if unset |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | The guard **fails open** and logs `[login] guard inactive`. Deliberate: refusing every sign-in because a service account is missing takes the product off the air to protect nothing. |
| `LOGIN_HASH_SALT` | Ledger keys fall back to a constant salt. Still irreversible, but enumerable against a word list by anyone holding a database dump. Set it. |
| `RESEND_API_KEY` + `MAIL_FROM` | No lockout email is sent; the lockout still applies and logs `no mailer is configured`. The code never claims to have sent mail it didn't. |
| `CRON_SECRET` | `/api/cron/purge-ops` **fails closed** in production (503 + an error line), rather than running for anonymous callers. |

## Firestore

`loginAttempts/{hash}` and `loginRates/{hash}` are **deny-all in both
directions** (`firestore.rules`). Read access would turn an anti-enumeration
control into an enumeration oracle; write access would let a client clear its
own lockout. Both carry an `expiresAt` timestamp — **set a Firestore TTL policy
on that field for each collection** so rows clean themselves up.

No email address is stored in either collection. The document id is a salted
SHA-256 of the normalized address, so the ledger cannot be mined for a user
list and joins to nothing else in the database.
