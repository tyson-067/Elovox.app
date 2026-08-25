"use client";

import { useEffect, useState } from "react";
import { adminGet, type AdminState } from "@/lib/adminClient";
import { Section, Stat, StatGrid } from "@/components/AdminBits";
import { AdminSparkline } from "@/components/AdminSparkline";
import { AdminRevenueSection } from "@/components/AdminRevenueSection";

// The Overview tab of /admin. Everything here comes from Elovox's own
// Firestore and Firebase Auth records — the questions traffic analytics can't
// answer: who signed up, who converted, who actually practices.
//
// EXCEPT the money. Revenue used to be a list-price estimate computed here
// (price × active plan docs), which could not see a coupon, a refund, a failed
// card or a currency, and could not answer "how much came in" at all. That
// section is <AdminRevenueSection>, which reads Stripe directly and fetches on
// its own so a Stripe outage costs one section rather than this whole tab. The
// estimate survives inside it as a cross-check line.
//
// The real access control is server-side in /api/admin/stats, which 404s for
// anyone outside ADMIN_EMAILS. This screen just renders whatever it gets and
// reports a denial up to the console shell.

interface SeriesPoint {
  date: string;
  count: number;
}

interface Stats {
  generatedAt: number;
  accounts: {
    total: number;
    verified: number;
    unverified: number;
    verifiedPct: number;
    newLast7: number;
    newLast30: number;
    viaGoogle: number;
    viaPassword: number;
    disabled: number;
  };
  subscriptions: {
    premium: number;
    comped: number;
    trialing: number;
    activePaid: number;
    canceling: number;
    byCycle: Record<string, number>;
    conversionPct: number;
  };
  revenue: {
    estMrr: number;
    estArr: number;
    activeByCycle: Record<string, number>;
    note: string;
  };
  series: {
    signupsByDay: SeriesPoint[];
    sessionsByDay: SeriesPoint[];
  };
  retention: {
    settledCohort: number;
    settledRetained: number;
    settledRetainedPct: number;
    activation7: number;
    activationPct: number;
  };
  engagement: {
    rankedAccounts: number;
    coinsCirculating: number;
    purchasesTotal: number;
    topItems: { item: string; count: number }[];
    streakBuckets: { none: number; warming: number; solid: number; onFire: number };
    longestStreakEver: number;
  };
  activity: {
    activeLast7: number;
    activeLast30: number;
    sessionsLast7: number;
    sessionsLast30: number;
    avgSessionsPerActive7: number;
    avgScore: number | null;
    withVideoLast30: number;
  };
}

