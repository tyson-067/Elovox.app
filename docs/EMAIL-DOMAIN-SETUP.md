# Setting up @elovox.app addresses

One-time, done by a person. `docs/EMAIL.md` explains what the app sends and
why; this file is the checklist for making `something@elovox.app` exist at all.

Two independent halves, and conflating them is the usual way this goes wrong:

| | Who does it | Result |
| --- | --- | --- |
| **Sending** *as* `support@elovox.app` | Resend | Mail leaves with a From gmail will trust |
| **Receiving** *at* `support@` / `privacy@` / `security@` | Porkbun forwarding | Replies land in your Gmail |

Resend never gives you an inbox. Porkbun never sends on the app's behalf. You
need both, and they do not conflict — see the MX note in step 2.

DNS for `elovox.app` is at **Porkbun** (`*.ns.porkbun.com`), so every record
below goes in Porkbun → Domain Management → `elovox.app` → **DNS**.

---

## The address scheme

Verified sending domains cost money past the first one (`FREE_PLAN.domains = 1`
in `lib/email/config.ts`), so every address lives on the root `elovox.app`.
That's one Resend domain and as many local-parts as you like:

| Address | Used for | Direction |
| --- | --- | --- |
| `support@elovox.app` | `MAIL_FROM` — every email the app sends | out |
| `support@elovox.app` | the general contact address: footer, `/terms`, `/refunds`, `/accessibility`, `/ai`, `/dmca`, `/legal`, the in-app Support row, `LICENSE` | in → forwards to Gmail |
| `privacy@elovox.app` | data-rights requests: `/privacy`, `/biometrics`, `/children` | in → forwards to Gmail |
| `security@elovox.app` | `/.well-known/security.txt` — vulnerability reports | in → forwards to Gmail |

The split is three addresses and not one because `privacy@` and `security@`
each carry a clock. A GDPR erasure, a BIPA request and a COPPA parent request
are all answerable within a statutory window that starts the moment the mail
arrives; a researcher's disclosure timeline starts the same way. One filtered
address per clock is the cheapest possible record of when something landed.
Everything else is `support@`.

Live in `lib/legal.ts` as `LEGAL.emails.{support,privacy,security}` — the
single place any of them is written down.

Deliberately *not* using `noreply@`: `lib/email/config.ts` documents why a
no-reply From is a self-inflicted deliverability wound, and `support@` is a
mailbox a person actually reads.

---

## 1. Resend: verify the domain

resend.com → **Domains** → **Add Domain** → `elovox.app` (region `us-east-1`).

Resend prints three records. **Copy them from the dashboard verbatim** — the
DKIM public key is unique to your domain and the MX hostname carries the
region, so neither can be transcribed from a doc. They take this shape:

| Type | Host | Value |
| --- | --- | --- |
| MX (priority 10) | `send` | `feedback-smtp.us-east-1.amazonses.com` |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey` | `p=MIGfMA0GCSq...` (unique) |

> **Why this doesn't break your inbox:** Resend puts its MX on the `send`
> subdomain, not the root. `send.elovox.app` handles bounce and complaint
> feedback; the root MX stays free for Porkbun's forwarding in step 3. This is
> the whole reason sending and receiving can share one domain.

Porkbun strips the domain suffix automatically — enter `send`, not
`send.elovox.app`. Verification is usually minutes, occasionally an hour.

## 2. DMARC — add this yourself

Resend does not generate it, and Gmail and Yahoo have required it from bulk
senders since February 2024.

| Type | Host | Value |
| --- | --- | --- |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<an address you read>` |

**Already done** — the live record sends reports to a personal Gmail, which is
deliberately *not* one of the three addresses above. `rua` reports are
machine-generated XML, one per receiving provider per day; routing that volume
into `support@` would bury the mail a human needs to answer. Keeping it on a
personal address (or swapping in a free aggregator — dmarcian, Postmark's
DMARC Digests) is the better arrangement, and is why the scheme is three
addresses and not four.

`p=none` is monitor-only — nothing gets rejected while you watch the reports.
Move to `p=quarantine` after a couple of clean weeks.

## 3. Porkbun: forward the inbound mail

Porkbun → `elovox.app` → **Email** → **Email Forwarding**. Free.

