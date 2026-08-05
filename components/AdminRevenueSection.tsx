"use client";

import { useCallback, useEffect, useState } from "react";
import { adminGet } from "@/lib/adminClient";
import { Section, Stat, StatGrid } from "@/components/AdminBits";
import {
  formatMoney,
  minorToMajor,
  PERIOD_LABELS,
  REVENUE_PERIODS,
  type RevenuePeriod,
} from "@/lib/stripeMetrics";

/**
 * Real revenue, from Stripe, on the Overview tab.
 *
 * This replaces a tile that read "Est. MRR" and was computed as list price ×
 * the number of active plan docs in our own Firestore. That estimate could not
 * see a coupon, a proration, a failed card, a refund, tax, or a subscription
 * our webhook missed — and it could not answer "how much money came in" at
 * all, because Firestore holds no cash.
 *
 * FETCHES SEPARATELY from /api/admin/stats, and that is the point: a Stripe
 * outage or a rate limit degrades this one section instead of blanking the
 * whole Overview. The old estimate is kept, small, underneath the real MRR —
 * not as a fallback but as a CROSS-CHECK. When the two diverge, the gap is
 * telling you something (discounts in play, or plan docs out of step with
 * Stripe), and that is worth a glance.
 */

interface VolumeByCurrency {
  currency: string;
  gross: number;
  refunds: number;
  netOfRefunds: number;
  fees: number;
  net: number;
  charges: number;
  refundCount: number;
}

interface RecurringByCurrency {
  currency: string;
  mrr: number;
  arr: number;
  trialMrr: number;
}

interface RevenuePayload {
  generatedAt: number;
  livemode: boolean;
  period: RevenuePeriod;
  periodLabel: string;
  from: number;
  to: number;
  volume: {
    byCurrency: VolumeByCurrency[];
    truncated: boolean;
    scanned: number;
  };
  recurring: {
    byCurrency: RecurringByCurrency[];
    counts: {
      active: number;
      pastDue: number;
      trialing: number;
      cancelingAtPeriodEnd: number;
    };
    unpricedItems: number;
    truncated: boolean;
  };
}

