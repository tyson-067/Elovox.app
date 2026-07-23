import type { ReactNode } from "react";
import { LEGAL } from "@/lib/legal";

// Shared shell for /terms and /privacy. Long-form reading, so the column is
// narrow and the type is a touch larger than the app's UI text — a legal
// page nobody can stand to read is a legal page nobody reads.

export function LegalDoc({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-2xl py-12 md:py-16">
      <h1 className="font-headline text-3xl font-bold tracking-tight text-primary md:text-4xl">
        {title}
      </h1>
      <p className="mt-2 text-sm text-on-surface-variant">
        Last updated {LEGAL.lastUpdated}
      </p>
      <p className="mt-6 text-base leading-relaxed text-on-surface">{intro}</p>
      <div className="mt-10 flex flex-col gap-8">{children}</div>
    </article>
  );
}

export function Section({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="font-headline text-xl font-semibold text-primary">
        {heading}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-base leading-relaxed text-on-surface">
        {children}
      </div>
    </section>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-on-surface-variant">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