```
support@elovox.app    →  elovox.app@gmail.com
privacy@elovox.app    →  elovox.app@gmail.com
security@elovox.app   →  elovox.app@gmail.com
```

Porkbun adds the root MX records itself when you enable this. Do not add them
by hand, and do not point the root MX anywhere else — forwarding and a real
mailbox provider cannot both own the root MX.

Consider adding a catch-all (`*@elovox.app → elovox.app@gmail.com`) in the
same panel, so a typo or an address printed somewhere later still reaches you
instead of bouncing.

**Verify before continuing.** Send yourself a mail at each of the three
addresses from any account and confirm all three land. Step 6 publishes them
across fourteen legal pages; publishing a dead address is worse than the
gmail.com one it replaces.

## 4. Replying *as* the new addresses from Gmail

Forwarding only carries mail inward — a plain Gmail reply goes out as
`elovox.app@gmail.com` and undoes the point. Add an alias, once per address
you intend to reply from (`support@` at minimum; `privacy@` too, since a data
request should be *answered* from the address it was sent to):

Gmail → Settings → **Accounts and Import** → *Send mail as* → **Add another
email address**:

```
Name:      Elovox
Address:   support@elovox.app
Treat as an alias:  no
SMTP:      smtp.resend.com
Port:      587   (TLS)
Username:  resend
Password:  <your RESEND_API_KEY>
```

Gmail mails a confirmation code to the address, which forwarding delivers
back to you. Set it as the default reply address for that thread. Repeat for
`privacy@elovox.app`.

> **Gotcha worth knowing:** mail sent this way goes through the same Resend
> account and counts against the same 100/day and 3000/month free-tier caps —
> but it bypasses `lib/email/budget.ts` entirely, so the app's own accounting
> won't see it. Heavy hand-replying can quietly starve the transactional
> budget. The admin console's email panel shows the real usage.

## 5. Environment variables

Set in **Vercel → Settings → Environment Variables** (Production *and*
Preview) and in `.env.local`:

```
RESEND_API_KEY=re_...              # Sending access is enough; see docs/EMAIL.md
MAIL_FROM=Elovox <support@elovox.app>
MAIL_REPLY_TO=support@elovox.app
EMAIL_TOKEN_SECRET=<long random string>
```

Then the webhook, which is not optional in practice — without it bounces and
spam complaints are never recorded and the app keeps mailing dead addresses:

resend.com → **Webhooks** → **Add Endpoint** →
`https://elovox.app/api/resend/webhook` → copy the signing secret:

```
RESEND_WEBHOOK_SECRET=whsec_...
```

Redeploy. `isMailConfigured()` flips true once `RESEND_API_KEY` and
`MAIL_FROM` are both present; until then every send path degrades quietly and
says so in the log.

## 6. Point the app at the new address

Once step 3 is verified working, in `lib/legal.ts`:

```diff
-  contactEmail: "elovox.app@gmail.com",
+  emails: {
+    support: "support@elovox.app",
+    privacy: "privacy@elovox.app",
+    security: "security@elovox.app",
+  },
```

That block updates all fourteen legal pages, the site footer, the in-app
Support row, the footer of every email the app sends, and the default
`Reply-To`. Two files cannot import it and carry their address literally —
`public/.well-known/security.txt` (`security@`) and `LICENSE` (`support@`);
both must be edited by hand and both already have been.

---

## Verifying it worked

1. Admin console → email panel: the domain row must read **`verified`**. A
   sending-only API key shows `unknown` here — that's expected, not a fault.
2. Trigger a real send (a login lockout, or the admin console's test send) and
   confirm it arrives in a Gmail inbox, not spam.
3. In Gmail, **Show original** on the received message: `SPF: PASS`,
   `DKIM: PASS`, `DMARC: PASS`.
4. Reply to it and confirm the reply reaches `elovox.app@gmail.com`.
5. `curl https://elovox.app/.well-known/security.txt` and confirm the `Contact:`
   line names `security@elovox.app`, then send a mail there and watch it land.
   An RFC 9116 file naming a dead address is worse than having no file.

A domain that falls out of verification does not throw errors — it just starts
landing in spam. The admin panel is the only place that shows this, which is
why `listDomains()` exists in `lib/email/client.ts`.
