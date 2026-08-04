# Email

Everything Elovox sends, how it stays inside Resend's free plan, and what has
to be done by hand before any of it works.

Code lives in `lib/email/`. Nothing outside that directory talks to Resend
directly — `lib/email/send.ts` is the one door, and it is the door because
consent, suppression, budget, unsubscribe headers, tagging and the delivery log
are not things a caller should have to remember.

---

## Setup, in order

Steps 1–3 are the ones a person has to do; nothing in the code can do them.
Until step 2 is finished, **nothing sends at all**.

### 1. API key

resend.com → **API Keys** → **Create API Key**.

Prefer **Sending access** over Full access. The only thing the app loses is the
admin console's domain-status panel (it degrades to "unknown"), and the thing it
gains is a key that cannot delete an audience if it leaks.

Set `RESEND_API_KEY` in Vercel (Production **and** Preview) and in
`.env.local`.

### 2. Domain — the step that decides whether mail arrives

resend.com → **Domains** → **Add Domain** → `elovox.app`.

Resend gives three DNS records. Add all three at the registrar:

| Record | Why it matters |
| --- | --- |
| **MX** (feedback subdomain) | Where bounce and complaint reports come back to. No MX, no bounce data. |
| **TXT — SPF** | Says Resend is allowed to send as this domain. |
| **TXT — DKIM** | Signs each message so it can't be forged in transit. |

Then add **DMARC** yourself — Resend does not generate it, and Gmail and Yahoo
have required it from bulk senders since February 2024:

```
Host:  _dmarc
Type:  TXT
Value: v=DMARC1; p=none; rua=mailto:dmarc@elovox.app
```

Start at `p=none` (monitor only, nothing is rejected). Move to `p=quarantine`
once the reports are clean for a couple of weeks.

**Use a subdomain for sending if you ever send anything promotional.** Send from
`send.elovox.app`, not `elovox.app`. Reputation is tracked per sending domain,
so a bad marketing week then costs the marketing subdomain and leaves the root
domain — the one your password-reset emails go out on — untouched. Changing
this later means re-verifying and re-warming from zero, so it is much cheaper to
decide now.

Set `MAIL_FROM` to an address on the verified domain. A display name is worth
having: `Elovox <hello@elovox.app>`.

### 3. Webhook

resend.com → **Webhooks** → **Add Endpoint**:

```
https://elovox.app/api/resend/webhook
```

Subscribe to: `email.sent`, `email.delivered`, `email.bounced`,
`email.complained`, `email.delivery_delayed`. (`opened` and `clicked` are
optional — they need Resend's open/click tracking on, which adds a tracking
pixel and rewrites links. Off by default, and worth leaving off for
transactional mail.)

Copy the signing secret into `RESEND_WEBHOOK_SECRET`.

**This is not optional in spirit.** Without it, hard bounces and spam complaints
are never recorded, the app keeps writing to dead addresses, and the sending
domain's reputation degrades until good mail starts landing in spam. The route
*refuses every request* while the secret is unset rather than accepting unsigned
ones — an unverified endpoint that writes to the suppression list would let
anyone on the internet permanently block a chosen address from receiving their
own password-reset email.

### 4. Audience (optional)

resend.com → **Audiences** → create one for the tips list → copy its id into
`RESEND_AUDIENCE_ID`.

Unset, contacts simply aren't mirrored and Broadcasts are unavailable. Every
transactional path is unaffected.

### 5. Verify

/admin → **Email** tab → **Send myself a test**. It goes down the real path —
budget reserved, suppression checked, tagged, logged — so a green result means
the real thing works, not a special case.

---

## What the free plan gives, and how the code stays inside it

| Limit | Value | Where it's handled |
| --- | --- | --- |
| Emails per month | 3,000 | `lib/email/budget.ts` |
| Emails per day | 100 | `lib/email/budget.ts` |
| API requests per second | 2 | `lib/email/client.ts` (batch + throttle) |
| Messages per batch request | 100 | `sendBatch` |
| Custom domains | 1 | — |

**The daily cap is the one that bites.** 100 a day is not "3,000 spread evenly"
— it is a hard wall that resets at midnight UTC, and the natural failure mode is
that a bulk run at 9am takes all of it and the person locked out of their
account at 3pm gets nothing.

