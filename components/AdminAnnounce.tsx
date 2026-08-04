"use client";

import { useState } from "react";
import { adminSend } from "@/lib/adminClient";
import { ActionMsg, Section, TwoStepButton } from "@/components/AdminBits";

/**
 * The "email everyone" composer.
 *
 * Its job is to make the size of the action obvious before it happens. Every
 * other control in this console affects one account; this one mails the entire
 * userbase, cannot be recalled, and on a hundred-a-day plan may not even fit
 * in today's allowance. So the flow is deliberately a staircase:
 *
 *   write → preview (renders the real email) → send to yourself → send to all
 *
 * The final button stays disabled until a preview has been rendered, and the
 * confirmation it submits is the content's own id. Edit a word after previewing
 * and the id no longer matches, the server answers 409, and you're sent back to
 * look at it again. That is not friction for its own sake: the failure mode
 * this prevents is mailing everyone a draft.
 *
 * Recipients are account holders with the `product` switch on — never the tips
 * list, which agreed to something narrower. See lib/email/announce.ts.
 */

interface Estimate {
  recipients: number;
  unverified: number;
  affordable: number;
  fitsToday: boolean;
  dailyRemaining: number;
}

export function AdminAnnounce({
  estimate,
  onSent,
}: {
  estimate: Estimate | null;
  onSent: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaHref, setCtaHref] = useState("");

  const [preview, setPreview] = useState<{ html: string; id: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const draft = { subject, heading, body, ctaLabel, ctaHref };
  const ready = subject.trim() && heading.trim() && body.trim();

  // Any edit invalidates the preview. Without this the button stays live
  // against a render the operator has since changed — the server would catch
  // it with a 409, but being told "no" after pressing send is a worse
  // experience than the button simply going quiet.
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPreview(null);
    setMsg(null);
  };

  const call = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setMsg(null);
    const res = await adminSend<Record<string, unknown>>("/api/admin/email", "POST", {
      action,
      announcement: draft,
      ...extra,
    });
    setBusy(null);
    return res;
  };

  const doPreview = async () => {
    const res = await call("announce-preview");
    if (res.data?.ok) {
      setPreview({
        html: String(res.data.html ?? ""),
        id: String(res.data.id ?? ""),
      });
    } else {
      setMsg({ ok: false, text: res.error ?? "Couldn't render that." });
    }
  };

  const doTest = async () => {
    const res = await call("announce-test");
    setMsg(
      res.data?.ok
        ? { ok: true, text: "Sent to you. Check how it actually looks." }
        : { ok: false, text: res.error ?? `Didn't send: ${res.data?.outcome ?? "unknown"}` }
    );
  };

  const doSend = async () => {
    if (!preview) return;
    const res = await call("announce-send", { confirm: preview.id });
    if (res.data?.ok) {
      const sent = Number(res.data.sent ?? 0);
      const over = Number(res.data.overBudget ?? 0);
      setMsg({
        ok: true,
        text: over
          ? `Sent to ${sent}. ${over} didn't fit in today's allowance and were NOT sent — they won't be picked up automatically.`
          : `Sent to ${sent}.`,
      });
      setPreview(null);
      onSent();
    } else {
      setMsg({ ok: false, text: res.error ?? "Couldn't send." });
    }
  };

  const field =
    "mt-1 w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm";

  return (
    <Section title="Announce something">
      <div className="card p-4">
        <p className="text-sm text-on-surface-variant">
          Goes to everyone with an account, a verified address, and product
          emails switched on. Not the tips list — those subscribers agreed to
          tips only.
        </p>

        {estimate && (
          <p className="mt-2 text-sm">
            <strong>{estimate.recipients}</strong> would receive it.{" "}
            {estimate.fitsToday ? (
              <span className="text-on-surface-variant">
                Today&apos;s allowance covers it ({estimate.dailyRemaining} left).
              </span>
            ) : (
              <span className="font-semibold text-accent-strong">
                Only {estimate.affordable} fit in today&apos;s allowance. The rest
                will not be sent.
              </span>
            )}
            {estimate.unverified > 0 && (
              <span className="text-on-surface-variant">
                {" "}
                {estimate.unverified} skipped as unverified.
              </span>
            )}
          </p>
        )}

        <div className="mt-4 grid gap-3">
          <label className="block text-sm font-semibold">
            Subject
            <input
              className={field}
              value={subject}
              onChange={(e) => edit(setSubject)(e.target.value)}
              placeholder="Camera practice is live"
            />
          </label>
          <label className="block text-sm font-semibold">
            Heading
            <input
              className={field}
              value={heading}
              onChange={(e) => edit(setHeading)(e.target.value)}
              placeholder="Practice with the camera on"
            />
          </label>
          <label className="block text-sm font-semibold">
            Body
            <textarea
              className={`${field} min-h-[140px]`}
              value={body}
              onChange={(e) => edit(setBody)(e.target.value)}
              placeholder={"One idea per email.\n\nBlank line starts a new paragraph. No formatting — write it like you'd say it."}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              Button label (optional)
              <input
                className={field}
                value={ctaLabel}
                onChange={(e) => edit(setCtaLabel)(e.target.value)}
                placeholder="Try it"
              />
            </label>
            <label className="block text-sm font-semibold">
              Button link
              <input
                className={field}
                value={ctaHref}
                onChange={(e) => edit(setCtaHref)(e.target.value)}
                placeholder="https://elovox.app/practice"
              />
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void doPreview()}
            disabled={!ready || busy !== null}
            className="pill rounded-full border border-primary/20 px-3.5 py-1.5 text-[13px] font-semibold text-primary disabled:opacity-40"
          >
            {busy === "announce-preview" ? "Rendering…" : "Preview"}
          </button>
          <button
            type="button"
            onClick={() => void doTest()}
            disabled={!ready || busy !== null}
            className="pill rounded-full border border-primary/20 px-3.5 py-1.5 text-[13px] font-semibold text-primary disabled:opacity-40"
          >
            {busy === "announce-test" ? "Sending…" : "Send to me"}
          </button>
          <TwoStepButton
            label={
              preview
                ? `Send to everyone (${estimate?.affordable ?? "?"})`
                : "Preview first"
            }
            confirmLabel="Yes, email everyone"
            busy={busy === "announce-send"}
            disabled={!preview || busy !== null}
            danger
            onConfirm={() => void doSend()}
          />
        </div>
        <ActionMsg msg={msg} />

        {preview && (
          <div className="mt-4">
            <p className="text-[13px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">
              Preview
            </p>
            {/* srcDoc + a sandbox with no allow-scripts: the email is rendered
                in its own document so its inline styles can't leak into the
                console, and it stays inert. */}
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview.html}
              className="mt-2 h-[520px] w-full rounded-xl border border-outline-variant bg-white"
            />
          </div>
        )}
      </div>
    </Section>
  );
}
