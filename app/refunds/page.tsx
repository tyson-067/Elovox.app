import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, Section, Bullets } from "@/components/LegalDoc";
import { LEGAL } from "@/lib/legal";
import { PLANS, formatUSD, hasTrial } from "@/lib/pricing";
import { pageGraph } from "@/lib/schema";

// Refund & cancellation policy. Broken out of /terms into its own page for one
// practical reason: a payment processor and most consumer rules expect a
// refund/cancellation policy a customer can actually find, and a buried
// subsection of the Terms is not that. The substance mirrors /terms exactly —
// this page must never say something the Terms contradict.

const TITLE = "Refunds & Cancellation | Elovox";
const DESCRIPTION =
  "How Elovox billing works: how to cancel, what renews, and when we refund.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/refunds" },
  openGraph: {
    type: "article",
    siteName: "Elovox",
    url: "/refunds",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

const mailto = `mailto:${LEGAL.contactEmail}`;
const SITE = "https://elovox.app";
const modified = (() => {
  const d = new Date(LEGAL.refundsUpdated);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
})();

const PAGE_SCHEMA = {
  "@type": "WebPage",
  "@id": `${SITE}/refunds#webpage`,
  url: `${SITE}/refunds`,
  name: TITLE,
  description: DESCRIPTION,
  isPartOf: { "@id": `${SITE}/#website` },
  publisher: { "@id": `${SITE}/#organization` },
  ...(modified ? { dateModified: modified } : {}),
};

export default function RefundsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageGraph(PAGE_SCHEMA)) }}
      />
      <LegalDoc
        title="Refunds & Cancellation"
        updated={LEGAL.refundsUpdated}
        intro="Short version: you can cancel any time in a couple of clicks, canceling stops the next charge and you keep access until the period you've paid for runs out, and if something genuinely went wrong we'll make it right. The detail is below."
      >
        <Section heading="What you're paying for">
          <p>Premium is a subscription. Current plans:</p>
          <Bullets
            items={PLANS.map((p) => (
              <span key={p.cycle}>
                <strong>{p.label}</strong>: {formatUSD(p.price)} per {p.unit}
                {hasTrial(p)
                  ? `, after a ${p.trialDays}-day free trial`
                  : ", charged from the day you subscribe (no free trial)"}
                . Renews every {p.unit} until you cancel.
              </span>
            ))}
          />
          <p>
            Prices are shown in US dollars. The current numbers always live on
            the{" "}
            <Link href="/pricing" className="text-accent-strong hover:underline">
              pricing page
            </Link>
            .
          </p>
        </Section>

        <Section heading="How to cancel">
          <p>
            Cancel yourself, any time, without emailing anyone:
          </p>
          <Bullets
            items={[
              <span key="1">
                Open{" "}
                <Link href="/account" className="text-accent-strong hover:underline">
                  your account settings
                </Link>{" "}
                and choose Manage billing. That opens Stripe&apos;s secure
                customer portal.
              </span>,
              "In the portal, cancel your plan. You'll see the date your access runs until.",
              "That's it — no phone call, no retention maze, no waiting on us.",
            ]}
          />
          <p>
            Canceling stops the <strong>next</strong> charge. Your Premium stays
            on until the end of the period you&apos;ve already paid for, then
            drops to the free plan. Deleting your account (also in settings)
            cancels immediately.
          </p>
        </Section>

        <Section heading="Free trials">
          <p>
            The monthly and annual plans start with a {LEGAL.serviceName} free
            trial; the weekly plan does not. Starting a trial needs a payment
            method, and unless you cancel before it ends it turns into a paid
            subscription automatically and you&apos;re charged for the first
            period. Cancel any time during the trial and you pay nothing. You can
            also skip the trial and pay from day one if you&apos;d rather.
          </p>
        </Section>

        <Section heading="Refunds">
          <p>
            Payments are generally non-refundable, including for time you
            didn&apos;t use — that&apos;s what the free trial is for, so you can
            decide before you pay. But this isn&apos;t a wall:
          </p>
          <Bullets
            items={[
              "If you were charged because of a bug on our side, or billed after you'd already canceled, tell us and we'll refund it.",
              "If Elovox was broadly unusable for a stretch you paid for, email us — we'll look at it fairly rather than hide behind this page.",
              "If we discontinue Elovox, we refund any period you've paid for but can no longer use.",
            ]}
          />
          <p>
            To ask about a refund, email{" "}
            <a className="text-accent-strong hover:underline" href={mailto}>
              {LEGAL.contactEmail}
            </a>{" "}
            from your account&apos;s address and tell us what happened. We aim to
            reply within 5 business days.
          </p>
        </Section>

        <Section heading="Your statutory rights">
          <p>
            Nothing here removes a refund or cancellation right the law gives you
            that these terms can&apos;t take away. Where such a right applies, it
            applies on top of everything above. For the full agreement, see the{" "}
            <Link href="/terms" className="text-accent-strong hover:underline">
              Terms of Service
            </Link>
            .
          </p>
        </Section>
      </LegalDoc>
    </>
  );
}
