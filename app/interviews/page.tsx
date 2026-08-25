"use client";

import { RequireAuth } from "@/components/RequireAuth";
import { PracticeCatalogPage } from "@/components/PracticeCatalogPage";
import { INTERVIEW_TYPES } from "@/lib/interviews";

// Interview practice (Premium), split by the kind of room you're walking
// into. A hiring panel and an admissions officer are listening for
// completely different things, so each type has its own question bank.

export default function InterviewsPage() {
  return (
    <RequireAuth>
      <PracticeCatalogPage
        title="Interview practice"
        tipLabel="How does interview practice work?"
        tip={
          <>
            Every type has its own question bank. Felix asks one, you answer out
            loud, and he scores it the way that room would — a hiring panel and
            an admissions officer want different things.
          </>
        }
        lead="Pick the room you're walking into. Felix asks real questions and judges your answer the way that panel would."
        items={INTERVIEW_TYPES}
        hrefFor={(t) => `/practice?interview=${t.id}`}
        columns={3}
        upsellHeading="Practicing for something specific?"
        upsellBody={
          <>
            Premium adds interview practice by type, plus camera coaching:
            posture, eye contact and what your hands do when you&apos;re
            thinking, which is most of what a panel actually reads.
          </>
        }
      />
    </RequireAuth>
  );
}
