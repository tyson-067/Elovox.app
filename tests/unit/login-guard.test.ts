import { beforeEach, describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { makeDb, type FakeDb } from "../helpers/firestore-fake";

import {
  LOCKOUT_AFTER_FAILURES,
  LOCKOUT_MS,
  LOGIN_IP_FAILURE_LIMIT,
  LOGIN_IP_FAILURE_WINDOW_MS,
  LOGIN_IP_LIMIT,
  MAX_LOCKS_PER_WINDOW,
  checkLoginAllowed,
  clearLoginFailures,
  creditIpSuccess,
  delayForFailures,
  rateLimitIp,
  recordIpFailure,
  recordLoginFailure,
} from "@/lib/loginGuard";

/* ---------------------------------------------------------------------------
   docs/AUTH_SECURITY.md has claimed for a while that four properties of the
   login ledger are "covered by assertions rather than by hope". They were not:
   nothing in this repository executed lib/loginGuard.ts at all. This file is
   what makes that sentence true, and it pins exactly the four it names:

     1. a forged failure — one with no ticket, or a ticket nobody issued —
        moves nothing;
     2. a ticket is single-use;
     3. five real failures still lock;
     4. an open lock ends exactly when it said it would, and cannot be pushed
        further out by an attacker who kept a ticket back.

   (4) is the one that was actually broken. A lock does not invalidate tickets
   minted before it, so anyone able to hold one spare could spend it a minute
   into the lock and buy the owner another fifteen minutes of being shut out,
   plus one more of the account's three hourly locks. The docs promised the
   opposite. Now the code does what the docs say and this file checks it.

   The fifth block is newer and covers a different axis: the per-IP spray
   ceiling. LOGIN_IP_LIMIT was raised from 10 to 120 because 10 was an outage
   for a carrier NAT, and the one thing that raise genuinely loosened was
   password spraying — one attempt each against many addresses, which the
   per-account ledger cannot see because no account reaches a second failure.
   The two assertions that matter there are the two halves of the trade: a
   sprayer is stopped well inside the request ceiling, and an address whose
   users are signing in successfully is never stopped at all.

   The ledger is pure Firestore-and-a-clock — every entry point takes `now` —
   so the shared fake plus a variable is the whole harness. No timers, no
   real database, no wall clock.
   --------------------------------------------------------------------------- */

const asDb = (d: FakeDb) => d as unknown as Firestore;

const EMAIL = "someone@example.com";
/** A fixed, arbitrary epoch. Nothing here depends on the real date. */
const T0 = 1_700_000_000_000;

/** Longer than the largest progressive delay, so "wait your turn" never
 *  interferes with a test that is about something else. */
const PAST_THE_DELAY = 31_000;

let db: FakeDb;

/** An arbitrary address. Like the account row, the per-IP row is keyed by a
 *  salted hash, so it is found by collection rather than spelled out. */
const IP = "198.51.100.7";

/** The ledger's one document. Its id is a salted hash, so it is found by
 *  collection rather than spelled out — which also proves the address itself
 *  is nowhere in the key. */
function ledgerRow(): Record<string, unknown> | undefined {
  const path = [...db.data.keys()].find((p) => p.startsWith("loginAttempts/"));
  return path ? db.data.get(path) : undefined;
}

/** The one per-IP row, for the same reason `ledgerRow` exists. */
function rateRow(): Record<string, unknown> | undefined {
  const path = [...db.data.keys()].find((p) => p.startsWith("loginRates/"));
  return path ? db.data.get(path) : undefined;
}

/** One honest attempt that Firebase rejected: ask, then report the failure
 *  with the ticket that asking handed back. */
async function failOnce(at: number) {
  const gate = await checkLoginAllowed(asDb(db), EMAIL, at);
  expect(gate.allowed).toBe(true);
  return recordLoginFailure(asDb(db), EMAIL, gate.ticket ?? "", at);
}

/** Fail until the account is one attempt away from the lock, and return the
 *  clock reading after the last of them. */
async function failUpToTheBrink(): Promise<number> {
  let clock = T0;
  for (let i = 0; i < LOCKOUT_AFTER_FAILURES - 1; i++) {
    await failOnce(clock);
    clock += PAST_THE_DELAY;
  }
  return clock;
}

beforeEach(() => {
  db = makeDb();
});

describe("a forged failure moves nothing", () => {
  it("is refused outright when it carries no ticket", async () => {
    expect(await recordLoginFailure(asDb(db), EMAIL, "", T0)).toBeNull();
    // Not "no counter moved" — no document was written at all. Anyone who can
    // reach this endpoint can therefore not even prove an address has a row.
    expect(db.writes).toEqual([]);
    expect(db.data.size).toBe(0);
  });

  it("is refused when it carries a ticket nobody issued", async () => {
    expect(
      await recordLoginFailure(asDb(db), EMAIL, "f".repeat(32), T0)
    ).toBeNull();
    expect(db.data.size).toBe(0);
  });

  it("cannot push an account that is already failing over the edge", async () => {
    // The shape of the original attack: four real failures have happened, and
    // a stranger supplies the fifth to lock somebody out of their own account.
    const clock = await failUpToTheBrink();
    expect(ledgerRow()).toMatchObject({ failures: LOCKOUT_AFTER_FAILURES - 1 });

    expect(
      await recordLoginFailure(asDb(db), EMAIL, "a".repeat(32), clock)
    ).toBeNull();
    expect(ledgerRow()).toMatchObject({
      failures: LOCKOUT_AFTER_FAILURES - 1,
      lockedUntil: 0,
    });
  });
});

describe("a ticket is single-use", () => {
  it("counts the first report and refuses the replay", async () => {
    const gate = await checkLoginAllowed(asDb(db), EMAIL, T0);
    const ticket = gate.ticket ?? "";
    expect(ticket).not.toBe("");

    expect(await recordLoginFailure(asDb(db), EMAIL, ticket, T0)).toMatchObject({
      failures: 1,
    });
    // Same nonce, immediately. Without this a single `check` would fund an
    // unlimited number of failure reports and the ticket would be decoration.
    expect(await recordLoginFailure(asDb(db), EMAIL, ticket, T0 + 1)).toBeNull();
    expect(ledgerRow()).toMatchObject({ failures: 1, tickets: [] });
  });

  it("spends only the ticket that was presented", async () => {
    const first = await checkLoginAllowed(asDb(db), EMAIL, T0);
    const second = await checkLoginAllowed(asDb(db), EMAIL, T0);
    expect(first.ticket).not.toBe(second.ticket);

    await recordLoginFailure(asDb(db), EMAIL, first.ticket ?? "", T0);
    // The other tab's attempt is still fundable, which is the reason several
    // tickets may be outstanding at once.
    expect(
      await recordLoginFailure(asDb(db), EMAIL, second.ticket ?? "", T0 + 1)
    ).toMatchObject({ failures: 2 });
  });
});

describe("five real failures still lock", () => {
  it("locks on the fifth and reports the transition exactly once", async () => {
    const clock = await failUpToTheBrink();
    const outcome = await failOnce(clock);

    expect(outcome).toMatchObject({
      failures: LOCKOUT_AFTER_FAILURES,
      justLocked: true,
      lockedUntil: clock + LOCKOUT_MS,
    });
    // `justLocked` is what triggers the notice email, so it firing more than
    // once per lockout is a mail-bomb aimed at the account's owner.
    expect(ledgerRow()).toMatchObject({ locks: 1, notifiedAt: clock });
  });

  it("refuses the next check, and refuses it the same way it refuses a delay", async () => {
    const clock = await failUpToTheBrink();
    await failOnce(clock);

    const gate = await checkLoginAllowed(asDb(db), EMAIL, clock + 1_000);
    expect(gate.allowed).toBe(false);
    // No ticket comes back, so a locked account cannot fund further reports.
    expect(gate.ticket).toBeUndefined();
    expect(gate.retryAfterMs).toBe(LOCKOUT_MS - 1_000);
  });

  it("charges a refused check the same one write a permitted one costs", async () => {
    // Not tidiness: the response body for a locked account is byte-identical
    // to the one for a healthy account by design, and it would be worth
    // nothing if the two answers took visibly different amounts of time. One
    // read and one write on both paths is what keeps that true here.
    const clock = await failUpToTheBrink();
    await failOnce(clock);

    const before = db.writes.length;
    await checkLoginAllowed(asDb(db), EMAIL, clock + 1_000);
    expect(db.writes.length).toBe(before + 1);
  });

  it("lets the owner back in the moment the lock expires, with a clean slate", async () => {
    const clock = await failUpToTheBrink();
    await failOnce(clock);

    const after = clock + LOCKOUT_MS + 1;
    const gate = await checkLoginAllowed(asDb(db), EMAIL, after);
    expect(gate.allowed).toBe(true);
    // The counter resets with the lock, so the next mistyped password starts a
    // fresh climb instead of re-locking instantly.
    expect(await recordLoginFailure(asDb(db), EMAIL, gate.ticket ?? "", after))
      .toMatchObject({ failures: 1, justLocked: false, lockedUntil: 0 });
  });
});

describe("an open lock ends exactly when it said it would", () => {
  it("is not extended by a ticket held back from before it closed", async () => {
    const clock = await failUpToTheBrink();

    // Two tabs open at the brink: two live tickets, one of which the attacker
    // does not spend yet. Tickets outlive the lock they helped trigger, so
    // this is reachable by anyone, not just by a contrived test.
    const spend = await checkLoginAllowed(asDb(db), EMAIL, clock);
    const hoarded = await checkLoginAllowed(asDb(db), EMAIL, clock);

    const locked = await recordLoginFailure(
      asDb(db),
      EMAIL,
      spend.ticket ?? "",
      clock
    );
    expect(locked?.justLocked).toBe(true);
    const endsAt = locked?.lockedUntil ?? 0;

    // A minute into the lock, the hoarded ticket is spent.
    const later = clock + 60_000;
    const extra = await recordLoginFailure(
      asDb(db),
      EMAIL,
      hoarded.ticket ?? "",
      later
    );

    // The failure is COUNTED — the operator log should see someone still
    // pushing — but nothing about the lock moves.
    expect(extra).toMatchObject({
      failures: LOCKOUT_AFTER_FAILURES + 1,
      justLocked: false,
      lockedUntil: endsAt,
    });
    expect(ledgerRow()).toMatchObject({ lockedUntil: endsAt, locks: 1 });

    // And the owner is let back in on the original schedule, not a fresh
    // fifteen minutes after the attacker's last poke.
    expect((await checkLoginAllowed(asDb(db), EMAIL, endsAt + 1)).allowed).toBe(
      true
    );
  });

  it("does not let a held ticket spend one of the account's hourly locks", async () => {
    // The second half of the same bug. Re-locking burns one of
    // MAX_LOCKS_PER_WINDOW, and an attacker who could spend them from inside
    // an open lock could exhaust the budget without ever letting the owner
    // near the form — reaching the "throttling only" state by force.
    const clock = await failUpToTheBrink();
    const spend = await checkLoginAllowed(asDb(db), EMAIL, clock);
    const hoarded = await checkLoginAllowed(asDb(db), EMAIL, clock);

    await recordLoginFailure(asDb(db), EMAIL, spend.ticket ?? "", clock);
    await recordLoginFailure(asDb(db), EMAIL, hoarded.ticket ?? "", clock + 1);

    expect(ledgerRow()).toMatchObject({ locks: 1 });
    expect(Number(ledgerRow()?.locks)).toBeLessThan(MAX_LOCKS_PER_WINDOW);
  });
});

describe("the rest of the policy, so the constants can't drift unnoticed", () => {
  it("gives the first failure away free and doubles from there", async () => {
    // Typos are the common case and charging for them charges the owner.
    expect(delayForFailures(1)).toBe(0);
    expect(delayForFailures(2)).toBe(1_000);
    expect(delayForFailures(3)).toBe(2_000);
    expect(delayForFailures(30)).toBe(30_000);
  });

  it("holds an attempt inside the progressive delay without locking anything", async () => {
    await failOnce(T0);
    await failOnce(T0 + PAST_THE_DELAY);

    const tooSoon = await checkLoginAllowed(asDb(db), EMAIL, T0 + PAST_THE_DELAY + 500);
    expect(tooSoon.allowed).toBe(false);
    expect(tooSoon.ticket).toBeUndefined();
    expect(ledgerRow()).toMatchObject({ lockedUntil: 0 });
  });

  it("wipes the slate on a proven success", async () => {
    await failOnce(T0);
    expect(ledgerRow()).toBeDefined();
    await clearLoginFailures(asDb(db), EMAIL);
    expect(ledgerRow()).toBeUndefined();
  });

  it("leaves a whole shared egress address room to sign in", async () => {
    // The number that matters is LOGIN_IP_LIMIT / 2: every sign-in spends two
    // requests here, `check` and `result`. At the old ceiling of 10 that was
    // five attempts a minute for an entire carrier NAT or office — and the
    // refusal renders as "Incorrect email or password", so those users were
    // told their password was wrong when it was not.
    expect(LOGIN_IP_LIMIT / 2).toBeGreaterThanOrEqual(50);

    const ip = "203.0.113.9";
    for (let i = 0; i < LOGIN_IP_LIMIT; i++) {
      expect((await rateLimitIp(asDb(db), ip, T0 + i)).allowed).toBe(true);
    }
    // It is still a ceiling, and it is still a sliding window.
    expect((await rateLimitIp(asDb(db), ip, T0 + LOGIN_IP_LIMIT)).allowed).toBe(
      false
    );
    expect((await rateLimitIp(asDb(db), ip, T0 + 60_001)).allowed).toBe(true);
  });
});

describe("the per-IP spray ceiling", () => {
  it("stops a sprayer well inside the request ceiling", async () => {
    let clock = T0;
    for (let i = 0; i < LOGIN_IP_FAILURE_LIMIT; i++) {
      expect((await rateLimitIp(asDb(db), IP, clock)).allowed).toBe(true);
      await recordIpFailure(asDb(db), IP, clock);
      clock += 1_000;
    }
    // Thirty requests against a ceiling of 120, spread over thirty seconds, so
    // the request window is nowhere near full: this refusal can only be the
    // failure counter, which is the point of having a second one.
    expect((await rateLimitIp(asDb(db), IP, clock)).allowed).toBe(false);
  });

  it("never blocks an address whose users are actually signing in", async () => {
    // The constraint the whole design exists to satisfy. Five times the ceiling
    // in wrong passwords, each one followed by somebody behind the same address
    // getting in for real — which is what a carrier NAT or an office looks like
    // — and the address is never throttled, because what is counted is failures
    // MINUS proven successes.
    let clock = T0;
    for (let i = 0; i < LOGIN_IP_FAILURE_LIMIT * 5; i++) {
      expect((await rateLimitIp(asDb(db), IP, clock)).allowed).toBe(true);
      await recordIpFailure(asDb(db), IP, clock);
      await creditIpSuccess(asDb(db), IP, clock);
      clock += 1_000;
    }
    expect((await rateLimitIp(asDb(db), IP, clock)).allowed).toBe(true);
    expect(rateRow()?.fails).toEqual([]);
  });

  it("forgives one failure per success and never banks credit", async () => {
    await recordIpFailure(asDb(db), IP, T0);
    await recordIpFailure(asDb(db), IP, T0 + 1);

    // The OLDEST failure goes, so what is left is still a true sliding window.
    await creditIpSuccess(asDb(db), IP, T0 + 2);
    expect(rateRow()?.fails).toEqual([T0 + 1]);

    // Two more successes against nothing buy nothing: a quiet hour cannot be
    // banked and then spent on a burst of guesses.
    await creditIpSuccess(asDb(db), IP, T0 + 3);
    await creditIpSuccess(asDb(db), IP, T0 + 4);
    expect(rateRow()?.fails).toEqual([]);
    await recordIpFailure(asDb(db), IP, T0 + 5);
    expect(rateRow()?.fails).toEqual([T0 + 5]);
  });

  it("lets the window slide rather than clearing on the hour", async () => {
    for (let i = 0; i < LOGIN_IP_FAILURE_LIMIT; i++) {
      await recordIpFailure(asDb(db), IP, T0 + i);
    }
    expect(
      (await rateLimitIp(asDb(db), IP, T0 + LOGIN_IP_FAILURE_LIMIT)).allowed
    ).toBe(false);

    // One failure ages out, one attempt gets through, and spending it closes
    // the door again. A sprayer waiting out the window gets a drip, not a
    // refilled allowance.
    const slot = T0 + LOGIN_IP_FAILURE_WINDOW_MS;
    expect((await rateLimitIp(asDb(db), IP, slot)).allowed).toBe(true);
    await recordIpFailure(asDb(db), IP, slot);
    expect((await rateLimitIp(asDb(db), IP, slot)).allowed).toBe(false);
  });

  it("stops growing the row once the ceiling is reached", async () => {
    // An array that grows with an attacker's patience is a write-amplification
    // bug; past the ceiling every request is refused anyway.
    for (let i = 0; i < LOGIN_IP_FAILURE_LIMIT * 3; i++) {
      await recordIpFailure(asDb(db), IP, T0 + i);
    }
    expect((rateRow()?.fails as number[]).length).toBe(LOGIN_IP_FAILURE_LIMIT);
  });

  it("keeps the row alive longer than the failures in it", async () => {
    // purgeExpiredLoginRows (and any Firestore TTL policy) deletes on
    // `expiresAt`. When that was ten request windows — ten minutes — a row
    // whose failure history had fifty minutes left to run would have been
    // swept, handing a sprayer a free counter reset.
    await recordIpFailure(asDb(db), IP, T0);
    expect((rateRow()?.expiresAt as Date).getTime()).toBeGreaterThanOrEqual(
      T0 + LOGIN_IP_FAILURE_WINDOW_MS
    );
    await rateLimitIp(asDb(db), IP, T0 + 1);
    expect((rateRow()?.expiresAt as Date).getTime()).toBeGreaterThanOrEqual(
      T0 + LOGIN_IP_FAILURE_WINDOW_MS
    );
  });

  it("refuses both ceilings with the same answer", async () => {
    // A caller able to tell "your traffic was throttled" from "you have been
    // guessing wrong" would learn which of its guesses were wrong.
    const throttled = "203.0.113.11";
    for (let i = 0; i < LOGIN_IP_LIMIT; i++) {
      await rateLimitIp(asDb(db), throttled, T0 + i);
    }
    const byRequests = await rateLimitIp(asDb(db), throttled, T0 + LOGIN_IP_LIMIT);
    for (let i = 0; i < LOGIN_IP_FAILURE_LIMIT; i++) {
      await recordIpFailure(asDb(db), IP, T0 + i);
    }
    const bySpray = await rateLimitIp(asDb(db), IP, T0 + LOGIN_IP_FAILURE_LIMIT);

    expect(byRequests.allowed).toBe(false);
    expect(bySpray.allowed).toBe(false);
    expect(Object.keys(bySpray)).toEqual(Object.keys(byRequests));
  });

  it("is tighter than the request limit it replaces, in accounts per hour", async () => {
    // Spraying spends exactly one failure per address, so the ceiling IS
    // distinct accounts per hour from one address. Two requests buy one
    // sign-in attempt, so a request limit converts at limit / 2 * 60.
    const accountsPerHour = (requestsPerMinute: number) =>
      (requestsPerMinute / 2) * 60;
    expect(accountsPerHour(10)).toBe(300);
    expect(accountsPerHour(LOGIN_IP_LIMIT)).toBe(3600);
    // Ten times tighter than the old limit of 10, and 120x tighter than the
    // raised one. If this assertion ever fails, the raise gave spraying back
    // the ground this ceiling was added to take.
    expect(LOGIN_IP_FAILURE_LIMIT).toBeLessThanOrEqual(accountsPerHour(10) / 10);
  });
});
