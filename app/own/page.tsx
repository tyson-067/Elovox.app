"use client";

import { RequireAuth } from "@/components/RequireAuth";
import { PracticeCatalogPage } from "@/components/PracticeCatalogPage";
import { CATEGORIES } from "@/lib/categories";

// Coaching on the user's own material (Premium). Nothing is written for
// them here, they bring the pitch or the talk they already have, and
// Felix coaches the delivery rather than the draft.

export default function OwnPage() {
  return (
    <RequireAuth>
      <PracticeCatalogPage
        title="My own material"
        tipLabel="What counts as my own material?"
        tip={
          <>
            A pitch, a toast, a class presentation — anything you&apos;ve
            already written. Felix doesn&apos;t rewrite it. He scores how you
            say it.
          </>
        }
        lead="Bring something you've already written. Pick what kind of thing it is, and Felix coaches how you deliver it."
        items={CATEGORIES}
        hrefFor={(c) => `/practice?category=${c.id}`}
        columns={2}
        upsellHeading="Got something real coming up?"
        upsellBody={
          <>
            Premium coaches you on your own words, and Felix will write you a
            speech from scratch if you&apos;d rather start there.
          </>
        }
      />
    </RequireAuth>
  );
}
