"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  adminGet,
  adminSend,
  adminDownload,
  fmtDate,
  fmtDateTime,
  fmtMoney,
} from "@/lib/adminClient";
import { ActionMsg, TwoStepButton } from "@/components/AdminBits";

// The per-account panel behind a row click on the Users tab: operational
// detail up top, operator actions below. Everything it shows is account and
// operational METADATA — no transcripts, no reports, no per-session scores;
// see the header of /api/admin/user for the line and why it's there.
//
// Action safety, in order of teeth:
//   - every mutation is a TwoStepButton (arm, then confirm) — no browser
//     dialogs, nothing fires on a stray click;
//   - deletion additionally requires TYPING the account's email, and the
//     server re-checks the match against the live auth record;
//   - accounts on ADMIN_EMAILS are refused disable/delete server-side.
// Every action lands in the audit log with the operator's identity.

interface Detail {
  generatedAt: number;
  account: {
    uid: string;
    name: string | null;
    email: string | null;
    verified: boolean;
    disabled: boolean;
    createdAt: number | null;
    lastSignInAt: number | null;
    providers: string[];
  };
  plan: {
    plan: string;
    status: string | null;
    cycle: string | null;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
    premiumUntil: number | null;
    grantReason: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  };
  progress:
    | {
        exists: true;
        xp: number;
        level: number;
        coins: number | null;
        streakDays: number;
        longestStreak: number;
        challengesCompleted: number;
      }
    | { exists: false };
  sessions: { count: number; countCapped: boolean; lastAt: number | null };
  usageToday: { date: string; dailyAnalyses: number; premiumAnalyses: number };
  leaderboard: { handle: string | null };
  moderation: {
    strikes: number;
    state: "ok" | "warned" | "suspended" | "banned";
    suspendedUntil: number | null;
    events: {
      kind: string;
      severity: number | null;
      reason: string | null;
      source: string | null;
      actor: string | null;
      stateAfter: string | null;
      at: number;
    }[];
  };
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-primary/5 py-1.5 last:border-0">
      <span className="shrink-0 text-label text-on-surface-variant">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="text-kicker uppercase text-on-surface-variant">
        {title}
      </h3>
      <div className="card mt-2 px-4 py-2">{children}</div>
    </div>
  );
}

