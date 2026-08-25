import { Children, isValidElement, type ReactNode } from "react";

// Shared shell for the legal family — /terms, /privacy, /refunds, /cookies,
// /dmca, /accessibility, /children, /biometrics, /ai. Long-form reading, so
// the column is narrow and the type is a touch larger than the app's UI text:
// a legal page nobody can stand to read is a legal page nobody reads.

/** Heading -> anchor id. Stable across renders, and readable in the URL bar. */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function LegalDoc({
  title,
  intro,
  updated,
  children,
}: {
  title: string;
  intro: string;
  /** That document's own date (LEGAL.privacyUpdated / termsUpdated) — the
   *  two change independently, so they can't share one stamp. */
  updated: string;
  children: ReactNode;
}) {
  // Pull the section headings back out of the children so the contents list
  // cannot drift from the document. A hand-maintained list on nine pages is a
  // list that is wrong on at least one of them within a month.
  const sections = Children.toArray(children)
    .filter((child) => isValidElement<{ heading?: string }>(child))
    .map((child) => (child as { props: { heading?: string } }).props.heading)
    .filter((h): h is string => typeof h === "string" && h.length > 0);

  return (
    <article className="mx-auto max-w-[var(--container-prose)] py-[var(--space-page-y)]">
      {/* native-hide: inside the app the title bar already carries this
          document's name (NativeShell's TITLES), so the h1 under it was the
          same words twice in two different families — on NINE screens at once,
          because every legal page and /ai share this shell. The page keeps its
          h1 in a browser, where there is no bar to say it first. */}
      <h1 className="native-hide font-headline text-3xl font-bold tracking-tight text-primary md:text-4xl">
        {title}
      </h1>
      <p className="mt-2 text-body-sm text-on-surface-variant">
        Last updated {updated}
      </p>
      <p className="mt-6 text-base leading-relaxed text-on-surface">{intro}</p>

      {/* Contents. These documents run to twenty-odd sections and had no way
          in other than scrolling from the top — which is how a refunds policy
          gets read as "too long" rather than read.

          native-hide, for the same reason the h1 is: inside the shell these
          are reached from a row in the Den, and a web-styled contents block
          dropped into the app is exactly the "adjusted web page" the native
          redesign was written to get rid of.

          Rendered only when there is enough document to warrant it. */}
      {sections.length >= 4 && (
        <nav
          aria-labelledby="legal-contents"
          className="native-hide card mt-8 p-5"
        >
          <h2
            id="legal-contents"
            className="text-kicker uppercase text-on-surface-variant"
          >
            Contents
          </h2>
          <ol className="mt-3 flex flex-col gap-1.5">
            {sections.map((heading, i) => (
              <li key={heading} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="font-data text-caption tabular-nums text-on-surface-variant"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <a
                  href={`#${slugify(heading)}`}
                  className="text-body-sm text-primary underline decoration-primary/25 underline-offset-2 hover:decoration-primary"
                >
                  {heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

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
  const id = slugify(heading);
  return (
    // scroll-mt clears the sticky header, which is 56px plus the sub-nav.
    // Without it every anchor lands with its own heading hidden behind the
    // bar, which reads as the link having jumped to the wrong place.
    <section id={id} className="scroll-mt-28">
      <h2 className="group font-headline text-h4 font-semibold text-primary">
        {heading}
        {/* A quiet self-link, so a specific clause can be sent to someone.
            Appears on hover and on keyboard focus — not hover alone, or it is
            unreachable without a mouse. */}
        <a
          href={`#${id}`}
          aria-label={`Link to “${heading}”`}
          className="ml-2 align-middle text-body-sm text-on-surface-variant opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100 focus-visible:opacity-100"
        >
          #
        </a>
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
