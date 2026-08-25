"use client";

import { useEffect, useState } from "react";
import { adminGet, fmtDateTime, type AdminState } from "@/lib/adminClient";
import { AdminTable, EmptyRow, Section } from "@/components/AdminBits";

// The Audit tab: the append-only record every mutating admin route writes.
// Read-only on purpose — a log you can edit from the console it audits isn't
// an audit log. "Who comped that account?" is now a tab, not an archaeology
// project.

interface Entry {
  id: string;
  at: number | null;
  actor: string | null;
  action: string | null;
  targetUid: string | null;
  targetEmail: string | null;
  ok: boolean;
  detail: Record<string, unknown> | null;
}

function detailLine(d: Record<string, unknown> | null): string {
  if (!d) return "";
  return Object.entries(d)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" · ");
}

export function AdminAuditScreen({ onDenied }: { onDenied?: () => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [state, setState] = useState<AdminState>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await adminGet<{ entries: Entry[] }>("/api/admin/audit");
      if (cancelled) return;
      if (res.denied) {
        setState("denied");
        onDenied?.();
        return;
      }
      if (!res.ok || !res.data) return setState("error");
      setEntries(res.data.entries);
      setState("ok");
    })();
    return () => {
      cancelled = true;
    };
    // onDenied is stable for the life of the console shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "denied") return null;
  if (state === "loading") {
    return <p className="py-16 text-on-surface-variant">Loading audit log…</p>;
  }
  if (state === "error" || !entries) {
    return (
      <p className="py-16 text-on-surface-variant">
        Couldn&apos;t load the audit log. Try again in a moment.
      </p>
    );
  }

  return (
    <Section
      title="Operator actions"
      aside={
        <span className="text-sm text-on-surface-variant">
          last {entries.length} entries
        </span>
      }
    >
      <p className="text-sm text-on-surface-variant">
        Every mutating action in this console, newest first. Append-only.
      </p>
      <AdminTable headers={["When", "Who", "Action", "Target", "Detail"]} minWidth={760}>
        {entries.map((e) => (
          <tr key={e.id} className="border-b border-primary/5 align-top last:border-0">
            <td className="px-4 py-2.5 whitespace-nowrap text-on-surface-variant">
              {fmtDateTime(e.at)}
            </td>
            <td className="px-4 py-2.5">{e.actor ?? "—"}</td>
            <td className="px-4 py-2.5">
              <span className="font-data text-caption font-semibold">
                {e.action ?? "—"}
              </span>
              {!e.ok && (
                <span className="ml-1.5 rounded-full border border-accent-strong/40 px-1.5 text-micro font-semibold text-accent-strong">
                  failed
                </span>
              )}
            </td>
            <td className="px-4 py-2.5">
              {e.targetEmail ?? (
                <span className="font-data text-caption">{e.targetUid ?? "—"}</span>
              )}
            </td>
            <td className="px-4 py-2.5 text-caption text-on-surface-variant">
              {detailLine(e.detail)}
            </td>
          </tr>
        ))}
        {entries.length === 0 && (
          <EmptyRow cols={5} text="No operator actions recorded yet." />
        )}
      </AdminTable>
    </Section>
  );
}
