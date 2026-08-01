import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Reveal } from "@/components/Reveal";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { Felix } from "@/components/FoxLogo";
import { AUDIENCES, getAudience } from "@/lib/audiences";

// Per-audience landing pages: /for/job-candidates, /for/students,
// /for/founders. One template, content from lib/audiences.ts. Server
// component so each is statically generated, exports its own metadata, and
// carries its own JSON-LD, none of which a client page does cleanly.

// Same literal the rest of the site's JSON-LD uses, so @id refs join one graph.
const SITE = "https://elovox.app";

export function generateStaticParams() {
  return AUDIENCES.map((a) => ({ audience: a.slug }));
}

// Unknown slugs 404 rather than rendering an empty dynamic page.
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ audience: string }>;
}): Promise<Metadata> {
  const { audience } = await params;
  const a = getAudience(audience);
  if (!a) return {};
  const url = `/for/${a.slug}`;
  return {
    title: a.metaTitle,
    description: a.metaDescription,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: "Elovox",
      url,
      title: a.metaTitle,
      description: a.metaDescription,
      images: ["/logo.png"],
    },
    twitter: {
      card: "summary",
      title: a.metaTitle,
      description: a.metaDescription,
      images: ["/logo.png"],
    },
  };
}

export default async function AudiencePage({
  params,
}: {
  params: Promise<{ audience: string }>;
}) {
  const { audience } = await params;
  const a = getAudience(audience);
  if (!a) notFound();

  const pageSchema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${SITE}/for/${a.slug}#webpage`,
    url: `${SITE}/for/${a.slug}`,
    name: a.metaTitle,
    description: a.metaDescription,
    isPartOf: { "@id": `${SITE}/#website` },
    about: { "@id": `${SITE}/#webapp` },
    publisher: { "@id": `${SITE}/#organization` },
  };

  return (
    <div className="native-hide pb-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageSchema) }}
      />

      {/* Hero */}
      <section className="pt-16 md:pt-24">
        <Reveal>
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-[0.08em] uppercase text-violet">
            {a.eyebrow}
          </span>
          <h1 className="hero-slogan mt-4 font-headline font-bold text-primary">
            <span className="block">
              <WordReveal text={a.headline} delay={100} className="slogan-sans" />
            </span>
            <span className="block">
              <WordReveal
                text={a.headlineAccent}
                delay={280}
                className="slogan-serif text-gradient"
              />
            </span>
          </h1>
          <p className="mt-5 max-w-[54ch] text-lg leading-8 text-on-surface-variant md:text-xl">
            {a.sub}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/signup"
              className="btn rounded-lg bg-accent px-8 py-3.5 text-base font-semibold text-white"
            >
              Start free
            </Link>
            <Link
              href="/pricing"
              className="text-base font-semibold text-primary underline underline-offset-4 decoration-primary/30 transition-colors hover:decoration-primary"
            >
              See pricing
            </Link>
          </div>
        </Reveal>
      </section>

      {/* The tailored pitch */}
      <section className="mt-16 md:mt-20 max-w-[62ch]">
        {a.body.map((para, i) => (
          <Reveal key={i} swipe delay={i * 90}>
            <p className="mt-4 text-lg leading-8 text-on-surface first:mt-0">
              {para}
            </p>
          </Reveal>
        ))}
      </section>

      {/* The modes that matter to this person */}
      <section className="mt-16 md:mt-20">
        <Reveal swipe>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.03em] text-on-surface-variant">
            What you&apos;d use
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
          {a.modes.map((m, i) => (
            <Reveal swipe key={m.title} delay={i * 100} className="h-full">
              <GlowCard className="card h-full p-5 md:p-6">
                <h3 className="font-headline text-xl font-semibold text-primary">
                  {m.title}
                </h3>
                <p className="mt-1.5 text-base leading-6 text-on-surface-variant">
                  {m.body}
                </p>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Close */}
      <section className="mt-20 md:mt-28">
        <Reveal swipe>
          <div className="card navy-gradient border-none! p-8 text-white md:p-10">
            <Felix mood="cheer" animate className="mb-4 h-20 w-20" />
            <h2 className="font-headline text-3xl font-semibold md:text-4xl">
              {a.payoff}
            </h2>
            <p className="mt-2 max-w-[52ch] text-base leading-7 text-white/85">
              Free forever with a daily challenge and three attempts a day.
              Premium unlocks the rest.
            </p>
            <Link
              href="/signup"
              className="btn mt-6 inline-block rounded-lg bg-accent px-8 py-3.5 font-semibold text-white"
            >
              Start free
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
