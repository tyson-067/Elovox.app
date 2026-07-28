"use client";

import { useEffect, useState } from "react";
import { isFirebaseConfigured, getUser } from "@/lib/firebase";

// Operator dashboard. Everything here comes from Elovox's own Firestore and
// Firebase Auth records, the questions traffic analytics can't answer (who
// signed up, who converted, who actually practises).
//
// The real access control is server-side in /api/admin/stats, which 404s for
// anyone outside ADMIN_EMAILS. This screen just renders whatever it gets, so
// a non-admin who guesses the URL sees the same "nothing here" as a typo.

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
  };
  subscriptions: {
    premium: number;
    trialing: number;
    activePaid: number;
    cancelling: number;
    byCycle: Record<string, number>;
    conversionPct: number;
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

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-[13px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">
        {label}
      </p>
      <p className="font-data mt-1 text-3xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-sm text-on-surface-variant">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">
        {title}
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}

export function AdminStatsScreen() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "denied" | "error">(
    "loading"
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers: Record<string, string> = {};
        if (isFirebaseConfigured()) {
          const user = await getUser();
          if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
        }
        const res = await fetch("/api/admin/stats", { headers });
        if (cancelled) return;
        if (res.status === 404) return setState("denied");
        if (!res.ok) return setState("error");
        setStats(await res.json());
        setState("ok");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return (
      <p className="mx-auto max-w-5xl px-5 py-16 text-on-surface-variant">
        Loading…
      </p>
    );
  }

  if (state === "denied") {
    return (
      <div className="mx-auto max-w-5xl px-5 py-16">
        <h1 className="font-headline text-2xl font-semibold">Nothing here</h1>
        <p className="mt-2 text-on-surface-variant">
          This page doesn&apos;t exist, or your account can&apos;t see it.
        </p>
      </div>
    );
  }

  if (state === "error" || !stats) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-16">
        <h1 className="font-headline text-2xl font-semibold">
          Couldn&apos;t load stats
        </h1>
        <p className="mt-2 text-on-surface-variant">Try again in a moment.</p>
      </div>
    );
  }

  const { accounts: a, subscriptions: s, activity: v } = stats;

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <h1 className="font-headline text-3xl font-bold">Elovox stats</h1>
      <p className="mt-1 text-sm text-on-surface-variant">
        From Elovox&apos;s own records. Traffic and referrers live in Vercel
        Analytics. Updated {new Date(stats.generatedAt).toLocaleString()}.
      </p>

      <Section title="Accounts">
        <Stat label="Total" value={a.total} />
        <Stat label="New · 7d" value={a.newLast7} hint={`${a.newLast30} in 30d`} />
        <Stat
          label="Verified"
          value={`${a.verifiedPct}%`}
          hint={`${a.unverified} unverified`}
        />
        <Stat
          label="Sign-in"
          value={`${a.viaGoogle}G / ${a.viaPassword}P`}
          hint="Google / password"
        />
      </Section>

      <Section title="Subscriptions">
        <Stat
          label="Premium"
          value={s.premium}
          hint={`${s.conversionPct}% of accounts`}
        />
        <Stat label="On trial" value={s.trialing} />
        <Stat label="Paying" value={s.activePaid} hint={`${s.cancelling} cancelling`} />
        <Stat
          label="By cycle"
          value={`${s.byCycle.weekly}/${s.byCycle.monthly}/${s.byCycle.annual}`}
          hint="wk / mo / yr"
        />
      </Section>

      <Section title="Practice activity">
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
      </Section>
    </div>
  );
}