export function AdminRevenueSection({
  /** The Firestore list-price estimate, for the cross-check line. */
  estMrr,
  onDenied,
}: {
  estMrr: number;
  /** Optional, to match the other admin screens' prop shape. */
  onDenied?: () => void;
}) {
  const [period, setPeriod] = useState<RevenuePeriod>("30d");
  const [data, setData] = useState<RevenuePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Deliberately sets NO state before its first await. The loading signal is
  // derived (`data === null && error === null`) and the period buttons clear
  // `data` in their own click handler, because a setState in the synchronous
  // part of an effect body cascades a render — which is what the lint rule
  // that used to fire here was telling us.
  const load = useCallback(
    async (p: RevenuePeriod, refresh = false) => {
      const res = await adminGet<RevenuePayload>(
        `/api/admin/revenue?period=${p}${refresh ? "&refresh=1" : ""}`
      );
      if (res.denied) {
        onDenied?.();
        return;
      }
      if (!res.ok || !res.data) {
        setError(res.error ?? "Couldn't reach Stripe.");
        return;
      }
      setError(null);
      setData(res.data);
    },
    [onDenied]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await adminGet<RevenuePayload>(
        `/api/admin/revenue?period=${period}`
      );
      if (cancelled) return;
      if (res.denied) return onDenied?.();
      if (!res.ok || !res.data) {
        setError(res.error ?? "Couldn't reach Stripe.");
        return;
      }
      setError(null);
      setData(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [period, onDenied]);

  const busy = refreshing || (data === null && error === null);

  const periodPicker = (
    <div className="flex flex-wrap items-center gap-1">
      {REVENUE_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => {
            if (p === period) return;
            // Clearing here, in a user event rather than in the effect, is
            // what gives the switch a loading state without a cascading render.
            setData(null);
            setError(null);
            setPeriod(p);
          }}
          aria-pressed={period === p}
          className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
            period === p
              ? "bg-primary text-white"
              : "bg-surface-container text-on-surface-variant hover:text-primary"
          }`}
        >
          {p === "mtd" ? "MTD" : p}
        </button>
      ))}
      <button
        type="button"
        onClick={async () => {
          setRefreshing(true);
          await load(period, true);
          setRefreshing(false);
        }}
        disabled={busy}
        className="ml-1 rounded-full px-3 py-1 text-[12px] font-semibold text-on-surface-variant hover:text-primary disabled:opacity-50"
      >
        {busy ? "…" : "Refresh"}
      </button>
    </div>
  );

  if (error) {
    return (
      <Section title="Revenue (Stripe)" aside={periodPicker}>
        <div className="card p-4">
          <p className="text-[15px] font-semibold text-error">{error}</p>
          <p className="mt-1 text-sm text-on-surface-variant">
            Nothing here is a guess — if Stripe won&apos;t answer, this section
            shows no numbers rather than zeros. The list-price estimate is $
            {estMrr.toFixed(2)}/mo.
          </p>
        </div>
      </Section>
    );
  }

  if (!data) {
    return (
      <Section title="Revenue (Stripe)" aside={periodPicker}>
        <p className="text-on-surface-variant">Asking Stripe…</p>
      </Section>
    );
  }

  // The account's main currency is whichever bucket is largest. Anything else
  // is listed underneath rather than added in — see the note in
  // lib/stripeMetrics.ts about never summing across currencies.
  const vol = data.volume.byCurrency[0] ?? null;
  const rec = data.recurring.byCurrency[0] ?? null;
  const currency = rec?.currency ?? vol?.currency ?? "usd";
  const otherVol = data.volume.byCurrency.slice(1);
  const otherRec = data.recurring.byCurrency.slice(1);
  const c = data.recurring.counts;

  // Real MRR against the list-price estimate. A gap is expected when discounts
  // exist; a LARGE gap usually means plan docs and Stripe disagree about who
  // is subscribed.
  const realMrrMajor = rec ? minorToMajor(rec.mrr, currency) : 0;
  const drift =
    estMrr > 0 ? Math.round(((realMrrMajor - estMrr) / estMrr) * 100) : null;

  return (
    <Section title="Revenue (Stripe)" aside={periodPicker}>
      {!data.livemode && (
        // The single most dangerous thing this screen could do is show test
        // figures that read as money. A test key produces charges and
        // subscriptions shaped exactly like real ones.
        <p className="mb-3 rounded-lg bg-amber/15 px-4 py-2.5 text-[14px] font-semibold text-amber">
          Stripe TEST mode — these are test-data figures, not real revenue.
        </p>
      )}

      <StatGrid>
        <Stat
          label="MRR"
          value={rec ? formatMoney(rec.mrr, currency) : "—"}
          hint={`${c.active} active${c.pastDue ? ` · ${c.pastDue} past due` : ""}`}
        />
        <Stat
          label="ARR"
          value={rec ? formatMoney(rec.arr, currency) : "—"}
          hint="MRR × 12, a projection"
        />
        <Stat
          label="Gross volume"
          value={vol ? formatMoney(vol.gross, currency) : formatMoney(0, currency)}
          hint={`${data.periodLabel.toLowerCase()} · ${vol?.charges ?? 0} payments`}
        />
        <Stat
          label="Net"
          value={vol ? formatMoney(vol.net, currency) : formatMoney(0, currency)}
          hint="after refunds and Stripe fees"
        />
      </StatGrid>

      <div className="card mt-3 p-4 text-[14px] leading-6 text-on-surface-variant">
        <p>
          <span className="font-semibold text-primary">
            {vol ? formatMoney(vol.refunds, currency) : formatMoney(0, currency)}
          </span>{" "}
          refunded across {vol?.refundCount ?? 0} ·{" "}
          <span className="font-semibold text-primary">
            {vol ? formatMoney(vol.fees, currency) : formatMoney(0, currency)}
          </span>{" "}
          in Stripe fees ·{" "}
          <span className="font-semibold text-primary">
            {vol
              ? formatMoney(vol.netOfRefunds, currency)
              : formatMoney(0, currency)}
          </span>{" "}
          net of refunds, before fees
        </p>

        <p className="mt-2">
          {c.trialing} in trial
          {rec && rec.trialMrr > 0 && (
            <>
              , worth {formatMoney(rec.trialMrr, currency)}/mo if they all
              convert
            </>
          )}
          {c.cancelingAtPeriodEnd > 0 && (
            <> · {c.cancelingAtPeriodEnd} set to cancel at period end</>
          )}
        </p>

        <p className="mt-2">
          List-price estimate says ${estMrr.toFixed(2)}/mo
          {drift !== null && Math.abs(drift) >= 1 && (
            <> ({drift > 0 ? "+" : ""}{drift}% vs Stripe)</>
          )}
          . Stripe is the book of record; a gap means discounts, or plan docs
          out of step with Stripe.
        </p>

        {data.recurring.unpricedItems > 0 && (
          <p className="mt-2 font-semibold text-amber">
            {data.recurring.unpricedItems} metered or tiered subscription item
            {data.recurring.unpricedItems === 1 ? "" : "s"}{" "}
            {/* An explicit {" "} — JSX strips the leading whitespace of a text
                line, so the plural "s" ran straight into the next word. */}
            couldn&apos;t be priced from the price alone — MRR is a floor.
          </p>
        )}
        {(data.volume.truncated || data.recurring.truncated) && (
          <p className="mt-2 font-semibold text-amber">
            Hit the read cap for this window — these totals undercount. Narrow
            the period.
          </p>
        )}

        {(otherVol.length > 0 || otherRec.length > 0) && (
          <p className="mt-2">
            Other currencies (never added to the above):{" "}
            {[
              ...otherRec.map(
                (r) => `${formatMoney(r.mrr, r.currency)}/mo MRR`
              ),
              ...otherVol.map(
                (v) => `${formatMoney(v.gross, v.currency)} gross`
              ),
            ].join(" · ")}
          </p>
        )}

        <p className="mt-2 text-[13px]">
          {new Date(data.from).toLocaleDateString()} –{" "}
          {new Date(data.to).toLocaleDateString()} · read{" "}
          {new Date(data.generatedAt).toLocaleTimeString()} ·{" "}
          {PERIOD_LABELS[data.period]}
        </p>
      </div>
    </Section>
  );
}
