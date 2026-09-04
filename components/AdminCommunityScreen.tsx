"use client";

import { useEffect, useState } from "react";
import {
  adminGet,
  adminSend,
  fmtDate,
  type AdminState,
} from "@/lib/adminClient";
import {
  ActionMsg,
  AdminTable,
  EmptyRow,
  Section,
  TwoStepButton,
} from "@/components/AdminBits";
import { AdminDailyPanel } from "@/components/AdminDailyPanel";

// The Community tab: the two lists an operator legitimately curates.
//
// Leaderboard handles are the ONE user-authored thing strangers see (/dmca
// says so in as many words), which makes them the one moderation surface
// that needs no new policy language. Clearing one reverts the row to the
// designed anonymous rendering — rank intact, name gone, reservation freed.
//
// The tips list is the /privacy promise "use it only to send those tips" +
// "come off the list any time" — Remove services exactly that request.

interface BoardRow {
  uid: string;
  handle: string | null;
  xp: number;
  level: number;
  streakDays: number;
}

interface Lead {
  email: string;
  since: number | null;
  submissions: number;
}

export function AdminCommunityScreen({ onDenied }: { onDenied?: () => void }) {
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [leadTotal, setLeadTotal] = useState(0);
  const [state, setState] = useState<AdminState>("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Refresh by bumping a nonce (the usePlanRecord idiom in lib/plan.ts).
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [board, leadRes] = await Promise.all([
        adminGet<{ rows: BoardRow[] }>("/api/admin/leaderboard"),
        adminGet<{ total: number; leads: Lead[] }>("/api/admin/leads"),
      ]);
      if (cancelled) return;
      if (board.denied || leadRes.denied) {
        setState("denied");
        onDenied?.();
        return;
      }
      if (!board.ok || !board.data || !leadRes.ok || !leadRes.data) {
        return setState("error");
      }
      setRows(board.data.rows);
      setLeads(leadRes.data.leads);
      setLeadTotal(leadRes.data.total);
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
    return <p className="py-16 text-on-surface-variant">Loading community…</p>;
  }
  if (state === "error" || !rows || !leads) {
    return (
      <p className="py-16 text-on-surface-variant">
        Couldn&apos;t load community data. Try again in a moment.
      </p>
    );
  }

  const clearHandle = async (uid: string) => {
    setBusy(uid);
    setMsg(null);
    const res = await adminSend("/api/admin/leaderboard", "POST", {
      uid,
      action: "clear-handle",
    });
    setBusy(null);
    if (res.ok) {
      setMsg({ ok: true, text: "Handle cleared. The row shows as anonymous." });
      reload();
    } else {
      setMsg({ ok: false, text: res.error ?? "That didn't work. Try again." });
    }
  };

  const removeLead = async (email: string) => {
    setBusy(email);
    setMsg(null);
    const res = await adminSend("/api/admin/leads", "DELETE", { email });
    setBusy(null);
    if (res.ok) {
      setMsg({ ok: true, text: `${email} is off the list.` });
      reload();
    } else {
      setMsg({ ok: false, text: res.error ?? "That didn't work. Try again." });
    }
  };

  const named = rows.filter((r) => r.handle);

  return (
    <div>
      <ActionMsg msg={msg} />

      <AdminDailyPanel />

      <Section
        title="Leaderboard handles"
        aside={
          <span className="text-sm text-on-surface-variant">
            {named.length} named of {rows.length} ranked
          </span>
        }
      >
        <p className="text-sm text-on-surface-variant">
          The one thing strangers see. Clear a name that shouldn&apos;t be on a
          public board; the rank stays, the row goes anonymous, and the name
          frees up.
        </p>
        <AdminTable headers={["Handle", "Level", "XP", "Streak", ""]} minWidth={560}>
          {named.map((r) => (
            <tr key={r.uid} className="border-b border-primary/5 last:border-0">
              <td className="px-4 py-2.5 font-medium text-primary">{r.handle}</td>
              <td className="px-4 py-2.5">L{r.level}</td>
              <td className="px-4 py-2.5 font-data">{r.xp}</td>
              <td className="px-4 py-2.5">{r.streakDays}d</td>
              <td className="px-4 py-2.5">
                <TwoStepButton
                  label="Clear handle"
                  confirmLabel={`Remove “${r.handle}”?`}
                  danger
                  busy={busy === r.uid}
                  onConfirm={() => void clearHandle(r.uid)}
                />
              </td>
            </tr>
          ))}
          {named.length === 0 && (
            <EmptyRow cols={5} text="Nobody has picked a handle yet." />
          )}
        </AdminTable>
      </Section>

      <Section
        title="Tips list"
        aside={
          <span className="text-sm text-on-surface-variant">
            {leadTotal} signed up
          </span>
        }
      >
        <p className="text-sm text-on-surface-variant">
          Addresses from the speaking-tips form, which has been removed. This
          is the historical list, no longer growing. The policy is one sentence:
          used only to send those tips, removable on request, and the Remove
          button is that request, honored.
        </p>
        <AdminTable headers={["Email", "Joined", "Submissions", ""]} minWidth={560}>
          {leads.map((l) => (
            <tr key={l.email} className="border-b border-primary/5 last:border-0">
              <td className="px-4 py-2.5 font-medium">{l.email}</td>
              <td className="px-4 py-2.5 whitespace-nowrap text-on-surface-variant">
                {fmtDate(l.since)}
              </td>
              <td className="px-4 py-2.5">{l.submissions}</td>
              <td className="px-4 py-2.5">
                <TwoStepButton
                  label="Remove"
                  confirmLabel="Take them off the list?"
                  danger
                  busy={busy === l.email}
                  onConfirm={() => void removeLead(l.email)}
                />
              </td>
            </tr>
          ))}
          {leads.length === 0 && <EmptyRow cols={4} text="No signups yet." />}
        </AdminTable>
      </Section>
    </div>
  );
}
