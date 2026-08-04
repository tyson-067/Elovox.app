"use client";

import { useEffect, useState } from "react";
import {
  adminGet,
  adminSend,
  fmtDateTime,
  type AdminState,
} from "@/lib/adminClient";
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

// The Ops tab: how the paid pipeline is doing (from the best-effort counters
// /api/analyze writes), the security-event tail (admin-route probes, flag
// flips — the privacy policy's "keeping the service secure" basis, expiring
// on a short window), the emergency brake, and the config worth eyeballing.

interface Day {
  date: string;
  runs: number;
  ok: number;
  noSpeech: number;
  unreadableAudio: number;
  transcribeFailed: number;
  modelFailed: number;
  paused: number;
  premiumRuns: number;
  cameraRuns: number;
  avgTotalMs: number | null;
  avgTranscribeMs: number | null;
  avgModelMs: number | null;
}

interface OpsData {
  generatedAt: number;
  days: Day[];
  events: {
    id: string;
    type: string;
    route: string | null;
    uid: string | null;
    ip: string | null;
    detail: string | null;
    at: number;
  }[];
  flags: { pauseAnalyze: boolean; pauseCheckout: boolean; banner: string };
  flagsUpdatedBy: string | null;
  flagsUpdatedAt: number | null;
  config: { adminEmails: string[]; appCheckEnforced: boolean };
}

function BannerEditor({
  current,
  busy,
  onSave,
}: {
  current: string;
  busy: boolean;
  onSave: (banner: string) => void;
}) {
  // No sync effect needed: the parent keys this component by `current`, so a
  // reload that changes the server value remounts it with fresh state.
  const [text, setText] = useState(current);
  return (
    <div className="card mt-3 p-4">
      <p className="text-sm font-semibold">Announcement banner</p>
      <p className="mt-1 text-[12px] text-on-surface-variant">
        One plain-text line across the top of the website (never the native
        app). Empty means no banner. Live within a minute.
      </p>
      <input
        type="text"
        maxLength={140}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Maintenance tonight 9-10pm PT — practice may pause briefly."
        aria-label="Announcement banner text"
        className="card input-glow mt-2 w-full px-3 py-1.5 text-sm focus:outline-none"
      />
      <div className="mt-2 flex gap-2">
        <TwoStepButton
          label="Publish banner"
          confirmLabel="Put it on the site?"
          busy={busy}
          disabled={text.trim() === current.trim() || text.trim() === ""}
          onConfirm={() => onSave(text.trim())}
        />
        {current && (
          <TwoStepButton
            label="Clear banner"
            confirmLabel="Take it down?"
            danger
            busy={busy}
            onConfirm={() => onSave("")}
          />
        )}
      </div>
    </div>
  );
}