So every send reserves against a durable counter first, and each category may
only take its share of the day:

| Category | Share of the day | Can a user switch it off? |
| --- | --- | --- |
| `security` | 100% | No |
| `billing` | 100% | No |
| `transactional` | 90% | No |
| `lifecycle` | 60% | Yes |
| `marketing` | 50% | Yes (opt-in in the first place) |

A digest run asking for 80 when only 43 of the lifecycle allowance is left sends
43 and reports 37 over budget. It does not send 80 and let Resend reject an
arbitrary subset — that would be the same people failing every week.

**The requests-per-second limit is the one people forget**, because it has
nothing to do with volume. Sending 80 emails in a loop is 80 requests and starts
returning 429 around the third. `sendBatch` puts 100 messages in one request,
which is why every bulk path goes through `sendBulk` and never through a loop.

---

## The messages

All defined in `lib/email/messages.ts`, so the whole programme can be read at
once — which is the only way to notice that somebody could get four in a day.

| Message | Category | Trigger |
| --- | --- | --- |
| Lockout notice | security | `/api/auth/login`, after repeated failures |
| Welcome | transactional | first verified load, via `/api/account/welcome` |
| Tips list confirmation | marketing | first signup on `/api/leads` |
| Premium started | billing | Stripe webhook, free → premium |
| Card declined | billing | Stripe webhook, → `past_due` |
| Premium ending | billing | Stripe webhook, cancellation scheduled |
| **Trial ending** | **billing** | **cron, 1–3 days before a trial converts** |
| Refund issued | billing | `lib/refunds.ts`, after money moves |
| Weekly progress | lifecycle | cron, Mondays |
| Streak nudge | lifecycle | cron, daily, streak ≥ 7 and nothing recorded |
| Win-back | lifecycle | cron, once ever, 3–5 weeks after last activity |
| Speaking tips 1–12 | marketing | cron, daily — one a week per subscriber |
| Operator alert | transactional | cron, daily — **only when something is wrong**, plus a weekly all-clear |

### The trial warning

The most important billing email here, and it was missing until it was
specifically looked for. Everything about the trial was already disclosed — the
pricing page says it, checkout says it again, cancelling takes a minute with no
email or phone call — but disclosure at signup is not a reminder seven days
later, when the person has forgotten and the card is charged anyway. That gap
is what makes people feel tricked by companies that did technically tell them.

Sent 1–3 days before the charge, naming the exact amount and date, with the
cancel link in it. Category `billing`, so no preference can switch it off: a
safeguard you can accidentally disable is not a safeguard. It runs FIRST in the
cron, ahead of every optional message, because it is the only one about money
about to leave somebody's account.

The window is three days rather than one because the cron fires daily — a
24-hour window would miss anyone whose trial ends between two runs, which is
precisely the failure being guarded against. `claimOnce`, keyed on the uid *and*
the trial's end date, means exactly one warning per trial.

Skipped for anyone who has already cancelled: they are not about to be charged,
and telling them otherwise would be alarming and wrong.

Billing emails fire on **transitions**, compared against the plan doc as it was
before the event. Stripe redelivers freely and sends
`customer.subscription.updated` for things as small as a card-brand refresh;
without the comparison that is several "your subscription changed" emails a
month for a subscription that did not change.

### Voice

Short, plain, no exclamation marks, no "we're excited". Two sentences where one
would do is the failure mode users already flagged about the site. American
spelling: **practice**, **practiced**, never "practise".

---

## The operator alert

The one that tells *you* when something needs you. `lib/email/opsAlert.ts`.

Everything else here is silent by design, and that is correct — but a system
that only writes its problems into a database has not reported them, it has
filed them. A failed refund, a kill switch left on, the daily send allowance
running out: all recorded correctly today, all invisible until somebody happens
to open the console on the right afternoon.

Checks, once a day, in this order:

| Check | Level |
| --- | --- |
| Unresolved `billingAlerts` (failed refunds, duplicate subs) | urgent |
| `pauseAnalyze` / `pauseCheckout` still on | urgent |
| A site banner still showing | watch |
| Any spam complaint in 24h | urgent |
| 5+ hard bounces in 24h | watch |
| Daily send allowance ≥80% (urgent at 100%) | watch/urgent |
| Month trending over 3,000 | watch |
| Sending domain not `verified` | urgent |
| `RESEND_API_KEY`/`MAIL_FROM` missing | urgent |
| No webhook secret | watch |
| Tips subscribers >2 weeks overdue | watch |

