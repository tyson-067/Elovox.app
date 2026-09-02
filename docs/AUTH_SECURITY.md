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

**Anyone auditing this should check the claim, not the table.** Two greps —
and both are written so that what they return is what the sentence next to them
says:

```bash
# Does any code here hash a credential? Matches imports and calls, not prose.
grep -rniE 'bcrypt|argon2|pbkdf2|scryptSync?\(|createHash\("(md5|sha1)"' app lib components
# expect: nothing

# Does anything log a secret? Matches the WORDS, so read the hits.
grep -rn "console\." app lib components | grep -iE "password|token|secret|body"
# expect: a handful, every one of them the WORD in a literal message or a
# comment and none of them a value — e.g. "auth validation rejected [body]",
# which interpolates an IP and a machine reason code, and "[app-check] token
# fetch failed", which interpolates an error. A hit that interpolates a request
# body, a header or a credential is the bug this grep exists to find.
```

The first grep used to read `"md5|sha1|bcrypt|scrypt|pbkdf2"` with `# expect:
nothing` next to it, and it returned two hits — both of them this document's own
argument, written out as a comment in `lib/loginGuard.ts` and `lib/auth.ts`
("Firebase owns the password hashing (scrypt)"). A verification recipe whose
stated result is wrong is worse than no recipe: the first person to run it
learns that the checks in here are not run.

## What WE own, and what we added

Firebase owns the credential. We own the login *surface*, and it now has:

- **`/api/auth/login`** (`app/api/auth/login/route.ts`) — the gate the client
  calls before and after every email sign-in.
- **`lib/loginGuard.ts`** — the policy:
  - **120 requests per IP per minute**, in a **durable** Firestore sliding
    window (not the per-instance `makeRateLimiter`, which resets on every cold
    start and would have made the limit `instances × 120`). A sign-in costs
    **two** requests — `check` then `result` — so this is 60 sign-in attempts a
    minute for a whole egress address. It was 10, i.e. five attempts a minute
    shared by everyone behind one IP, which for a phone app behind carrier-grade
    NAT is an outage rather than an abuse control — and because every refusal
    reads as `"Incorrect email or password"`, the people it hit were told their
    password was wrong when it was not.
  - **30 failed sign-ins per IP per hour, net of that address's successes**
    (`LOGIN_IP_FAILURE_LIMIT`), in the same durable sliding window and the same
    Firestore row — so checking both ceilings costs the one transaction that
    checking either used to. This is the **spray control**, and it is the reason
    the raise above did not simply give something away.

    Raising the request ceiling loosened exactly one axis. The per-account
    ledger cannot see password *spraying* — one password tried once each
    against many different addresses, where no single account ever reaches a
    second failure — so the per-IP number was the only thing bounding it, and
    10 → 120 took a sprayer from 5 attempts a minute to 60. **Spraying spends
    one failure per address, so failures per hour is distinct accounts per
    hour:**

    | Control | Attempts/min from one IP | Accounts sprayed per hour |
    | --- | --- | --- |
    | Old limit, 10 requests/min | 5 | 300 |
    | Raised limit, 120 requests/min | 60 | 3600 |
    | **This ceiling, 30 failures/hour** | — | **30** |

    So the pair is **10× tighter on spraying than the limit it replaces**, and
    120× tighter than the raised request ceiling alone, while giving real
    crowds their headroom back.

    **It does not fire on a crowd.** Every sign-in *proven* successful — a
    Firebase ID token verified at Google, not a claim in a request body —
    forgives one recorded failure for that address, and the count floors at
    zero, so an address whose users are getting in never accumulates however
    many of them there are and however often they mistype. Reaching 30 takes
    thirty more wrong passwords than sign-ins inside one hour; a user who has
    genuinely forgotten their password contributes at most 5 before the
    per-account lock stops that account cold, so 30 is six such people behind
    one address in one hour with not one success between them. The proof
    requirement is load-bearing: a credit anyone could claim would be minted by
    a sprayer faster than it spent failures.

    **What it costs when it does fire**, stated rather than glossed: the
    ceiling blocks the *address*, not the account, so a real user sharing an
    address with a sprayer is throttled alongside them until failures age out
    one at a time — or sooner, since any success that does get through forgives
    one. And a caller that never reports its failures is not counted here; it
    gains nothing by that, because it could skip this route entirely and call
    `identitytoolkit` directly, which is the limit described further down.
  - A **progressive delay** after each failure: 0s, 1s, 2s, 4s, 8s … capped at
    30s. The first failure is free — that is a typo, and charging for it
    punishes the account's real owner.
  - **Lockout for 15 minutes after 5 consecutive failures**, cleared by a
    successful sign-in and by 24h of silence.
  - An **email to the account's owner** on the transition into lockout, with a
    real single-use Firebase reset link. Once per lockout, not once per
    attempt, and **globally capped at 20 a day** (`LIMITS["lockout-notice"]` in
    `lib/rateLimit.ts`, keyed on a constant rather than on the address). Per
    address the cap does nothing: an unauthenticated caller with a hundred
    known addresses trips a hundred lockouts, each one an honest single notice,
    and a hundred is the free plan's **entire** daily send allowance — after
    which every payment-failed, welcome and export-ready email is dropped until
    midnight. `security` mail is also held to half the daily budget rather than
    all of it (`CATEGORY` in `lib/email/config.ts`), so no one category can
    starve the rest whatever provokes it. Past either cap **the lockout still
    applies in full**; only the courtesy email is dropped, and the operator log
    says which gate dropped it. Nothing logs a send that did not happen.
  - **Single-use attempt tickets.** `check` hands out a nonce; `result` will
    not move any counter without one. Without this, `result` was an
    unauthenticated endpoint that took the caller's word: five anonymous POSTs
    locked a stranger out of their own account, and one POST claiming success
    cleared a lockout that was doing its job.
  - **Proof of success, not a claim.** Clearing the ledger requires a valid
    Firebase ID token whose address matches the one being cleared.
  - **Only a ticketed failure feeds the per-IP ceiling.** A failure anyone
    could assert is a failure anyone could use to throttle a whole carrier NAT
    on purpose, which would turn the spray control into a denial-of-service
    tool.
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

