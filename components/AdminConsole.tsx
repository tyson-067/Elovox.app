"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

// The seven screens were MOUNT-gated but not IMPORT-gated: only the active tab
// rendered, yet all ~3,000 lines of all seven — plus AdminUserDrawer at 850 —
// were in the graph and shipped to whoever opened /admin. Worse, they were
// reachable from the shared chunk, so ordinary users paid for an operator
// console they can never open (every /api/admin route 404s outside
// ADMIN_EMAILS).
//
// ssr: false is correct rather than incidental. Every one of these fetches on
// mount and renders nothing meaningful server-side, and /admin is noindex in
// robots.ts — there is no crawler and no first paint worth prerendering.
const loading = () => <p className="text-label text-on-surface-variant">Loading…</p>;

const AdminStatsScreen = dynamic(
  () => import("@/components/AdminStatsScreen").then((m) => m.AdminStatsScreen),
  { ssr: false, loading }
);
const AdminUsersScreen = dynamic(
  () => import("@/components/AdminUsersScreen").then((m) => m.AdminUsersScreen),
  { ssr: false, loading }
);
const AdminBillingScreen = dynamic(
  () => import("@/components/AdminBillingScreen").then((m) => m.AdminBillingScreen),
  { ssr: false, loading }
);
const AdminOpsScreen = dynamic(
  () => import("@/components/AdminOpsScreen").then((m) => m.AdminOpsScreen),
  { ssr: false, loading }
);
const AdminCommunityScreen = dynamic(
  () => import("@/components/AdminCommunityScreen").then((m) => m.AdminCommunityScreen),
  { ssr: false, loading }
);
const AdminAuditScreen = dynamic(
  () => import("@/components/AdminAuditScreen").then((m) => m.AdminAuditScreen),
  { ssr: false, loading }
);
const AdminEmailScreen = dynamic(
  () => import("@/components/AdminEmailScreen").then((m) => m.AdminEmailScreen),
  { ssr: false, loading }
);

// The /admin shell: one page, seven tabs, each screen owning its own data.
// Only the active tab is mounted, so switching refetches — for an operator
// console, current beats cached.
//
// Access control stays entirely server-side (every /api/admin route 404s
// outside ADMIN_EMAILS). The first screen to see that 404 reports it here,
// and the shell collapses to the same "nothing here" the stats screen has
// always shown — one message, not seven, and no tab bar advertising what a
// non-admin can't open.

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "billing", label: "Billing" },
  { id: "ops", label: "Ops" },
  { id: "community", label: "Community" },
  { id: "email", label: "Email" },
  { id: "audit", label: "Audit" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AdminConsole() {
  const [tab, setTab] = useState<TabId>("overview");
  const [denied, setDenied] = useState(false);

  if (denied) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-16">
        <h1 className="font-headline text-2xl font-semibold">Nothing here</h1>
        <p className="mt-2 text-on-surface-variant">
          This page doesn&apos;t exist, or your account can&apos;t see it.
        </p>
      </div>
    );
  }

  const onDenied = () => setDenied(true);

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <h1 className="font-headline text-3xl font-bold">Elovox admin</h1>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`pill rounded-full border px-3.5 py-1.5 text-label font-semibold ${
              tab === t.id
                ? "border-accent bg-accent-strong text-white"
                : "border-primary/20 text-primary hover:border-accent/60"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <AdminStatsScreen onDenied={onDenied} />}
      {tab === "users" && <AdminUsersScreen onDenied={onDenied} />}
      {tab === "billing" && <AdminBillingScreen onDenied={onDenied} />}
      {tab === "ops" && <AdminOpsScreen onDenied={onDenied} />}
      {tab === "community" && <AdminCommunityScreen onDenied={onDenied} />}
      {tab === "email" && <AdminEmailScreen onDenied={onDenied} />}
      {tab === "audit" && <AdminAuditScreen onDenied={onDenied} />}
    </div>
  );
}
