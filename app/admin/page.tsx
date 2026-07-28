import type { Metadata } from "next";
import { AdminStatsScreen } from "@/components/AdminStatsScreen";

export const metadata: Metadata = {
  title: "Stats | Elovox",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminStatsScreen />;
}
