"use client";

import { useEffect, useState } from "react";
import { adminGet, adminSend, fmtDateTime, type AdminState } from "@/lib/adminClient";
import {
  ActionMsg,
  AdminTable,
  EmptyRow,
  Section,
  Stat,
  StatGrid,
  TwoStepButton,
} from "@/components/AdminBits";
import { AdminSparkline } from "@/components/AdminSparkline";
import { AdminAnnounce } from "@/components/AdminAnnounce";

// The Email tab: what's left of the free plan, whether the domain is still
// verified, who has been suppressed and why, and a test send that goes down
// the real path.
//
// The one screen in the console whose main number is a BUDGET rather than a
// count. Resend's free tier is 100 a day and 3,000 a month, both hard, and the
// day this app quietly starts dropping mail is the day nobody notices — so
// the day's usage is the first thing on the page and the per-category caps
// are shown next to it, because "we're at 100" and "lifecycle is at its 60"
// need completely different responses.

interface Budget {
  day: string;
  month: string;
  usedToday: number;
  dailyCap: number;
  usedThisMonth: number;
  monthlyCap: number;
  byCategory: Record<string, { used: number; cap: number }>;
}

interface EmailData {
  generatedAt: number;
  config: {
    configured: boolean;
    from: string | null;
    replyTo: string;
    audienceConfigured: boolean;
    webhookConfigured: boolean;
    unsubTokensConfigured: boolean;
  };
  budget: Budget;
  history: { day: string; total: number }[];
  suppressed: {
    email: string;
    reason: string;
    at: number;
    detail?: string;
    categories?: string[];
  }[];
  domains: { name: string; status: string; region: string | null }[] | null;
  audience: { total: number; subscribed: number } | null;
  recent: {
    to: string;
    category: string;
    type: string;
    status: string;
    at: number | null;
  }[];
  announce: {
    recipients: number;
    unverified: number;
    affordable: number;
    fitsToday: boolean;
    dailyRemaining: number;
  } | null;
  tips: { subscribers: number; finished: number; due: number; total: number };
}

const REASON_LABEL: Record<string, string> = {
  "hard-bounce": "Bounced",
  complaint: "Marked spam",
  unsubscribe: "Unsubscribed",
  manual: "Added by hand",
};

