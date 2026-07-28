import type { Metadata } from "next";
import { VerifyEmailScreen } from "@/components/VerifyEmailScreen";

export const metadata: Metadata = {
  title: "Verify your email | Elovox",
  // Nothing here is useful to a search engine, and it's account-specific.
  robots: { index: false, follow: false },
};

export default function VerifyEmailPage() {
  return <VerifyEmailScreen />;
}
