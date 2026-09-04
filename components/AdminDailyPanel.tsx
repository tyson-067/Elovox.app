"use client";

import { useEffect, useState } from "react";
import { adminGet, adminSend } from "@/lib/adminClient";
import {
  ActionMsg,
  Section,
  TwoStepButton,
} from "@/components/AdminBits";

// Editorial control over the Daily Minute, rendered on the Community tab.
// Yesterday and today are read-only (people have played them; the shared
// topic is the leaderboard's comparison baseline); tomorrow onward can be
// set by hand or cleared back to auto-generation. Server enforces the same
// boundary — see /api/admin/daily.

interface Day {
  date: string;
  exists: boolean;
  editable: boolean;
  title: string | null;
  topic: string | null;
  scenario: string | null;
  bullets: string[] | null;
  focus: string | null;
  theme: string | null;
  generated: boolean;
}

const EMPTY_FORM = {
  title: "",
  topic: "",
  scenario: "",
  focus: "",
  b1: "",
  b2: "",
  b3: "",
};

export function AdminDailyPanel() {
  const [days, setDays] = useState<Day[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await adminGet<{ days: Day[] }>("/api/admin/daily");
      if (cancelled) return;
      if (res.ok && res.data) setDays(res.data.days);
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  if (!days) return null;

  const openEditor = (d: Day) => {
    setEditing(d.date);
    setForm({
      title: d.title ?? "",
      topic: d.topic ?? "",
      scenario: d.scenario ?? "",
      focus: d.focus ?? "",
      b1: d.bullets?.[0] ?? "",
      b2: d.bullets?.[1] ?? "",
      b3: d.bullets?.[2] ?? "",
    });
    setMsg(null);
  };

  const formComplete =
    form.title.trim() &&
    form.topic.trim() &&
    form.scenario.trim() &&
    form.focus.trim() &&
    form.b1.trim() &&
    form.b2.trim() &&
    form.b3.trim();

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setMsg(null);
    const res = await adminSend("/api/admin/daily", "POST", {
      date: editing,
      title: form.title,
      topic: form.topic,
      scenario: form.scenario,
      focus: form.focus,
      bullets: [form.b1, form.b2, form.b3],
    });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: `Set for ${editing}.` });
      setEditing(null);
      reload();
    } else {
      setMsg({ ok: false, text: res.error ?? "That didn't work. Try again." });
    }
  };

  const clear = async (date: string) => {
    setBusy(true);
    setMsg(null);
    const res = await adminSend("/api/admin/daily", "DELETE", { date });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: `${date} will auto-generate again.` });
      if (editing === date) setEditing(null);
      reload();
    } else {
      setMsg({ ok: false, text: res.error ?? "That didn't work. Try again." });
    }
  };

  const field = (
    label: string,
    key: keyof typeof EMPTY_FORM,
    placeholder: string,
    max: number
  ) => (
    <label className="mt-2 block">
      <span className="text-caption font-semibold text-on-surface-variant">
        {label}
      </span>
      <input
        type="text"
        maxLength={max}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        className="card input-glow mt-0.5 w-full px-3 py-1.5 text-sm focus:outline-none"
      />
    </label>
  );

  return (
    <Section title="Daily Minute">
      <p className="text-sm text-on-surface-variant">
        The shared improv topic. Past and today are locked; people have
        played them. Tomorrow onward can be hand-set (a themed week, a launch
        tie-in) or cleared back to Felix&apos;s auto-generation.
      </p>
      <ActionMsg msg={msg} />
      <div className="card mt-3 divide-y divide-primary/5">
        {days.map((d) => (
          <div key={d.date} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-data text-label font-semibold">
                {d.date}
              </span>
              {!d.editable && (
                <span className="rounded-full border border-primary/20 px-1.5 text-micro text-on-surface-variant">
                  locked
                </span>
              )}
              {d.exists ? (
                <span className="text-sm">
                  <span className="font-medium">{d.title ?? "Untitled"}</span>
                  <span className="text-on-surface-variant">: {d.topic}</span>
                  {d.theme === "Operator pick" && (
                    <span className="ml-1.5 rounded-full border border-violet/40 px-1.5 text-micro font-semibold text-violet">
                      operator pick
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-sm text-on-surface-variant">
                  {d.editable ? "will auto-generate" : "never generated"}
                </span>
              )}
              {d.editable && (
                <span className="ml-auto flex gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      editing === d.date ? setEditing(null) : openEditor(d)
                    }
                    className="pill rounded-full border border-primary/20 px-3 py-1 text-label font-semibold text-primary hover:border-accent/60"
                  >
                    {editing === d.date ? "Close" : d.exists ? "Edit" : "Set"}
                  </button>
                  {d.exists && (
                    <TwoStepButton
                      label="Clear"
                      confirmLabel="Back to auto?"
                      danger
                      busy={busy}
                      onConfirm={() => void clear(d.date)}
                    />
                  )}
                </span>
              )}
            </div>

            {editing === d.date && (
              <div className="mt-2 border-t border-primary/10 pt-2">
                {field("Title (2-4 words)", "title", "The Last Ask", 60)}
                {field(
                  "Topic",
                  "topic",
                  "Why your city should keep libraries open late",
                  200
                )}
                {field(
                  "Scenario (second person, in the room)",
                  "scenario",
                  "You have sixty seconds to convince the room…",
                  300
                )}
                {field("Bullet 1", "b1", "Who it's really for", 120)}
                {field("Bullet 2", "b2", "What it costs, kept concrete", 120)}
                {field("Bullet 3", "b3", "The cost of doing nothing", 120)}
                {field(
                  "Delivery focus",
                  "focus",
                  "Slow down on any numbers. Let them do the work.",
                  200
                )}
                <div className="mt-3">
                  <TwoStepButton
                    label={d.exists ? "Replace this day" : "Publish this day"}
                    confirmLabel={`Make this ${d.date}'s challenge?`}
                    busy={busy}
                    disabled={!formComplete}
                    onConfirm={() => void save()}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}
