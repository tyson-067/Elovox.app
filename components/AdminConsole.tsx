"use client";

import { useState } from "react";
import { AdminStatsScreen } from "@/components/AdminStatsScreen";
import { AdminUsersScreen } from "@/components/AdminUsersScreen";
import { AdminBillingScreen } from "@/components/AdminBillingScreen";
import { AdminOpsScreen } from "@/components/AdminOpsScreen";
import { AdminCommunityScreen } from "@/components/AdminCommunityScreen";
import { AdminAuditScreen } from "@/components/AdminAuditScreen";
import { AdminEmailScreen } from "@/components/AdminEmailScreen";

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
            className={`pill rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
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
