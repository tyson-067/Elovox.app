import { TRIAL_DAYS } from "./pricing";

// One source of truth for the pricing FAQ, so the on-page accordion
// (app/pricing/page.tsx) and the FAQPage structured data (app/pricing/layout.tsx)
// can never say different things. Plain strings, because the same text has to
// serve both a React render and a JSON-LD block that search engines read.
export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ: FaqItem[] = [
  {
    q: `How does the ${TRIAL_DAYS}-day free trial work?`,
    a: `You get full Premium access for ${TRIAL_DAYS} days, free, on the monthly and annual plans. We only charge when the trial ends, and you can cancel any time before then and pay nothing. The weekly plan has no trial. It's charged from the day you start. If you'd rather pay today than track a trial, tick "Skip the trial" before you check out.`,
  },
  {
    q: "Why is the annual plan so much cheaper per week?",
    a: "Committing for longer lets us plan ahead, so we pass the saving back to you. Weekly is the flexible rate; annual is the best value: the same Premium, at a fraction of the weekly price.",
  },
  {
    q: "Can I switch or cancel later?",
    a: "Any time. Switch between weekly, monthly, and annual whenever you like, and cancel in a couple of clicks, no email, no phone call.",
  },
  {
    q: "Does Premium give me more Daily Minute attempts?",
    // The old last sentence promised a ceiling "set well above a full day of
    // real practice, so you'll never meet it by actually practicing". The
    // daily cap it described (120, app/api/analyze/route.ts) is genuinely out
    // of reach, but it is not the binding one: lib/rateLimit.ts caps analyze
    // at 12 an hour per user, fails closed, and is checked before entitlement
    // is resolved, so Premium does not exempt you. A library speech runs 30 to
    // 45 seconds and analysis takes about 20, so a determined session reaches
    // twelve inside twenty minutes. Naming both numbers is the only version
    // of this answer that stays true for the person it happens to.
    a: "No, and that one is on purpose. The Daily Minute is three attempts a day on every plan, because it's the same topic for everybody and the scores are only comparable if everyone gets the same number of goes at it. What Premium unlocks is everything else: the speech library, your own material, interview practice, social skills and custom speeches, with no three-a-day limit like the Daily Minute. There is a fair-use ceiling to stop automated abuse, about a dozen recordings an hour and 120 a day. That's more than a hard practice session, but it isn't infinite, which is why we don't say unlimited.",
  },
  {
    q: "Is the Free plan really free forever?",
    a: "Yes. The daily speech, three attempts, and a Felix feedback report on every one of them stay free for as long as you want them. Premium adds the other coaching modes, lifts the three-a-day limit on them, and turns the report into the deeper version with strengths and drills.",
  },
];
