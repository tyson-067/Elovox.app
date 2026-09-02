// The one take a stranger gets to hear: the landing page's sample, written
// once to public/felix-hello.mp3 by scripts/felix-voice-sample.mjs and played
// beside these words in the "What comes back" section of app/page.tsx.
//
// Import-free, because the script runs this under Node's type stripping.
// Keep it the shape every real take has (lib/felixTake.ts): a verdict, one
// thing that worked, the one thing to fix, one instruction for the next
// attempt, no scores, no dashes.

export const FELIX_SAMPLE_TAKE =
  "Nice work. You came across as confident, but your pace picked up near the end. " +
  "Your strongest idea would land harder with a pause in front of it. " +
  "Try that last section again, and give the key point a little more space.";