**Silent unless something is wrong** — plus a weekly all-clear on Mondays. That
all-clear is not padding: an alerting system with nothing to say is
indistinguishable from one that has died, and the day it dies is by
construction a day nobody notices. The weekly message is what makes the other
six days' silence mean something.

Each check is wrapped independently, so one failing query can't silence the
other six — a monitor that goes quiet because its own lookup threw is worse
than no monitor, because it looks like good news.

Goes to `ADMIN_EMAILS`. It reads the ops flags *fresh*, bypassing the
one-minute cache in `getOpsFlags` — that cache is right for the hot path it was
built for and wrong here, where a stale read means a paused pipeline goes
unreported for a day.

## The two lists, which never merge

There are two audiences and they agreed to different things. Mixing them is
the easiest serious mistake available in this codebase, so it is worth being
blunt about the line.

**The tips list** (`leads`) — people who left an address on the tips form,
most of whom have no account. /privacy tells them the address is used *"only
to send those tips"*. They get the twelve-email drip in `lib/email/tips.ts`
and **nothing else, ever**. Not launches, not discounts, not product news.
That sentence in the policy is a written commitment, and "we also told them
about a feature once" is a breach of it.

**Account holders** — people with an Elovox account. They get the account and
billing mail they can't switch off, and the lifecycle mail they can (weekly
progress, streak nudge, win-back). They are never added to the tips list.

`lib/email/announce.ts` and `lib/email/audience.ts` both repeat this at the
top, because those are the two files where it would be easiest to forget.

## The tips drip

Twelve tips, one a week, timed from each subscriber's own signup rather than a
shared schedule — so the cron sends a handful most days instead of the whole
list on one morning, which also keeps it well inside a hundred-a-day plan.

Position lives on the subscriber's own row (`leads/{email}.tipIndex`), and the
clock is `lastTipAt` falling back to `since`. Each run reconciles against "who
is due right now", so a missed day is picked up by the next run and a double
run sends nothing extra.

Progress advances **only for addresses Resend actually accepted**
(`result.sentTo`), never positionally — the queue gets reordered by suppression
filtering and trimmed by the budget, so counting positions would silently skip
a tip for everyone behind a suppressed subscriber.

**Adding tips**: append to `TIPS` in `lib/email/tips.ts`. Anyone partway through
carries straight on into the new ones the week they reach them. When the array
runs out the drip stops, which is a fine ending — the last tip says so.

**Never reuse an `id`**: it is half of the idempotency key.

## Consent and unsubscribe

One store, not two. Both the account-page switches and the footer link write to
`emailSuppression/{email}` — see the note at the top of `lib/email/prefs.ts`. A
preferences doc for signed-in users plus a suppression row for everyone else is
two systems that disagree the first time somebody unsubscribes from a link while
signed in on another device.

Every optional email carries `List-Unsubscribe` and `List-Unsubscribe-Post`
(RFC 8058). Both are needed together for Gmail and Outlook to render their own
Unsubscribe button, and every press of that button is a press that was not the
spam button.

The link works with **no account and no session** — a signed token proves Elovox
minted it for that address. An unsubscribe link that opens a login page is not
an unsubscribe link; the reliable next step is the spam button.

**GET does not unsubscribe.** Corporate mail scanners follow every link in every
email before a human sees it. GET renders a one-button page; POST acts. The
provider one-click flow is a POST and so costs the user no extra click.

---

## Suppression

| Reason | Blocks | Reversible by an operator? |
| --- | --- | --- |
| `hard-bounce` | everything | Yes — the mailbox may have been fixed |
| `complaint` | everything | **No** |
| `unsubscribe` | optional categories only | No — the user's own switch |
| `manual` | everything | Yes |

Soft bounces (full mailbox, temporary failure) are **not** suppressed. Those
recover, and dropping the address would punish a user for their provider's bad
afternoon.