export function AdminOpsScreen({ onDenied }: { onDenied?: () => void }) {
  const [data, setData] = useState<OpsData | null>(null);
  const [state, setState] = useState<AdminState>("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Refresh by bumping a nonce (the usePlanRecord idiom in lib/plan.ts).
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await adminGet<OpsData>("/api/admin/ops");
      if (cancelled) return;
      if (res.denied) {
        setState("denied");
        onDenied?.();
        return;
      }
      if (!res.ok || !res.data) return setState("error");
      setData(res.data);
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
    return <p className="py-16 text-on-surface-variant">Loading ops…</p>;
  }
  if (state === "error" || !data) {
    return (
      <p className="py-16 text-on-surface-variant">
        Couldn&apos;t load ops. Try again in a moment.
      </p>
    );
  }

  const totals = data.days.reduce(
    (t, d) => ({
      runs: t.runs + d.runs,
      ok: t.ok + d.ok,
      failed: t.failed + d.transcribeFailed + d.modelFailed,
      noSpeech: t.noSpeech + d.noSpeech + d.unreadableAudio,
      camera: t.camera + d.cameraRuns,
    }),
    { runs: 0, ok: 0, failed: 0, noSpeech: 0, camera: 0 }
  );
  const okPct = totals.runs === 0 ? null : Math.round((totals.ok / totals.runs) * 100);
  const latest = data.days[data.days.length - 1] ?? null;

  const setFlags = async (
    update: { pauseAnalyze?: boolean; pauseCheckout?: boolean; banner?: string },
    okText: string
  ) => {
    setBusy(true);
    setMsg(null);
    const res = await adminSend("/api/admin/ops", "POST", update);
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: okText });
      reload();
    } else {
      setMsg({ ok: false, text: res.error ?? "That didn't work. Try again." });
    }
  };

  return (
    <div>
      <Section title="Analyze pipeline · last 14 days">
        <p className="text-sm text-on-surface-variant">
          Counted best-effort at the moment each analysis ends; counters can
          run a hair under real traffic, never over. Latency is a daily
          average.
        </p>
        <div className="mt-3">
          <StatGrid>
            <Stat
              label="Runs"
              value={totals.runs}
              hint={`${totals.camera} with camera`}
            />
            <Stat
              label="Completed"
              value={okPct === null ? "n/a" : `${okPct}%`}
              hint={`${totals.failed} failed · ${totals.noSpeech} unusable takes`}
            />
            <Stat
              label="Avg total"
              value={latest?.avgTotalMs ? `${(latest.avgTotalMs / 1000).toFixed(1)}s` : "n/a"}
              hint="latest day"
            />
            <Stat
              label="Transcribe / model"
              value={
                latest?.avgTranscribeMs && latest?.avgModelMs
                  ? `${(latest.avgTranscribeMs / 1000).toFixed(1)}s / ${(latest.avgModelMs / 1000).toFixed(1)}s`
                  : "n/a"
              }
              hint="latest day"
            />
          </StatGrid>
        </div>
        {data.days.length > 0 && (
          <div className="card mt-3 p-4">
            <p className="text-[13px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">
              Runs per day
            </p>
            <AdminSparkline
              points={data.days.map((d) => ({ date: d.date, count: d.runs }))}
              label="Analyze runs per day"
            />
          </div>
        )}
      </Section>

      <Section title="Controls">
        <ActionMsg msg={msg} />
        <div className="card p-4">
          <p className="text-sm">
            {data.flags.pauseAnalyze ? (
              <span className="font-semibold text-accent-strong">
                Analysis is PAUSED.
              </span>
            ) : (
              <span className="font-semibold">Analysis is running normally.</span>
            )}{" "}
            <span className="text-on-surface-variant">
              Stops the paid AssemblyAI + Gemini pipeline (users get an honest
              &quot;maintenance break&quot; message, nothing is spent). Fails
              open: a Firestore blip can never pause the product by itself.
            </span>
          </p>
          <div className="mt-2">
            {data.flags.pauseAnalyze ? (
              <TwoStepButton
                label="Resume analysis"
                confirmLabel="Resume the pipeline?"
                busy={busy}
                onConfirm={() =>
                  void setFlags(
                    { pauseAnalyze: false },
                    "Resumed. Warm instances converge within a minute."
                  )
                }
              />
            ) : (
              <TwoStepButton
                label="Pause analysis"
                confirmLabel="Pause the paid pipeline?"
                danger
                busy={busy}
                onConfirm={() =>
                  void setFlags(
                    { pauseAnalyze: true },
                    "Paused. Warm instances converge within a minute."
                  )
                }
              />
            )}
          </div>
        </div>

        <div className="card mt-3 p-4">
          <p className="text-sm">
            {data.flags.pauseCheckout ? (
              <span className="font-semibold text-accent-strong">
                New purchases are PAUSED.
              </span>
            ) : (
              <span className="font-semibold">Checkout is open.</span>
            )}{" "}
            <span className="text-on-surface-variant">
              Stops NEW subscriptions from starting (a pricing mistake, a
              Stripe incident). Existing subscribers are untouched.
            </span>
          </p>
          <div className="mt-2">
            {data.flags.pauseCheckout ? (
              <TwoStepButton
                label="Reopen checkout"
                confirmLabel="Start selling again?"
                busy={busy}
                onConfirm={() =>
                  void setFlags({ pauseCheckout: false }, "Checkout reopened.")
                }
              />
            ) : (
              <TwoStepButton
                label="Pause checkout"
                confirmLabel="Stop new purchases?"
                danger
                busy={busy}
                onConfirm={() =>
                  void setFlags({ pauseCheckout: true }, "Checkout paused.")
                }
              />
            )}
          </div>
        </div>

        <BannerEditor
          key={data.flags.banner}
          current={data.flags.banner}
          busy={busy}
          onSave={(banner) =>
            void setFlags(
              { banner },
              banner ? "Banner is live (website only)." : "Banner cleared."
            )
          }
        />

        {data.flagsUpdatedBy && (
          <p className="mt-2 text-[12px] text-on-surface-variant">
            Controls last changed by {data.flagsUpdatedBy},{" "}
            {fmtDateTime(data.flagsUpdatedAt)}.
          </p>
        )}
      </Section>

      <Section title="Security events · 7-day window">
        <p className="text-sm text-on-surface-variant">
          Admin-route probes and flag changes, kept for a short operational
          window then purged (each read sweeps expired rows). Sampled under
          flood, so shapes are visible and storage isn&apos;t.
        </p>
        <AdminTable headers={["Type", "Route", "Who", "Detail", "When"]} minWidth={720}>
          {data.events.map((e) => (
            <tr key={e.id} className="border-b border-primary/5 last:border-0">
              <td className="px-4 py-2.5 font-medium text-primary">{e.type}</td>
              <td className="px-4 py-2.5 font-data text-[12px]">{e.route ?? "—"}</td>
              <td className="px-4 py-2.5 font-data text-[12px]">
                {e.uid ?? e.ip ?? "—"}
              </td>
              <td className="px-4 py-2.5 text-on-surface-variant">{e.detail ?? "—"}</td>
              <td className="px-4 py-2.5 whitespace-nowrap text-on-surface-variant">
                {fmtDateTime(e.at)}
              </td>
            </tr>
          ))}
          {data.events.length === 0 && (
            <EmptyRow cols={5} text="No security events in the window." />
          )}
        </AdminTable>
      </Section>

      <Section title="Config">
        <div className="card p-4 text-sm">
          <p>
            <span className="font-semibold">Operators (ADMIN_EMAILS):</span>{" "}
            {data.config.adminEmails.join(", ") || "none"}
          </p>
          <p className="mt-1">
            <span className="font-semibold">App Check:</span>{" "}
            {data.config.appCheckEnforced
              ? "enforcing"
              : "soft-fail (logging only — flip APPCHECK_ENFORCE when the logs go quiet)"}
          </p>
          <p className="mt-1 text-[12px] text-on-surface-variant">
            Changing either means changing env vars in Vercel and redeploying —
            deliberately not a button here.
          </p>
        </div>
      </Section>
    </div>
  );
}
