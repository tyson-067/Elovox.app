"use client";

import { useEffect, useMemo, useState } from "react";
import { isFirebaseConfigured, getUser } from "@/lib/firebase";

// The team's user list, rendered under the stats on /admin. Name, email,
// plan, and billing terms per account, with a paying-subscribers view and a
// CSV export so the answer to "who are our premium users" never requires
// the Firebase console.
//
// Access control is server-side in /api/admin/users (ADMIN_EMAILS, flat 404
// for everyone else); this screen renders whatever it gets, and a non-admin
// sees nothing because AdminStatsScreen above it already showed the
// "nothing here" state for the same denial.

interface Row {
  uid: string;
  name: string | null;
  email: string | null;
  verified: boolean;
  createdAt: number | null;
  premium: boolean;
  source: "paid" | "comp" | null;
  status: string | null;
  cycle: string | null;
  canceling: boolean;
  premiumUntil: number | null;
}

type Filter = "all" | "premium" | "paying";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "premium", label: "Premium" },
  { id: "paying", label: "Paying" },
];

function matches(row: Row, filter: Filter): boolean {
  if (filter === "premium") return row.premium;
  // "Paying": a live Stripe subscription actually being charged. Trials and
  // streak comps are premium but not (yet) revenue, so they stay out of it.
  if (filter === "paying") return row.source === "paid" && row.status === "active";
  return true;
}

function fmtDate(ms: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** RFC-4180 enough: quote everything, double any quotes inside. */
function csvCell(v: string | number | boolean | null): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function toCsv(rows: Row[]): string {
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
    "verified",
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
      r.verified,
      r.uid,
    ]
      .map(csvCell)
      .join(",")
  );
  return [header.map(csvCell).join(","), ...lines].join("\n");
}

/** One line of billing terms, or nothing for a free account. */
function planLine(r: Row): string {
  if (r.source === "comp") {
    return `Streak reward until ${fmtDate(r.premiumUntil)}`;
  }
  if (r.source === "paid") {
    const bits = [r.cycle, r.status].filter(Boolean).join(" · ");
    return r.canceling ? `${bits} · canceling` : bits;
  }
  return "";
}

export function AdminUsersScreen() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "denied" | "error">(
    "loading"
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers: Record<string, string> = {};
        if (isFirebaseConfigured()) {
          const user = await getUser();
          if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
        }
        const res = await fetch("/api/admin/users", { headers });
        if (cancelled) return;
        if (res.status === 404) return setState("denied");
        if (!res.ok) return setState("error");
        const data = (await res.json()) as { users: Row[] };
        setRows(data.users);
        setState("ok");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        matches(r, filter) &&
        (!q ||
          (r.name ?? "").toLowerCase().includes(q) ||
          (r.email ?? "").toLowerCase().includes(q))
    );
  }, [rows, filter, query]);

  // The denied state stays silent: AdminStatsScreen directly above renders
  // the full "nothing here" message for the same 404, and saying it twice
  // reads like the page is broken rather than closed.
  if (state === "denied") return null;

  if (state === "loading") {
    return (
      <p className="mx-auto max-w-5xl px-5 pb-16 text-on-surface-variant">
        Loading users…
      </p>
    );
  }

  if (state === "error" || !rows) {
    return (
      <p className="mx-auto max-w-5xl px-5 pb-16 text-on-surface-variant">
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
    <div className="mx-auto max-w-5xl px-5 pb-16">
      <section className="mt-8">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">
          Users
        </h2>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`pill rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
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
            placeholder="Search name or email"
            aria-label="Search users by name or email"
            className="card input-glow ml-auto w-full max-w-[240px] px-3 py-1.5 text-sm focus:outline-none"
          />
          <button
            type="button"
            onClick={download}
            className="btn rounded-lg bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-on-primary"
          >
            Download CSV
          </button>
        </div>

        <p className="mt-2 text-sm text-on-surface-variant">
          {visible.length} of {rows.length} accounts
          {filter === "paying" && ", live subscriptions being charged"}
          {filter === "premium" &&
            ", includes trials and streak-reward comps"}
          .
        </p>

        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-primary/10 text-[13px] uppercase tracking-[0.04em] text-on-surface-variant">
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-4 py-2.5 font-semibold">Email</th>
                <th className="px-4 py-2.5 font-semibold">Plan</th>
                <th className="px-4 py-2.5 font-semibold">Terms</th>
                <th className="px-4 py-2.5 font-semibold">Joined</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.uid} className="border-b border-primary/5 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-primary">
                    {r.name ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.email ?? "—"}
                    {!r.verified && (
                      <span className="ml-1.5 text-[12px] text-on-surface-variant">
                        (unverified)
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
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-on-surface-variant"
                  >
                    No accounts match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