export function AdminStatsScreen({ onDenied }: { onDenied?: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [state, setState] = useState<AdminState>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await adminGet<Stats>("/api/admin/stats");
      if (cancelled) return;
      if (res.denied) {
        setState("denied");
        onDenied?.();
        return;
      }
      if (!res.ok || !res.data) return setState("error");
      setStats(res.data);
      setState("ok");
    })();
    return () => {
      cancelled = true;
    };
    // onDenied is stable for the life of the console shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "loading") {
    return <p className="py-16 text-on-surface-variant">Loading…</p>;
  }
  if (state === "denied") return null;
  if (state === "error" || !stats) {
    return (
      <div className="py-16">
        <h2 className="font-headline text-2xl font-semibold">
          Couldn&apos;t load stats
        </h2>
        <p className="mt-2 text-on-surface-variant">Try again in a moment.</p>
      </div>
    );
  }

  const {
    accounts: a,
    subscriptions: s,
    activity: v,
    revenue: r,
    retention: ret,
    engagement: e,
  } = stats;
  const signups30 = stats.series.signupsByDay.reduce((n, p) => n + p.count, 0);
  const sessions30 = stats.series.sessionsByDay.reduce((n, p) => n + p.count, 0);

  // The funnel, from numbers already on screen: account → verified →
  // practiced recently → paying. Percentages are of the TOTAL, so the bars
  // only ever narrow.
  const funnel = [
    { label: "Accounts", n: a.total },
    { label: "Verified", n: a.verified },
    { label: "Practiced · 30d", n: v.activeLast30 },
    { label: "Premium", n: s.premium },
  ];

  return (
    <div>
      <p className="mt-2 text-sm text-on-surface-variant">
        From Elovox&apos;s own records. Traffic and referrers live in Vercel
        Analytics. Updated {new Date(stats.generatedAt).toLocaleString()}.
      </p>

      <Section title="Accounts">
        <StatGrid>
          <Stat label="Total" value={a.total} />
          <Stat label="New · 7d" value={a.newLast7} hint={`${a.newLast30} in 30d`} />
          <Stat
            label="Verified"
            value={`${a.verifiedPct}%`}
            hint={`${a.unverified} unverified${a.disabled ? ` · ${a.disabled} disabled` : ""}`}
          />
          <Stat
            label="Sign-in"
            value={`${a.viaGoogle}G / ${a.viaPassword}P`}
            hint="Google / password"
          />
        </StatGrid>
      </Section>

      <Section title="Subscriptions">
        <StatGrid>
          <Stat
            label="Premium"
            value={s.premium}
            hint={
              s.comped
                ? `${s.conversionPct}% of accounts · ${s.comped} comped`
                : `${s.conversionPct}% of accounts`
            }
          />
          <Stat label="On trial" value={s.trialing} />
          <Stat label="Paying" value={s.activePaid} hint={`${s.canceling} canceling`} />
          <Stat
            label="By cycle"
            value={`${s.byCycle.weekly}/${s.byCycle.monthly}/${s.byCycle.annual}`}
            hint="wk / mo / yr"
          />
        </StatGrid>
      </Section>

      {/* Real money, read from Stripe, with its own loading and error state so
          a Stripe outage degrades one section instead of the whole tab. The
          list-price estimate this replaced is now a cross-check line inside
          it — it never knew about coupons, refunds or failed cards, and it
          could not answer "how much came in" at all. */}
      <AdminRevenueSection estMrr={r.estMrr} onDenied={onDenied} />

      <Section title="Subscriber mix">
        <StatGrid>
          <Stat
            label="Paying by cycle"
            value={`${r.activeByCycle.weekly}/${r.activeByCycle.monthly}/${r.activeByCycle.annual}`}
            hint="wk / mo / yr, active only"
          />
          <Stat
            label="Trial → paid"
            value={s.activePaid}
            hint={`${s.trialing} currently in trial`}
          />
          <Stat label="Comped" value={s.comped} hint="streak-reward weeks" />
          <Stat
            label="Canceling"
            value={s.canceling}
            hint="still paid until period end"
          />
        </StatGrid>
      </Section>

      <Section title="Last 30 days">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="card p-4">
            <p className="text-kicker uppercase text-on-surface-variant">
              Signups per day
            </p>
            <p className="font-data mt-1 text-3xl font-bold">{signups30}</p>
            <AdminSparkline
              points={stats.series.signupsByDay}
              label="Signups per day"
            />
          </div>
          <div className="card p-4">
            <p className="text-kicker uppercase text-on-surface-variant">
              Practice sessions per day
            </p>
            <p className="font-data mt-1 text-3xl font-bold">{sessions30}</p>
            <AdminSparkline
              points={stats.series.sessionsByDay}
              label="Practice sessions per day"
            />
          </div>
        </div>
      </Section>

      <Section title="Practice activity">
        <StatGrid>
          <Stat
            label="Active · 7d"
            value={v.activeLast7}
            hint={`${v.activeLast30} in 30d`}
          />
          <Stat
            label="Sessions · 7d"
            value={v.sessionsLast7}
            hint={`${v.sessionsLast30} in 30d`}
          />
          <Stat
            label="Reps per active"
            value={v.avgSessionsPerActive7}
            hint="last 7 days"
          />
          <Stat
            label="Avg score"
            value={v.avgScore ?? "n/a"}
            hint={`${v.withVideoLast30} with camera`}
          />
        </StatGrid>
      </Section>

      <Section title="Funnel">
        <div className="card p-4">
          {funnel.map((step) => (
            <div key={step.label} className="flex items-center gap-3 py-1">
              <span className="w-32 shrink-0 text-label text-on-surface-variant">
                {step.label}
              </span>
              <span
                className="h-4 rounded-full bg-[var(--color-accent)] opacity-80"
                style={{
                  width: `${a.total === 0 ? 0 : Math.max(1.5, (step.n / a.total) * 100)}%`,
                }}
                aria-hidden
              />
              <span className="font-data text-sm font-semibold">
                {step.n}
                {a.total > 0 && step.label !== "Accounts" && (
                  <span className="ml-1 font-normal text-on-surface-variant">
                    ({Math.round((step.n / a.total) * 100)}%)
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Retention">
        <StatGrid>
          <Stat
            label="Settled · kept"
            value={ret.settledCohort === 0 ? "n/a" : `${ret.settledRetainedPct}%`}
            hint={`${ret.settledRetained} of ${ret.settledCohort} joined 7-30d ago, practiced this week`}
          />
          <Stat
            label="New · activated"
            value={a.newLast7 === 0 ? "n/a" : `${ret.activationPct}%`}
            hint={`${ret.activation7} of ${a.newLast7} this week's signups recorded`}
          />
          <Stat
            label="Streaks alive"
            value={e.streakBuckets.warming + e.streakBuckets.solid + e.streakBuckets.onFire}
            hint={`${e.streakBuckets.solid + e.streakBuckets.onFire} at 7d+ · ${e.streakBuckets.onFire} at 21d+`}
          />
          <Stat
            label="Longest streak"
            value={e.longestStreakEver}
            hint="days, all-time"
          />
        </StatGrid>
      </Section>

      <Section title="Economy">
        <StatGrid>
          <Stat label="Ranked accounts" value={e.rankedAccounts} hint="have a scored session" />
          <Stat label="Coins circulating" value={e.coinsCirculating} />
          <Stat label="Shop purchases" value={e.purchasesTotal} />
          <Stat
            label="Top item"
            value={e.topItems[0]?.item ?? "—"}
            hint={
              e.topItems.length
                ? e.topItems.map((t) => `${t.item} ×${t.count}`).join(" · ")
                : "no purchases yet"
            }
          />
        </StatGrid>
      </Section>
    </div>
  );
}