export function AdminEmailScreen({ onDenied }: { onDenied: () => void }) {
  const [state, setState] = useState<AdminState>("loading");
  const [data, setData] = useState<EmailData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const res = await adminGet<EmailData>("/api/admin/email");
    if (res.denied) {
      onDenied();
      return;
    }
    if (!res.ok || !res.data) {
      setState("error");
      return;
    }
    setData(res.data);
    setState("ok");
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await adminGet<EmailData>("/api/admin/email");
      if (cancelled) return;
      if (res.denied) {
        onDenied();
        return;
      }
      if (!res.ok || !res.data) return setState("error");
      setData(res.data);
      setState("ok");
    })();
    return () => {
      cancelled = true;
    };
    // The console remounts each tab on switch, which is where a refresh comes
    // from; `load` above is for refreshing after an action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "loading") {
    return <p className="mt-8 text-on-surface-variant">Loading…</p>;
  }
  if (state === "error" || !data) {
    return <p className="mt-8 text-on-surface-variant">Couldn&apos;t load email stats.</p>;
  }

  const { budget, config } = data;
  const dayLeft = Math.max(0, budget.dailyCap - budget.usedToday);
  const monthLeft = Math.max(0, budget.monthlyCap - budget.usedThisMonth);

  const test = async () => {
    setBusy("test");
    setMsg(null);
    const res = await adminSend<{ ok: boolean; outcome: string; detail: string | null }>(
      "/api/admin/email",
      "POST",
      { action: "test" }
    );
    setBusy(null);
    if (res.data?.ok) {
      setMsg({ ok: true, text: "Sent. Check your inbox." });
      void load();
    } else {
      setMsg({
        ok: false,
        text: res.error ?? `Didn't send: ${res.data?.outcome ?? "unknown"}`,
      });
    }
  };

  const unsuppress = async (email: string) => {
    setBusy(email);
    setMsg(null);
    const res = await adminSend<{ ok: boolean }>("/api/admin/email", "POST", {
      action: "unsuppress",
      email,
    });
    setBusy(null);
    if (res.data?.ok) {
      setMsg({ ok: true, text: `${email} can receive mail again.` });
      void load();
    } else {
      setMsg({ ok: false, text: res.error ?? "Couldn't remove that." });
    }
  };

  return (
    <div>
      {!config.configured && (
        <p className="card mt-6 p-4 text-sm font-semibold text-accent-strong">
          No mail is going out. RESEND_API_KEY and MAIL_FROM aren&apos;t set.
        </p>
      )}

      <Section title="Today">
        <StatGrid>
          <Stat
            label="Sent today"
            value={`${budget.usedToday}/${budget.dailyCap}`}
            hint={`${dayLeft} left`}
          />
          <Stat
            label="This month"
            value={`${budget.usedThisMonth}/${budget.monthlyCap}`}
            hint={`${monthLeft} left`}
          />
          <Stat
            label="Tips list"
            value={data.tips.subscribers}
            hint={`${data.tips.due} due a tip on the next run`}
          />
          <Stat
            label="Suppressed"
            value={data.suppressed.length}
            hint="Bounced, spam, opted out"
          />
        </StatGrid>
      </Section>

      <Section title="Per category, today">
        <AdminTable headers={["Category", "Used", "Cap"]} minWidth={360}>
          {Object.entries(budget.byCategory).map(([name, c]) => (
            <tr key={name} className="border-b border-primary/5 last:border-0">
              <td className="px-4 py-2.5 font-semibold capitalize">{name}</td>
              <td className="font-data px-4 py-2.5">{c.used}</td>
              <td className="font-data px-4 py-2.5 text-on-surface-variant">{c.cap}</td>
            </tr>
          ))}
        </AdminTable>
        <p className="mt-2 text-sm text-on-surface-variant">
          Caps reserve room so a bulk run can&apos;t use up the allowance a
          security or billing email needs later the same day.
        </p>
      </Section>

      <Section title="Sent per day">
        <div className="card p-4">
          <AdminSparkline
            points={data.history.map((d) => ({ date: d.day, count: d.total }))}
            label="Emails sent per day"
          />
        </div>
      </Section>

      <Section title="Tips drip">
        <div className="card p-4">
          <p className="text-sm">
            {data.tips.subscribers === 0
              ? "Nobody on the list yet."
              : `${data.tips.subscribers} subscribers. ${data.tips.finished} have finished all ${data.tips.total} tips.`}
          </p>
          <p className="mt-2 text-sm text-on-surface-variant">
            One tip a week each, timed from when they joined rather than a
            shared schedule — so this sends a handful most days instead of the
            whole list at once. Nothing to press. Add tips by appending to{" "}
            <code className="font-data">lib/email/tips.ts</code>; anyone partway
            through carries straight on into them.
          </p>
          {data.tips.subscribers > 0 && data.tips.due === 0 && (
            <p className="mt-2 text-sm text-on-surface-variant">
              Nobody is due one right now. That is the normal state most of the
              time — everyone is mid-week.
            </p>
          )}
        </div>
      </Section>

      <AdminAnnounce estimate={data.announce} onSent={() => void load()} />

      <Section title="Setup">
        <AdminTable headers={["Thing", "State"]} minWidth={420}>
          <ConfigRow label="From address" value={config.from ?? "not set"} ok={Boolean(config.from)} />
          <ConfigRow label="Reply-to" value={config.replyTo} ok />
          <ConfigRow
            label="Webhook secret"
            value={config.webhookConfigured ? "set" : "missing — bounces aren't suppressed"}
            ok={config.webhookConfigured}
          />
          <ConfigRow
            label="Unsubscribe links"
            value={config.unsubTokensConfigured ? "signed" : "off — no key to sign with"}
            ok={config.unsubTokensConfigured}
          />
          <ConfigRow
            label="Tips audience"
            value={config.audienceConfigured ? "linked" : "not set — broadcasts unavailable"}
            ok={config.audienceConfigured}
          />
          {(data.domains ?? []).map((d) => (
            <ConfigRow
              key={d.name}
              label={`Domain ${d.name}`}
              value={d.status}
              ok={d.status === "verified"}
            />
          ))}
        </AdminTable>
        <div className="mt-3">
          <TwoStepButton
            label="Send myself a test"
            confirmLabel="Send it"
            busy={busy === "test"}
            disabled={!config.configured}
            onConfirm={() => void test()}
          />
          <ActionMsg msg={msg} />
        </div>
      </Section>

      <Section title="Suppressed addresses">
        <AdminTable headers={["Address", "Why", "When", ""]}>
          {data.suppressed.length === 0 && (
            <EmptyRow cols={4} text="Nobody. Good." />
          )}
          {data.suppressed.map((s) => {
            // Only a bounce or a hand-added entry can be undone here. A
            // complaint and an unsubscribe are the user's word, not ours.
            const undoable = s.reason === "hard-bounce" || s.reason === "manual";
            return (
              <tr key={s.email} className="border-b border-primary/5 last:border-0">
                <td className="px-4 py-2.5">{s.email}</td>
                <td className="px-4 py-2.5">
                  {REASON_LABEL[s.reason] ?? s.reason}
                  {s.categories?.length ? (
                    <span className="text-on-surface-variant"> ({s.categories.join(", ")})</span>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 text-on-surface-variant">{fmtDateTime(s.at)}</td>
                <td className="px-4 py-2.5">
                  {undoable && (
                    <TwoStepButton
                      label="Allow again"
                      confirmLabel="Allow"
                      busy={busy === s.email}
                      onConfirm={() => void unsuppress(s.email)}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </AdminTable>
      </Section>

      <Section title="Recently sent">
        <AdminTable headers={["To", "Message", "Category", "State", "When"]}>
          {data.recent.length === 0 && <EmptyRow cols={5} text="Nothing sent yet." />}
          {data.recent.map((r, i) => (
            <tr key={`${r.to}-${i}`} className="border-b border-primary/5 last:border-0">
              <td className="px-4 py-2.5">{r.to}</td>
              <td className="px-4 py-2.5">{r.type}</td>
              <td className="px-4 py-2.5 text-on-surface-variant">{r.category}</td>
              <td className="px-4 py-2.5">{r.status}</td>
              <td className="px-4 py-2.5 text-on-surface-variant">{fmtDateTime(r.at)}</td>
            </tr>
          ))}
        </AdminTable>
        <p className="mt-2 text-sm text-on-surface-variant">
          Kept 30 days, then swept by the nightly purge — this holds addresses,
          so it lives under the same retention window as the other logs.
        </p>
      </Section>
    </div>
  );
}

function ConfigRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <tr className="border-b border-primary/5 last:border-0">
      <td className="px-4 py-2.5 font-semibold">{label}</td>
      <td className={`px-4 py-2.5 ${ok ? "text-on-surface-variant" : "font-semibold text-accent-strong"}`}>
        {value}
      </td>
    </tr>
  );
}
