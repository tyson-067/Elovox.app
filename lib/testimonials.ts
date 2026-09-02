// NOTE: nothing renders this today. The landing page's testimonial wall was
// removed in the design import (the design has no social-proof section), so
// adding an entry below will type-check, lint, test and build green and then
// appear nowhere. Add the section back to app/page.tsx first, or delete this
// file, before collecting quotes for it.
// What real users say. Rendered on the landing page, below the feature grid
// and above pricing, which is where someone deciding on the price is looking.
//
// TO ADD ONE: append an object below. Nothing else needs touching — the
// section on app/page.tsx renders itself from this array and hides entirely
// while the array is empty, so shipping with none is safe.
//
// Rules for the quote text, learned the hard way on the rest of this site:
// keep it in the person's own words, short, and specific about what changed.
// "Great app, highly recommend" is worth less than nothing here; it reads as
// invented and makes the real ones look invented too.

export type Testimonial = {
  /** The quote, in their words. One or two sentences. No quote marks. */
  quote: string;
  /** Who said it. A first name and last initial is enough. */
  name: string;
  /** Optional context, e.g. "Job interviews" or "Sales pitches". */
  context?: string;
};

export const TESTIMONIALS: Testimonial[] = [];