A complaint blocks security and billing mail too. It is arguable that a
password-reset notice should be exempt — but continuing to mail somebody who
reported this domain as spam is how the domain stops being able to mail anyone,
and the user still has every in-app path to their account.

---

## Data and retention

| Collection | Holds | Retention |
| --- | --- | --- |
| `emailLog` | one row per message, **includes addresses** | 30 days, swept by `/api/cron/purge-ops` |
| `emailSuppression` | addresses + why | kept — it is the list |
| `emailBudget` | counters only, no personal data | kept indefinitely |
| `emailOnce` | uid + which one-shot was sent | kept |

`emailLog` is keyed by **Resend's own message id**, which is what makes the
webhook a plain update of an existing row rather than a second, unjoinable
stream. Without it, "which of our emails bounced?" is unanswerable.

All four are Admin-SDK only and denied to every client in `firestore.rules`.

Resend is named as a subprocessor in `lib/legal.ts`, so it appears in
`/privacy`. **Keep that in step** — adding a processor to the pipeline without
naming it makes the policy inaccurate.

---

## The promise on the tips list

`/privacy` tells the tips list their address is used *"only to send those
tips"*. That is a written commitment, and it means the Audience mirrored from
`leads` may receive tips and nothing else. It is not a general-purpose
announcement channel, and pointing product marketing at it would break it.

`lib/email/audience.ts` repeats this at the top, because that file is where it
would be easiest to forget.

---

## Cron

Two entries total, which is Vercel Hobby's ceiling:

| Path | Schedule | Does |
| --- | --- | --- |
| `/api/cron/purge-ops` | `0 4 * * *` | expires ops events, login rows, email log |
| `/api/cron/email` | `0 9 * * *` | weekly digest (Mondays), streak nudge, win-back |

`/api/cron/email` is one route with **six** jobs — trial-ending warning,
weekly digest, streak nudge, win-back, tips drip, operator alert — precisely
because more cron entries would not schedule. Add `?only=trial` (or `weekly` / `streak` /
`winback` / `tips`), with the cron credential, to exercise one by hand without
firing the others.

The trial warning runs first and unconditionally. If a day's allowance is ever
tight, that is the message that must still go out. The operator alert runs
last, so it reports on the state the other five leave behind.

The tips drip runs daily rather than weekly: the cadence is per-subscriber, so
a weekly cron would round everybody onto the same morning.

---

## What is deliberately NOT here

- **Open and click tracking.** Both need a tracking pixel and link rewriting.
  For transactional mail that is a privacy cost with no decision attached to it,
  and rewritten links are their own spam signal. The webhook accepts the events
  if tracking is ever switched on; nothing has to change in the code.
- **Broadcast-to-everyone.** Built once and removed: an announcement needs
  something to announce, and a button that mails the entire userbase is a large
  standing risk for a feature used a few times a year. `lib/email/audience.ts`
  still has the Resend Broadcast calls if it is ever wanted back.
- **Resend Broadcasts on a schedule.** `lib/email/audience.ts` can create and send one, but
  nothing calls it — the tips drip covers that list better, because it is
  per-subscriber rather than one blast to everyone at once. Kept for the case
  where a genuine one-off to the whole tips list is wanted. Note a broadcast
  spends quota on Resend's side where this app cannot see it, which is why
  `estimateAndReserve` exists.
- **A queue.** Resend's `scheduled_at` holds a message and sends it later, which
  is the same thing without the infrastructure.

---

## Troubleshooting

**Nothing sends.** /admin → Email → Setup. `configured: false` means
`RESEND_API_KEY` or `MAIL_FROM` is missing.

**Mail sends but lands in spam.** Check the domain row says `verified`, then
check DMARC exists. Then check the suppression list isn't full of bounces you
never saw — that is the webhook not being wired.

**A user says they get nothing.** /admin → Email → Suppressed. If they're on it
as `hard-bounce`, the address is wrong or dead. As `complaint`, they pressed
spam and it is not ours to undo.

**"budget" in the logs.** The day's cap for that category is gone. The admin
tab's per-category table says which. Either it is a genuinely busy day, or a
bulk run is larger than the plan supports.

**429s from Resend.** Something is sending in a loop instead of a batch. Every
bulk path must go through `sendBulk`.
