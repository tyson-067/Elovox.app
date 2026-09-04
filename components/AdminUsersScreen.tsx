"use client";

import { useEffect, useMemo, useState } from "react";
import { adminGet, fmtDate, type AdminState } from "@/lib/adminClient";
import { AdminUserDrawer } from "@/components/AdminUserDrawer";

// The Users tab: every account, searchable and filterable, with a CSV export
// so "who are our premium users" never requires the Firebase console — and
// now a drawer per row carrying the operator actions (comp, coins, meter
// reset, subscription, disable, export, delete). The drawer's actions all
// live behind /api/admin/* routes that audit-log the operator.
//
// Access control is server-side (/api/admin/users, flat 404 outside
// ADMIN_EMAILS); a denial is reported up to the console shell.

export interface UserRow {
  uid: string;
  name: string | null;
  email: string | null;
  verified: boolean;
  disabled: boolean;
  createdAt: number | null;
  lastSignInAt: number | null;
  premium: boolean;
  source: "paid" | "comp" | null;
  status: string | null;
  cycle: string | null;
  canceling: boolean;
  premiumUntil: number | null;
  grantReason: string | null;
}

type Filter = "all" | "premium" | "paying" | "disabled";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "premium", label: "Premium" },
  { id: "paying", label: "Paying" },
  { id: "disabled", label: "Disabled" },
];

function matches(row: UserRow, filter: Filter): boolean {
  if (filter === "premium") return row.premium;
  // "Paying": a live Stripe subscription actually being charged. Trials and
  // comps are premium but not (yet) revenue, so they stay out of it.
  if (filter === "paying") return row.source === "paid" && row.status === "active";
  if (filter === "disabled") return row.disabled;
  return true;
}

/** RFC-4180 enough: quote everything, double any quotes inside. */
function csvCell(v: string | number | boolean | null): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function toCsv(rows: UserRow[]): string {
  const header = [
    "name",
    "email",
    "premium",
    "source",
    "status",
    "cycle",
    "canceling",
    "comp_until",
    "joined",
    "last_sign_in",
    "verified",
    "disabled",
    "uid",
  ];
  const lines = rows.map((r) =>
    [
      r.name,
      r.email,
      r.premium,
      r.source,
      r.status,
      r.cycle,
      r.canceling,
      r.premiumUntil ? new Date(r.premiumUntil).toISOString() : "",
      r.createdAt ? new Date(r.createdAt).toISOString() : "",
      r.lastSignInAt ? new Date(r.lastSignInAt).toISOString() : "",
      r.verified,
      r.disabled,
      r.uid,
    ]
      .map(csvCell)
      .join(",")
  );
  return [header.map(csvCell).join(","), ...lines].join("\n");
}

/** One line of billing terms, or nothing for a free account. */
function planLine(r: UserRow): string {
  if (r.source === "comp") {
    const kind = r.grantReason === "admin-comp" ? "Comp" : "Streak reward";
    return `${kind} until ${fmtDate(r.premiumUntil)}`;
  }
  if (r.source === "paid") {
    const bits = [r.cycle, r.status].filter(Boolean).join(" · ");
    return r.canceling ? `${bits} · canceling` : bits;
  }
  return "";
}

export function AdminUsersScreen({ onDenied }: { onDenied?: () => void }) {
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [state, setState] = useState<AdminState>("loading");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<UserRow | null>(null);

  // Refresh by bumping a nonce, the same idiom as usePlanRecord in
  // lib/plan.ts — the drawer bumps it after a mutation.
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await adminGet<{ users: UserRow[] }>("/api/admin/users");
      if (cancelled) return;
      if (res.denied) {
        setState("denied");
        onDenied?.();
        return;
      }
      if (!res.ok || !res.data) return setState("error");
      setRows(res.data.users);
      setState("ok");
    })();
    return () => {
      cancelled = true;
    };
    // onDenied is stable for the life of the console shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        matches(r, filter) &&
        (!q ||
          (r.name ?? "").toLowerCase().includes(q) ||
          (r.email ?? "").toLowerCase().includes(q) ||
          r.uid.toLowerCase() === q)
    );
  }, [rows, filter, query]);

  if (state === "denied") return null;

  if (state === "loading") {
    return <p className="py-16 text-on-surface-variant">Loading users…</p>;
  }

  if (state === "error" || !rows) {
    return (
      <p className="py-16 text-on-surface-variant">
        Couldn&apos;t load the user list. Try again in a moment.
      </p>
    );
  }

  const download = () => {
    const blob = new Blob([toCsv(visible)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `elovox-users-${filter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={`pill rounded-full border px-3.5 py-1.5 text-label font-semibold ${
              filter === f.id
                ? "border-accent bg-accent-strong text-white"
                : "border-primary/20 text-primary hover:border-accent/60"
            }`}
          >
            {f.label}
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, or uid"
          aria-label="Search users by name, email, or uid"
          className="card input-glow ml-auto w-full max-w-[240px] px-3 py-1.5 text-sm focus:outline-none"
        />
        <button
          type="button"
          onClick={download}
          className="btn rounded-lg bg-primary px-3.5 py-1.5 text-label font-semibold text-on-primary"
        >
          Download CSV
        </button>
      </div>

      <p className="mt-2 text-sm text-on-surface-variant">
        {visible.length} of {rows.length} accounts
        {filter === "paying" && ", live subscriptions being charged"}
        {filter === "premium" && ", includes trials and comps"}
        {filter === "disabled" && ", sign-in suspended"}. Click a row to
        manage the account.
      </p>

      <div className="card mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-primary/10 text-kicker uppercase text-on-surface-variant">
              <th className="px-4 py-2.5 font-semibold">Name</th>
              <th className="px-4 py-2.5 font-semibold">Email</th>
              <th className="px-4 py-2.5 font-semibold">Plan</th>
              <th className="px-4 py-2.5 font-semibold">Terms</th>
              <th className="px-4 py-2.5 font-semibold">Joined</th>
              <th className="px-4 py-2.5 font-semibold">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.uid}
                onClick={() => setSelected(r)}
                className="cursor-pointer border-b border-primary/5 last:border-0 hover:bg-primary/5"
              >
                <td className="px-4 py-2.5 font-medium text-primary">
                  {r.name ?? "-"}
                </td>
                <td className="px-4 py-2.5">
                  {r.email ?? "-"}
                  {!r.verified && (
                    <span className="ml-1.5 text-caption text-on-surface-variant">
                      (unverified)
                    </span>
                  )}
                  {r.disabled && (
                    <span className="ml-1.5 rounded-full border border-accent-strong/40 px-1.5 text-micro font-semibold text-accent-strong">
                      disabled
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {r.premium ? (
                    <span className="font-semibold text-violet">Premium</span>
                  ) : (
                    "Free"
                  )}
                </td>
                <td className="px-4 py-2.5 text-on-surface-variant">
                  {planLine(r)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-on-surface-variant">
                  {fmtDate(r.createdAt)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-on-surface-variant">
                  {fmtDate(r.lastSignInAt)}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-on-surface-variant"
                >
                  No accounts match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <AdminUserDrawer
          uid={selected.uid}
          onClose={() => setSelected(null)}
          onChanged={() => setNonce((n) => n + 1)}
        />
      )}
    </section>
  );
}
