"use client";

import { RequireAuth } from "@/components/RequireAuth";
import { PracticeCatalogPage } from "@/components/PracticeCatalogPage";
import { SOCIAL_SKILLS } from "@/lib/social";

// Social skills practice (Premium), split by the moment rather than the
// room. Most speaking isn't a speech: it's small talk, saying no, saying
// sorry. Each skill has its own bank of concrete scenes to answer out loud.

export default function SocialPage() {
  return (
    <RequireAuth>
      <PracticeCatalogPage
        title="Social skills"
        tipLabel="How does social skills practice work?"
        tip={
          <>
            Every skill has its own bank of real moments. Felix sets the scene,
            you say what you&apos;d actually say, and he scores how it would
            land on the other person.
          </>
        }
        lead="Pick the moment that trips you up, and answer it out loud, in your own words."
        items={SOCIAL_SKILLS}
        hrefFor={(s) => `/practice?social=${s.id}`}
        columns={3}
        upsellHeading="Most speaking isn't a speech"
        upsellBody={
          <>
            Premium adds practice for the everyday moments: small talk, saying
            no, apologizing well, and the rest, scored the way the other person
            would hear it.
          </>
        }
      />
    </RequireAuth>
  );
}