Four properties are covered by assertions rather than by hope, and the
assertions are in **`tests/unit/login-guard.test.ts`**: a forged failure moves
nothing; a ticket is single-use; five real failures still lock; an open lock
ends exactly when it said it would. The spray ceiling is pinned in the same
file by the two halves of its trade — a sprayer is stopped well inside the
request ceiling, and an address whose users are signing in successfully is
never stopped at all — plus the row's TTL, which has to outlive the *failure*
window rather than the request one or the daily sweep hands a sprayer a free
counter reset.

That sentence used to be here with nothing behind it — no test in this
repository executed `lib/loginGuard.ts` at all — and the fourth property was
false. A lock does not invalidate tickets minted before it (up to
`MAX_TICKETS` survive, for `TICKET_TTL_MS` afterwards), and
`recordLoginFailure` never asked whether a lock was already open, so a ticket
held back and spent a minute into a lock pushed `lockedUntil` another fifteen
minutes out and burned one more of the account's three hourly locks. The owner
could be kept out indefinitely by someone who never guessed the password. A
failure arriving during an open lock is now counted for the operator log and
changes nothing else: the clock does not move, no lock is spent, and no second
notice goes out.

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

### What is still distinguishable, and why that part cannot be closed here

Identical copy is not the same as an identical response, so this is stated
rather than implied.

`/api/auth/login` runs in two phases and the client calls `phase: "check"`
**before** it hands anything to Firebase. Both answers to that phase now carry
the same two keys in the same order — `{ok, ticket}` — and a refusal carries a
**decoy ticket**: a nonce of the same 32 hex characters that was never written
to any ledger, indistinguishable on the wire and worthless if replayed. A
refused check also performs the same single Firestore read and write a
permitted one does, so the two do not separate by latency at the server either.
Refusals that come from the per-IP window use the same shape, so "your traffic
was throttled" does not look different from "this account is locked".

**What remains:** `ok` is still `false`, and `false` is one byte longer than
`true`. That flag cannot go — the client has to know not to spend the attempt
at Google, and a check that always said yes would be a lockout that does
nothing. Downstream of it, `lib/auth.ts` throws without calling Firebase, so a
blocked sign-in also **returns far faster** than a real one; that timing lives
in the browser and no change to this route can hide it.

So: a locked account is indistinguishable from a wrong password **to anyone
using the login form**, and distinguishable to anyone who reads the raw
response or times the call. Those are different claims and only the first one
is true. The lockout is a throttle on our own form in front of an
authentication that happens at Google — it is not, and cannot be, a secret.

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
| `RESEND_API_KEY` + `MAIL_FROM` | No lockout email is sent; the lockout still applies and logs `no mailer is configured`. The code never claims to have sent mail it didn't — the same holds when the global notice cap or the daily email budget is what stops it, and the log names which. |
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
