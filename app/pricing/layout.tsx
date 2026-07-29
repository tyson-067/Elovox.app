import type { Metadata } from "next";

// Exists only to carry metadata. `page.tsx` is a client component, it needs
// useState for the cycle toggle and useAuth for the subscriber CTAs, and a
// client component cannot export `metadata`. Without this file the route
// silently inherits the root layout's title and description, so every search
// result and link preview for /pricing read as the homepage.
//
// A layout is the smallest fix: the alternative is splitting page.tsx into a
// server shell wrapping a client body, which buys nothing here because the
// whole page is interactive.

const TITLE = "Pricing | Elovox";
const DESCRIPTION =
  "Elovox pricing. Free forever with a daily speech and three attempts a day, or Premium from $1.54/week for unlimited practice, camera coaching, the speech library, and interview practice. Monthly and annual start with a 7-day free trial.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/pricing" },
  openGraph: {
    type: "website",
    siteName: "Elovox",
    url: "/pricing",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/logo.png"],
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/logo.png"],
  },
};

export default function PricingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
