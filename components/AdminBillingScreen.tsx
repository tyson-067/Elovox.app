"use client";

import { useEffect, useState } from "react";
import {
  adminGet,
  adminSend,
  fmtDateTime,
  fmtMoney,
  type AdminState,
} from "@/lib/adminClient";
import {
  ActionMsg,
  AdminTable,
  EmptyRow,
  Section,
  TwoStepButton,
} from "@/components/AdminBits";

// The billing-alerts queue: every anomaly lib/refunds.ts and the webhook have
// been parking in `billingAlerts` "for manual follow-up", finally on a
// screen. Unresolved first — an unresolved unused-portion refund is money
// OWED to a user, and this tab exists so that fact can't sit invisible in
// Firestore. Retry re-runs the shared refund helper (idempotent, card-only);
// Resolve is for cases settled by hand in the Stripe dashboard.

interface Alert {
  id: string;
  kind: string;
  context: string | null;
  uid: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  amount: number | null;
  currency: string | null;
  refundId: string | null;
  error: string | null;
  resolved: boolean;
  at: number | null;
}

const KIND_LABEL: Record<string, string> = {
  "unused-portion-refund": "Unused-portion refund",
  "duplicate-subscription": "Duplicate subscription",
};

export function AdminBillingScreen({ onDenied }: { onDenied?: () => void }) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [state, setState] = useState<AdminState>("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Refresh by bumping a nonce (the usePlanRecord idiom in lib/plan.ts).
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await adminGet<{ alerts: Alert[] }>("/api/admin/billing");
      if (cancelled) return;
      if (res.denied) {
        setState("denied");
        onDenied?.();
        return;
      }
      if (!res.ok || !res.data) return setState("error");
      // Unresolved first, then newest.
      const sorted = [...res.data.alerts].sort((a, b) => {
        if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
        return (b.at ?? 0) - (a.at ?? 0);
      });
      setAlerts(sorted);
      setState("ok");
    })();
    return () => {
      cancelled = true;
    };
    // onDenied is stable for the life of the console shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  if (state === "denied") return null;
  if (state === "loading") {
    return <p className="py-16 text-on-surface-variant">Loading billing…</p>;
  }
  if (state === "error" || !alerts) {
    return (
      <p className="py-16 text-on-surface-variant">
        Couldn&apos;t load billing alerts. Try again in a moment.
      </p>
    );
  }

  const unresolved = alerts.filter((a) => !a.resolved).length;

  const doAction = async (id: string, action: "resolve" | "unresolve" | "retry") => {
    setBusy(`${action}:${id}`);
    setMsg(null);
    const res = await adminSend<{ resolved: boolean; error: string | null }>(
      "/api/admin/billing",
      "POST",
      { id, action }
    );
    setBusy(null);
    if (res.ok) {
      setMsg({
        ok: true,
        text:
          action === "retry"
            ? res.data?.resolved
              ? "Refund went through to the card."
              : `Retry ran but didn't resolve it${res.data?.error ? `: ${res.data.error}` : "."}`
            : action === "resolve"
              ? "Marked resolved."
              : "Reopened.",
      });
      reload();
    } else {
      setMsg({ ok: false, text: res.error ?? "That didn't work. Try again." });
    }
  };

  return (
    <Section
      title="Billing alerts"
      aside={
        <span className="text-sm text-on-surface-variant">
          {unresolved === 0
            ? "Nothing needs attention."
            : `${unresolved} need${unresolved === 1 ? "s" : ""} attention`}
        </span>
      }
    >
      <p className="text-sm text-on-surface-variant">
        Written by the refund helper and the webhook when money needs a human.
        An unresolved refund is money owed to a user — retry it, or settle it
        in Stripe and mark it resolved.
      </p>
      <ActionMsg msg={msg} />
      <AdminTable
        headers={["What", "Who / sub", "Amount", "Status", "When", "Actions"]}
        minWidth={860}
      >
        {alerts.map((al) => (
          <tr key={al.id} className="border-b border-primary/5 align-top last:border-0">
            <td className="px-4 py-2.5">
              <p className="font-medium text-primary">
                {KIND_LABEL[al.kind] ?? al.kind}
              </p>
              {al.context && (
                <p className="text-[12px] text-on-surface-variant">{al.context}</p>
              )}
              {al.error && (
                <p className="mt-0.5 max-w-[260px] text-[12px] text-accent-strong">
                  {al.error}
                </p>
              )}
            </td>
            <td className="px-4 py-2.5">
              <p className="font-data text-[12px]">{al.uid ?? "—"}</p>
              {al.subscriptionId && (
                <a
                  className="font-data text-[12px] underline decoration-primary/30 underline-offset-2"
                  href={`https://dashboard.stripe.com/subscriptions/${al.subscriptionId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {al.subscriptionId}
                </a>
              )}
            </td>
            <td className="px-4 py-2.5 whitespace-nowrap">
              {al.amount !== null ? fmtMoney(al.amount, al.currency) : "—"}
            </td>
            <td className="px-4 py-2.5">
              {al.resolved ? (
                <span className="text-on-surface-variant">Resolved</span>
              ) : (
                <span className="font-semibold text-accent-strong">Open</span>
              )}
            </td>
            <td className="px-4 py-2.5 whitespace-nowrap text-on-surface-variant">
              {fmtDateTime(al.at)}
            </td>
            <td className="px-4 py-2.5">
              <div className="flex flex-wrap gap-1.5">
                {!al.resolved && al.kind === "unused-portion-refund" && (
                  <TwoStepButton
                    label="Retry refund"
                    confirmLabel="Run the refund again?"
                    busy={busy === `retry:${al.id}`}
                    onConfirm={() => void doAction(al.id, "retry")}
                  />
                )}
                {!al.resolved ? (
                  <TwoStepButton
                    label="Resolve"
                    confirmLabel="Mark handled?"
                    busy={busy === `resolve:${al.id}`}
                    onConfirm={() => void doAction(al.id, "resolve")}
                  />
                ) : (
                  <TwoStepButton
                    label="Reopen"
                    confirmLabel="Reopen this alert?"
                    busy={busy === `unresolve:${al.id}`}
                    onConfirm={() => void doAction(al.id, "unresolve")}
                  />
                )}
              </div>
            </td>
          </tr>
        ))}
        {alerts.length === 0 && (
          <EmptyRow cols={6} text="No billing alerts. As it should be." />
        )}
      </AdminTable>
    </Section>
  );
}
