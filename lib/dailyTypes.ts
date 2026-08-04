/**
 * The Daily Minute's shape, in a module with no runtime dependencies.
 *
 * It was declared inside `app/api/daily/route.ts`, which is fine until
 * something outside that route needs it — and importing a type from a route
 * module drags the route's imports (firebase-admin, the Gemini client) along
 * for the ride. Split out so `lib/dailyFallback.ts` and anything else can name
 * the shape without paying for the route.
 */
export interface DailyChallenge {
  date: string;
  title: string;
  topic: string; // the subject to speak about, in one phrase
  bullets: string[]; // exactly three angles to hit while improvising
  scenario: string;
  theme: string;
  focus: string;
  /**
   * False when this came from the canned bank because generation failed.
   * The client uses it to avoid caching or publishing a fallback as the
   * day's challenge, otherwise one request during a Gemini outage would
   * pin canned content for that device (and every other user, via the
   * shared doc) for the rest of the day.
   */
  generated: boolean;
}
