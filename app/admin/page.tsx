import type { Metadata } from "next";
import { AdminStatsScreen } from "@/components/AdminStatsScreen";
import { AdminUsersScreen } from "@/components/AdminUsersScreen";

export const metadata: Metadata = {
  title: "Admin | Elovox",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <>
      <AdminStatsScreen />
      <AdminUsersScreen />
    </>
  );
}
