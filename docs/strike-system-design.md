# Strike / warning / ban system — design for approval

Status: **design only, not built.** It changes the data schema and touches
moderation of user content, so per the working agreement it needs your sign-off
and a few decisions (end of doc) before any code lands.

## Principle (same one the rest of the app follows)

Enforcement state is **valuable**, so it lives in an **Admin-SDK-only** doc,
exactly like `users/{uid}/usage` and `users/{uid}/score/progress`. A client can
read its own status (to see a warning) but can never write it. Nothing
client-writable ever decides whether an account is struck or banned. See the
header of `lib/leaderboardServer.ts` — this copies that pattern.

## Data model

New doc, Admin-SDK-only:

```
users/{uid}/moderation/status
  strikes: number          // weighted running total
  state: "ok" | "warned" | "suspended" | "banned"
  suspendedUntil?: number  // epoch ms; set for temporary suspensions
  updatedAt: serverTimestamp
```

Append-only audit log (never rewritten), also Admin-SDK-only:

```
moderationEvents/{autoId}
  uid, severity (1|2|3), reason, source ("audio" | "abuse" | "manual"),
  detail, dedupeKey?, at
```

`firestore.rules` — owner may read status so the UI can show a warning; nobody
writes either collection from a client:

```
match /users/{uid}/moderation/{docId} {
  allow read: if isOwner(uid);
  allow write: if false;
}
match /moderationEvents/{id} { allow read, write: if false; }
```

## Severity → strikes → state (defaults, all tunable)

| Severity | Example | Strikes | Effect |
|---|---|---|---|
| 1 minor | mild profanity in audio; repeated malformed requests | +1 | warned |
| 2 moderate | clear harassment/abuse in audio; entitlement/parameter tampering | +2 | toward suspend |
| 3 severe | threats, sexual content involving minors, injection/hacking attempts | +5 | immediate ban |

Thresholds: **warned at ≥1, suspended (7 days) at ≥3, banned at ≥5.** So a
severe offense bans in one shot; two moderate offenses suspend; minor offenses
warn first and only accumulate to a ban across repeated behavior — the "a
strike or two before a ban" you asked for.

## Where strikes come from

1. **Inappropriate audio** — the analyze pipeline already transcribes every
   recording. Add one cheap moderation classification on the transcript
   (server-side, in `/api/analyze`, after transcription). High-confidence
   severe categories only auto-strike; borderline cases are **logged for admin
   review, not auto-punished**, to keep false positives from banning real users.
2. **System abuse** — repeated server-side 403s (entitlement tampering),
   forged-attempt patterns, and malformed-request floods increment an abuse
   counter that strikes at a threshold.
3. **Injection/hacking** — `sanitizeText` already strips payloads; add detection
   of injection signatures in free-text fields as a severity-2/3 signal.
4. **Manual** — an admin strikes/bans/clears from the `/admin` panel.

## Applying a strike

`applyStrike(db, uid, {severity, reason, source, dedupeKey})` — one transaction:
read status, add weighted strikes, recompute `state`, set `suspendedUntil` if
crossing the suspend line, append a `moderationEvents` entry. Admin-SDK-only.
`dedupeKey` (e.g. the `sessionId`) makes a retried analyze idempotent so one
event never double-strikes.

## Enforcement points

`checkModeration(uid)` reads `moderation/status` and is called alongside the
existing entitlement check in the expensive/write routes (`/api/analyze`,
`/api/speech`, daily attempts, `/api/shop`):

- `banned` → 403 `{error:"account-suspended"}`, permanent.
- `suspended` and `now < suspendedUntil` → 403 with the reinstatement date.
- else proceed.

Client surfaces the warning/suspension from the readable status doc (a banner),
so a warned user knows before the next strike.

## Admin tooling

Extend `/admin` (already `ADMIN_EMAILS`-gated) with a moderation view: users in
`warned`/`suspended`/`banned`, their event log, and buttons to
strike / clear / ban / unban via a new admin-gated `/api/admin/moderation`
route. Appeals are manual review here in v1.

## Decisions I need from you before building

1. **Auto-moderate audio content?** Running a moderation classifier on every
   transcript adds a little cost + latency per analysis. Do it, or start with
   manual + abuse-signal only and add audio moderation later?
2. **What a ban blocks:** the paid pipeline only (they can still sign in, see a
   notice), or a full account lock at `RequireAuth`?
3. **Banned paying subscriber:** cancel their Stripe subscription on ban, or
   leave billing alone and handle refunds manually?
4. **Thresholds/durations:** my defaults (warn@1, suspend 7d@3, ban@5) OK?
5. **Appeals:** manual admin review for v1, or a user-facing appeal form?
6. **Which signals auto-strike vs. only log?** I lean toward auto-striking only
   high-confidence severe content and clear tampering, and logging everything
   else for review — auto-striking on rate-limit hits would punish power users.