export function AdminUserDrawer({
  uid,
  onClose,
  onChanged,
}: {
  uid: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [compDays, setCompDays] = useState("7");
  const [coinDelta, setCoinDelta] = useState("100");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [strikeSeverity, setStrikeSeverity] = useState<"1" | "2" | "3">("1");
  const [strikeReason, setStrikeReason] = useState("");
  const [deleted, setDeleted] = useState(false);

  // Refresh by bumping a nonce (the usePlanRecord idiom in lib/plan.ts).
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await adminGet<Detail>(
        `/api/admin/user?uid=${encodeURIComponent(uid)}`
      );
      if (cancelled) return;
      if (res.ok && res.data) {
        setDetail(res.data);
        setError(false);
      } else {
        setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, nonce]);

  // Escape closes, and the page behind doesn't scroll while the drawer is up.
  //
  // Focus is moved IN on open and put back where it came from on close, and
  // Tab is kept inside for as long as the drawer is up. `aria-modal="true"`
  // below already hides the rest of the page from a screen reader — but it
  // does nothing to the tab order, so without this a keyboard user tabbed
  // straight out of the dialog and into a page their reader had been told
  // was not there, with no way back except Escape. The two have to agree.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // The panel itself, not its first control: opening a dialog on the close
    // button reads as "you probably want to leave", and the heading is what
    // the user actually wants announced.
    panel?.focus();

    const focusable = () =>
      [
        ...(panel?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        ) ?? []),
      ].filter((el) => el.offsetParent !== null);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        e.preventDefault();
        panel?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (active && panel && !panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      // Back to the row that opened it, so a keyboard user does not restart
      // at the top of the user table after every drawer.
      opener?.focus?.();
    };
  }, [onClose]);

  /** Run one mutation: label the busy state, surface the outcome, refetch.
   *  A callback can return `message` to override the generic okText — the
   *  refund-needs-attention and login-locked outcomes must not be flattened
   *  into "done". */
  const act = async (
    id: string,
    fn: () => Promise<{ ok: boolean; error: string | null; message?: string }>,
    okText: string
  ) => {
    setBusy(id);
    setMsg(null);
    const res = await fn();
    setBusy(null);
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? okText });
      reload();
      onChanged();
    } else {
      setMsg({ ok: false, text: res.error ?? "That didn't work. Try again." });
    }
  };

  const a = detail?.account;
  const now = detail?.generatedAt ?? 0;
  const hasComp =
    typeof detail?.plan.premiumUntil === "number" &&
    detail.plan.premiumUntil > now;
  const isPaidPlan = detail?.plan.plan === "premium";
  const subId = detail?.plan.stripeSubscriptionId ?? null;
  const subLive =
    !!subId && detail?.plan.status !== "canceled" && detail?.plan.status !== null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
      />
      {/* role/aria-modal live on the PANEL, not on the full-screen wrapper:
          the wrapper also contains the backdrop button, and a dialog that
          claims its own dismiss-target as content is a dialog whose bounds
          nothing agrees on. `aria-labelledby` gives it the name it had none
          of. h-dvh rather than h-full so the scrollable panel ends where the
          screen does on a phone rather than under the browser chrome. */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute right-0 top-0 h-dvh w-full max-w-md overflow-y-auto bg-surface p-5 shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate font-headline text-xl font-bold">
              {a?.name ?? a?.email ?? uid}
            </h2>
            <p className="truncate text-sm text-on-surface-variant">
              {a?.email ?? "no email"} ·{" "}
              <span className="font-data text-caption">{uid}</span>
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {detail &&
                (isPaidPlan || hasComp ? (
                  <span className="rounded-full border border-violet/40 px-2 py-0.5 text-micro font-semibold text-violet">
                    Premium
                  </span>
                ) : (
                  <span className="rounded-full border border-primary/20 px-2 py-0.5 text-micro font-semibold text-on-surface-variant">
                    Free
                  </span>
                ))}
              {a && !a.verified && (
                <span className="rounded-full border border-primary/20 px-2 py-0.5 text-micro font-semibold text-on-surface-variant">
                  Unverified
                </span>
              )}
              {a?.disabled && (
                <span className="rounded-full border border-accent-strong/40 px-2 py-0.5 text-micro font-semibold text-accent-strong">
                  Disabled
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="pill rounded-full border border-primary/20 px-3 py-1 text-label font-semibold text-primary"
          >
            Close
          </button>
        </div>

        {deleted ? (
          <p className="mt-8 text-sm text-on-surface-variant">
            Account deleted. This panel is now history — close it.
          </p>
        ) : error ? (
          <p className="mt-8 text-sm text-on-surface-variant">
            Couldn&apos;t load this account. Close and try again.
          </p>
        ) : !detail ? (
          <p className="mt-8 text-sm text-on-surface-variant">Loading…</p>
        ) : (
          <>
            <Group title="Account">
              <Row label="Joined" value={fmtDate(detail.account.createdAt)} />
              <Row
                label="Last sign-in"
                value={fmtDate(detail.account.lastSignInAt)}
              />
              <Row
                label="Sign-in via"
                value={detail.account.providers.join(", ") || "—"}
              />
              <Row
                label="Practice sessions"
                value={
                  detail.sessions.countCapped
                    ? `${detail.sessions.count}+`
                    : detail.sessions.count
                }
              />
              <Row
                label="Last practiced"
                value={fmtDate(detail.sessions.lastAt)}
              />
              <Row
                label="Leaderboard handle"
                value={detail.leaderboard.handle ?? "—"}
              />
            </Group>

            <Group title="Plan">
              <Row label="Plan" value={isPaidPlan ? "Premium (Stripe)" : hasComp ? "Premium (comp)" : "Free"} />
              {detail.plan.status && (
                <Row
                  label="Status"
                  value={`${detail.plan.status}${detail.plan.cycle ? ` · ${detail.plan.cycle}` : ""}${detail.plan.cancelAtPeriodEnd ? " · canceling" : ""}`}
                />
              )}
              {detail.plan.currentPeriodEnd && (
                <Row
                  label="Period ends"
                  value={fmtDate(detail.plan.currentPeriodEnd)}
                />
              )}
              {hasComp && (
                <Row
                  label="Comp until"
                  value={`${fmtDate(detail.plan.premiumUntil)}${detail.plan.grantReason === "admin-comp" ? " (operator)" : " (streak)"}`}
                />
              )}
              {detail.plan.stripeCustomerId && (
                <Row
                  label="Stripe"
                  value={
                    <a
                      className="underline decoration-primary/30 underline-offset-2"
                      href={`https://dashboard.stripe.com/customers/${detail.plan.stripeCustomerId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {detail.plan.stripeCustomerId}
                    </a>
                  }
                />
              )}
            </Group>

            <Group title="Progress">
              {detail.progress.exists ? (
                <>
                  <Row
                    label="Level / XP"
                    value={`L${detail.progress.level} · ${detail.progress.xp} XP`}
                  />
                  <Row label="Coins" value={detail.progress.coins ?? "—"} />
                  <Row
                    label="Streak"
                    value={`${detail.progress.streakDays} days (best ${detail.progress.longestStreak})`}
                  />
                  <Row
                    label="Dailies completed"
                    value={detail.progress.challengesCompleted}
                  />
                </>
              ) : (
                <p className="py-1.5 text-sm text-on-surface-variant">
                  No scored sessions yet.
                </p>
              )}
            </Group>

            <Group title={`Usage · ${detail.usageToday.date}`}>
              <Row
                label="Daily attempts"
                value={`${detail.usageToday.dailyAnalyses} of 3`}
              />
              <Row
                label="Premium analyses"
                value={detail.usageToday.premiumAnalyses}
              />
            </Group>

            <h3 className="mt-7 text-kicker uppercase text-on-surface-variant">
              Actions
            </h3>
            <ActionMsg msg={msg} />

            {/* --- Support ------------------------------------------------ */}
            <div className="card mt-2 p-4">
              <p className="text-sm font-semibold">Support</p>
              {!isPaidPlan && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="text-sm text-on-surface-variant" htmlFor="comp-days">
                    Comp days
                  </label>
                  <input
                    id="comp-days"
                    type="number"
                    min={1}
                    max={90}
                    value={compDays}
                    onChange={(e) => setCompDays(e.target.value)}
                    className="card input-glow w-20 px-2 py-1 text-sm focus:outline-none"
                  />
                  <TwoStepButton
                    label={hasComp ? "Extend comp" : "Grant comp"}
                    confirmLabel={`Comp ${compDays || "?"} days?`}
                    busy={busy === "comp"}
                    disabled={
                      !Number.isInteger(Number(compDays)) ||
                      Number(compDays) < 1 ||
                      Number(compDays) > 90
                    }
                    onConfirm={() =>
                      act(
                        "comp",
                        () =>
                          adminSend("/api/admin/comp", "POST", {
                            uid,
                            days: Number(compDays),
                          }),
                        `Comped ${compDays} days.`
                      )
                    }
                  />
                  {hasComp && (
                    <TwoStepButton
                      label="Revoke comp"
                      confirmLabel="End the comp now?"
                      danger
                      busy={busy === "comp-revoke"}
                      onConfirm={() =>
                        act(
                          "comp-revoke",
                          () => adminSend("/api/admin/comp", "DELETE", { uid }),
                          "Comp revoked."
                        )
                      }
                    />
                  )}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="text-sm text-on-surface-variant" htmlFor="coin-delta">
                  Coins ±
                </label>
                <input
                  id="coin-delta"
                  type="number"
                  step={1}
                  value={coinDelta}
                  onChange={(e) => setCoinDelta(e.target.value)}
                  className="card input-glow w-24 px-2 py-1 text-sm focus:outline-none"
                />
                <TwoStepButton
                  label="Adjust coins"
                  confirmLabel={`Apply ${coinDelta || "?"}?`}
                  busy={busy === "coins"}
                  disabled={
                    !detail.progress.exists ||
                    !Number.isInteger(Number(coinDelta)) ||
                    Number(coinDelta) === 0
                  }
                  onConfirm={() =>
                    act(
                      "coins",
                      () =>
                        adminSend("/api/admin/coins", "POST", {
                          uid,
                          delta: Number(coinDelta),
                        }),
                      "Coins adjusted."
                    )
                  }
                />
              </div>
              {!detail.progress.exists && (
                <p className="mt-1 text-caption text-on-surface-variant">
                  Coins need a scored session first.
                </p>
              )}
              <div className="mt-3">
                <TwoStepButton
                  label="Reset today's attempts"
                  confirmLabel="Hand today's attempts back?"
                  busy={busy === "usage"}
                  onConfirm={() =>
                    act(
                      "usage",
                      () => adminSend("/api/admin/usage", "POST", { uid }),
                      "Today's meter reset."
                    )
                  }
                />
              </div>
            </div>

            {/* --- Billing ------------------------------------------------ */}
            {subId && (
              <div className="card mt-3 p-4">
                <p className="text-sm font-semibold">Billing</p>
                <p className="mt-1 text-caption text-on-surface-variant">
                  Acts on the Stripe subscription; the plan here syncs via the
                  webhook a few moments later. Money back always goes to the
                  card.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {subLive && !detail.plan.cancelAtPeriodEnd && (
                    <TwoStepButton
                      label="Cancel at period end"
                      confirmLabel="Stop the next charge?"
                      busy={busy === "sub-cancel"}
                      onConfirm={() =>
                        act(
                          "sub-cancel",
                          () =>
                            adminSend("/api/admin/subscription", "POST", {
                              uid,
                              action: "cancel_at_period_end",
                            }),
                          "Will cancel at period end."
                        )
                      }
                    />
                  )}
                  {subLive && detail.plan.cancelAtPeriodEnd && (
                    <TwoStepButton
                      label="Resume subscription"
                      confirmLabel="Keep it running?"
                      busy={busy === "sub-resume"}
                      onConfirm={() =>
                        act(
                          "sub-resume",
                          () =>
                            adminSend("/api/admin/subscription", "POST", {
                              uid,
                              action: "resume",
                            }),
                          "Cancellation undone."
                        )
                      }
                    />
                  )}
                  {subLive && (
                    <TwoStepButton
                      label="Cancel now + refund unused"
                      confirmLabel="End access today, refund the rest?"
                      danger
                      busy={busy === "sub-now"}
                      onConfirm={() =>
                        act(
                          "sub-now",
                          async () => {
                            const res = await adminSend<{
                              refund: { amount: number | null; currency: string | null; resolved: boolean; error: string | null } | null;
                            }>("/api/admin/subscription", "POST", {
                              uid,
                              action: "cancel_now_refund",
                            });
                            const r = res.data?.refund;
                            return {
                              ...res,
                              message:
                                res.ok && res.data
                                  ? r
                                    ? r.resolved
                                      ? `Canceled. Refunded ${fmtMoney(r.amount, r.currency)} to the card.`
                                      : "Canceled, but the refund needs attention — see the Billing tab."
                                    : "Canceled. Nothing unused to refund."
                                  : undefined,
                            };
                          },
                          "Canceled."
                        )
                      }
                    />
                  )}
                </div>
              </div>
            )}

            {/* --- Moderation --------------------------------------------- */}
            <div className="card mt-3 p-4">
              <p className="text-sm font-semibold">Moderation</p>
              <p className="mt-1 text-caption text-on-surface-variant">
                Yours are conduct only — reports, abuse, an offensive public
                name. Swearing (+1) and slurs (+2) in a recording are struck
                automatically by the analyze pipeline, marked &ldquo;auto&rdquo;
                below; mild words are masked in the transcript and never
                struck. Warn at 1 strike, 7-day suspension at 3, ban (login
                locked) at 5. Severity adds 1 / 2 / 5. Every strike needs a
                written reason and lands in the audit log. Billing is never
                touched here.
              </p>
              <p className="mt-2 text-sm">
                {detail.moderation.state === "ok" ? (
                  <span className="text-on-surface-variant">
                    Clean record.
                  </span>
                ) : (
                  <span className="font-semibold">
                    {detail.moderation.state === "suspended"
                      ? `Suspended until ${fmtDate(detail.moderation.suspendedUntil)}`
                      : detail.moderation.state === "banned"
                        ? "Banned"
                        : "Warned"}{" "}
                    · {detail.moderation.strikes} strike
                    {detail.moderation.strikes === 1 ? "" : "s"}
                  </span>
                )}
              </p>
              {detail.moderation.state !== "banned" && (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label
                      className="text-sm text-on-surface-variant"
                      htmlFor="strike-sev"
                    >
                      Severity
                    </label>
                    <select
                      id="strike-sev"
                      value={strikeSeverity}
                      onChange={(e) =>
                        setStrikeSeverity(e.target.value as "1" | "2" | "3")
                      }
                      className="card input-glow px-2 py-1.5 text-sm focus:outline-none"
                    >
                      <option value="1">1 · minor (+1)</option>
                      <option value="2">2 · moderate (+2)</option>
                      <option value="3">3 · severe (+5)</option>
                    </select>
                  </div>
                  <input
                    type="text"
                    maxLength={300}
                    value={strikeReason}
                    onChange={(e) => setStrikeReason(e.target.value)}
                    placeholder="Reason, for the record (required)"
                    aria-label="Strike reason"
                    className="card input-glow mt-2 w-full px-3 py-1.5 text-sm focus:outline-none"
                  />
                  <div className="mt-2">
                    <TwoStepButton
                      label="Apply strike"
                      confirmLabel={`Strike severity ${strikeSeverity}?`}
                      danger
                      busy={busy === "strike"}
                      disabled={strikeReason.trim().length < 3}
                      onConfirm={() =>
                        act(
                          "strike",
                          async () => {
                            const res = await adminSend<{
                              state: string;
                              strikes: number;
                              lockedLogin: boolean;
                              hasLiveSubscription: boolean;
                            }>("/api/admin/moderation", "POST", {
                              uid,
                              action: "strike",
                              severity: Number(strikeSeverity),
                              reason: strikeReason.trim(),
                            });
                            if (res.ok && res.data) setStrikeReason("");
                            return {
                              ...res,
                              message:
                                res.ok && res.data
                                  ? `Now ${res.data.state} (${res.data.strikes} strikes).${res.data.lockedLogin ? " Login locked." : ""}${res.data.hasLiveSubscription ? " They have a live subscription — settle billing from the Billing controls." : ""}`
                                  : undefined,
                            };
                          },
                          "Strike applied."
                        )
                      }
                    />
                  </div>
                </>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {detail.moderation.state === "suspended" && (
                  <TwoStepButton
                    label="Lift suspension"
                    confirmLabel="End it early? Strikes stand."
                    busy={busy === "lift"}
                    onConfirm={() =>
                      act(
                        "lift",
                        () =>
                          adminSend("/api/admin/moderation", "POST", {
                            uid,
                            action: "lift",
                          }),
                        "Suspension lifted — account is warned."
                      )
                    }
                  />
                )}
                {detail.moderation.state !== "ok" && (
                  <TwoStepButton
                    label="Reinstate"
                    confirmLabel="Wipe strikes, unlock login?"
                    busy={busy === "reinstate"}
                    onConfirm={() =>
                      act(
                        "reinstate",
                        () =>
                          adminSend("/api/admin/moderation", "POST", {
                            uid,
                            action: "reinstate",
                          }),
                        "Reinstated with a clean record."
                      )
                    }
                  />
                )}
              </div>
              {/* The record behind the number: who struck, why, and what it
                  left them in. Without this an automated strike is a count
                  with no story, and the first thing an appeal needs is the
                  story. */}
              {detail.moderation.events.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5 border-t border-primary/5 pt-2">
                  {detail.moderation.events.map((e, i) => (
                    <li key={i} className="text-caption text-on-surface-variant">
                      <span className="font-medium text-on-surface">
                        {e.kind === "strike"
                          ? `Strike ${e.severity ?? "?"}`
                          : e.kind === "lift"
                            ? "Suspension lifted"
                            : "Reinstated"}
                      </span>{" "}
                      · {e.source === "audio" ? "auto" : (e.actor ?? "—")} ·{" "}
                      {fmtDateTime(e.at)}
                      {e.stateAfter ? ` · → ${e.stateAfter}` : ""}
                      {e.reason ? <span className="block">{e.reason}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* --- Access ------------------------------------------------- */}
            <div className="card mt-3 p-4">
              <p className="text-sm font-semibold">Access</p>
              <p className="mt-1 text-caption text-on-surface-variant">
                Suspension per the Terms (&quot;we may suspend or end your
                access&quot;). Sign-in stops immediately; API access dies with
                the token, within the hour. Reversible.
              </p>
              <div className="mt-2">
                {detail.account.disabled ? (
                  <TwoStepButton
                    label="Enable account"
                    confirmLabel="Let them back in?"
                    busy={busy === "enable"}
                    onConfirm={() =>
                      act(
                        "enable",
                        () =>
                          adminSend("/api/admin/account", "POST", {
                            uid,
                            action: "enable",
                          }),
                        "Account enabled."
                      )
                    }
                  />
                ) : (
                  <TwoStepButton
                    label="Disable account"
                    confirmLabel="Suspend sign-in?"
                    danger
                    busy={busy === "disable"}
                    onConfirm={() =>
                      act(
                        "disable",
                        () =>
                          adminSend("/api/admin/account", "POST", {
                            uid,
                            action: "disable",
                          }),
                        "Account disabled."
                      )
                    }
                  />
                )}
              </div>
            </div>

            {/* --- Data --------------------------------------------------- */}
            <div className="card mt-3 p-4">
              <p className="text-sm font-semibold">Data</p>
              <p className="mt-1 text-caption text-on-surface-variant">
                For servicing a user&apos;s own request (export or deletion,
                /privacy promises 30 days). The export contains their private
                practice content — generate it to send to THEM, don&apos;t
                browse it. Both are audit-logged, and both arm only when you
                type the account&apos;s email below (the server re-checks it).
              </p>
              <input
                type="email"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder={detail.account.email ?? "account email"}
                aria-label="Type the account's email to confirm export or deletion"
                className="card input-glow mt-2 w-full px-3 py-1.5 text-sm focus:outline-none"
              />
              <div className="mt-2">
                <TwoStepButton
                  label="Download data export"
                  confirmLabel="Generate the file?"
                  busy={busy === "export"}
                  disabled={
                    !detail.account.email ||
                    confirmEmail.trim().toLowerCase() !==
                      detail.account.email.toLowerCase()
                  }
                  onConfirm={() =>
                    act(
                      "export",
                      () =>
                        adminDownload(
                          "/api/admin/export",
                          `elovox-data-${uid}.json`,
                          { uid, confirmEmail: confirmEmail.trim() }
                        ),
                      "Export downloaded. Handle it like the personal data it is."
                    )
                  }
                />
              </div>
              <div className="mt-4 border-t border-primary/10 pt-3">
                <p className="text-sm font-semibold text-accent-strong">
                  Delete this account
                </p>
                <p className="mt-1 text-caption text-on-surface-variant">
                  Irreversible. Cancels billing (fail-closed), refunds the
                  unused portion to the card, erases everything. Uses the same
                  typed email above.
                </p>
                <div className="mt-2">
                  <TwoStepButton
                    label="Delete account"
                    confirmLabel="Erase everything, permanently?"
                    danger
                    busy={busy === "delete"}
                    disabled={
                      !detail.account.email ||
                      confirmEmail.trim().toLowerCase() !==
                        detail.account.email.toLowerCase()
                    }
                    onConfirm={() =>
                      act(
                        "delete",
                        async () => {
                          const res = await adminSend(
                            "/api/admin/account",
                            "DELETE",
                            { uid, confirmEmail: confirmEmail.trim() }
                          );
                          if (res.ok) setDeleted(true);
                          return res;
                        },
                        "Account deleted."
                      )
                    }
                  />
                </div>
              </div>
            </div>

            <p className="mt-4 pb-6 text-caption text-on-surface-variant">
              Every action here is recorded in the audit log with your email.
              Detail as of {fmtDateTime(now)}.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
