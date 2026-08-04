"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { Felix } from "@/components/FoxLogo";
import { useIsNative } from "@/lib/native";
import { NvChip } from "@/components/native/ui";
import { AnalyzingLoader } from "@/components/AnalyzingLoader";
import { getCategory, pickPrompt } from "@/lib/categories";
import { getSpeech } from "@/lib/speeches";
import { getInterviewType, pickInterviewQuestion } from "@/lib/interviews";
import { getSocialSkill, pickSocialPrompt } from "@/lib/social";
import { GOALS } from "@/lib/goals";
import { usePlan } from "@/lib/plan";
import { analyzeRecording, AnalysisError, type LiveMetrics } from "@/lib/analyze";
import { saveSession } from "@/lib/store";
import { FrameSampler } from "@/lib/frames";
import {
  fetchDailyChallenge,
  getChallengeState,
  recordChallengeAttempt,
  awardPracticeXp,
  todayKey,
  MAX_DAILY_ATTEMPTS,
  type DailyChallenge,
  type ChallengeState,
} from "@/lib/daily";
import { xpForRep } from "@/lib/levels";
import { syncReminders } from "@/lib/reminders";
import {
  clearInterviewBank,
  readGeneratedSpeech,
  readInterviewBank,
  requestInterviewQuestions,
  stashInterviewBank,
} from "@/lib/generated";
import { sanitizeText } from "@/lib/validation";
import type {
  Analysis,
  CategoryId,
  GoalId,
  InterviewTypeId,
  PracticeMode,
  SocialSkillId,
} from "@/lib/types";

type RecState = "idle" | "recording" | "analyzing" | "error";

const FRAMES_PER_RECORDING = 10;

// The Daily Minute is a ONE MINUTE exercise, so sixty seconds is the
// whole exercise, not a suggestion. It used to be advisory: the copy said "a
// minute" while the recorder happily ran on to five, which meant a 90-second
// take was scored against people who stopped at 60. The cutoff is now real
// and identical for free and Premium, because the Daily Minute is the
// same exercise for everyone.
const DAILY_LIMIT_SEC = 60;

// Everything else is untimed: Premium users practice a talk for as long as
// the talk takes. This is only a runaway guard for a device left recording,
// and it matches MAX_DURATION_SEC in /api/analyze so the client can never
// produce a take the server would reject.
const MAX_RECORDING_SEC = 600;

// Seconds-remaining marks at which a screen reader hears a warning, descending.
//
// The visible timer can't carry this. It updates ten times a second, so a live
// region on it would be sixty announcements over one Daily Minute — which is
// exactly why it was silenced, and why the fix isn't to un-silence it. What a
// speaker actually needs from a countdown is two moments: one with enough road
// left to steer the ending, and one that means land it now. Everything between
// those is noise talking over the person trying to talk.
//
// Measured from `limitSec`, so this warns before the Daily Minute's sixty AND
// before the ten-minute runaway guard cuts a long take off mid-sentence.
const SR_WARN_AT_SEC = [30, 10];

/** What a finished take carries into analysis, kept so a failed analysis
 *  can be retried without making the user perform the whole thing again.
 *  prompt/goal are FROZEN at record time so a retry can never score the old
 *  audio against a prompt the user rerolled (or a goal they changed) while
 *  sitting in the error state. */
interface Take {
  audioBlob: Blob;
  durationSec: number;
  frames?: string[];
  prompt: string;
  goal?: string;
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// The native takeover's progress ring: a 45-radius circle in a 96 box (the
// record control's wrapper), its arc fed by the same elapsed/limit numbers
// the countdown renders. Presentation only.
const DIAL_R = 45;
const DIAL_C = 2 * Math.PI * DIAL_R;

/**
 * What the user is practicing, resolved from the query string:
 *   ?daily=1              the Daily Minute (free + premium)
 *   ?speech=<id>          a speech from the Premium library
 *   ?gen=<key>            a speech Felix just wrote (sessionStorage handoff)
 *   ?interview=<type>     interview practice
 *   ?social=<skill>       social skills practice
 *   ?category=<id>        the user's own material
 */
function RecordingScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { plan, isPremium } = usePlan();
  // The iOS shell re-skins this screen (chips, the recording takeover); the
  // browser never renders any of it. Every native branch below guards on this.
  const native = useIsNative();

  const isDaily = params.get("daily") === "1";
  const speech = getSpeech(params.get("speech") ?? "");
  const interviewId = params.get("interview") as InterviewTypeId | null;
  const socialId = params.get("social") as SocialSkillId | null;
  const genKey = params.get("gen");

  const mode: PracticeMode = isDaily
    ? "daily"
    : speech
      ? "library"
      : interviewId
        ? "interview"
        : socialId
          ? "social"
          : genKey
            ? "custom"
            : "own";

  // Analysis categories are coarser than practice modes, everything that
  // is "read this script aloud" scores as a prepared speech.
  const category: CategoryId =
    mode === "interview"
      ? "job-interview"
      : mode === "social"
        ? "conversation"
        : mode === "own"
          ? ((params.get("category") ?? "general-coaching") as CategoryId)
          : "prepared-speech";
  const cat = getCategory(category);

  const [daily, setDaily] = useState<DailyChallenge | null>(null);
  const [challenge, setChallenge] = useState<ChallengeState | null>(null);
  const [dailyError, setDailyError] = useState("");

  // sessionStorage handoff from the dashboard / custom-speech page. Derived
  // during render, not in an effect: this subtree is client-only (the
  // useSearchParams Suspense boundary), so there's no SSR snapshot to
  // mismatch, and reading it is synchronous anyway.
  const generated = useMemo(
    () => (genKey ? readGeneratedSpeech(genKey) : null),
    [genKey]
  );
  const loadError =
    dailyError ||
    (genKey && !generated
      ? "That speech has expired. Generate a fresh one from the dashboard."
      : "");

  // A static bank can only ever cover the general case. The interview people
  // are actually walking into has specific questions in it: the gap in the
  // resume, the reason they left, the one thing about this company. Two ways
  // to get at those, because they suit different moments. If you already know
  // the question that scares you, type it. If you only know the situation,
  // describe it and Felix writes the bank.
  //
  // Everything the user types is sanitized before it becomes the prompt, since
  // it is both rendered on screen and forwarded to the analysis route.
  const OWN_QUESTION_MAX = 400;
  const SITUATION_MAX = 600;

  // A bank Felix already wrote is restored on arrival, so recording an answer
  // and coming back from the report doesn't silently drop it and quietly cost
  // another Gemini call to rebuild. Read during render, not in an effect: this
  // subtree is client-only (the useSearchParams Suspense boundary), so there's
  // no SSR snapshot to mismatch, and it's the same pattern readGeneratedSpeech
  // already uses above.
  const storedBank = useMemo(
    () => (interviewId ? readInterviewBank(interviewId) : null),
    [interviewId]
  );

  // Interview questions and social moments reroll on demand, so this is
  // state rather than a memo.
  const [question, setQuestion] = useState(() => {
    if (interviewId) {
      if (storedBank) return storedBank.questions[0];
      return pickInterviewQuestion(interviewId);
    }
    if (socialId) return pickSocialPrompt(socialId);
    return "";
  });

  type Composer = null | "own" | "felix";
  const [composer, setComposer] = useState<Composer>(null);
  const [ownQuestion, setOwnQuestion] = useState("");
  const [situation, setSituation] = useState(() => storedBank?.situation ?? "");
  const [bankBusy, setBankBusy] = useState(false);
  const [bankError, setBankError] = useState("");
  // Felix's generated bank, if they asked for one. Replaces the static bank
  // as the source for "ask me a different one".
  const [felixBank, setFelixBank] = useState<string[] | null>(
    storedBank?.questions ?? null
  );

  /** Next question, drawn from Felix's bank when there is one. */
  const rerollQuestion = useCallback(() => {
    if (mode === "social" && socialId) {
      setQuestion(pickSocialPrompt(socialId, question));
      return;
    }
    if (felixBank && felixBank.length > 0) {
      const pool = felixBank.filter((q) => q !== question);
      const next = (pool.length ? pool : felixBank)[
        Math.floor(Math.random() * (pool.length || felixBank.length))
      ];
      setQuestion(next);
      return;
    }
    if (interviewId) setQuestion(pickInterviewQuestion(interviewId, question));
  }, [felixBank, question, interviewId, mode, socialId]);

  const generateBank = useCallback(async () => {
    const clean = sanitizeText(situation).slice(0, SITUATION_MAX);
    if (!clean) return;
    setBankBusy(true);
    setBankError("");
    try {
      const questions = await requestInterviewQuestions({
        situation: clean,
        ...(interviewId ? { panel: getInterviewType(interviewId).name } : {}),
      });
      setFelixBank(questions);
      setQuestion(questions[0]);
      setComposer(null);
      if (interviewId) {
        stashInterviewBank(interviewId, {
          questions,
          situation: clean,
          at: Date.now(),
        });
      }
    } catch (err) {
      setBankError(
        err instanceof Error
          ? err.message
          : "Felix couldn't write those. Try again in a moment."
      );
    } finally {
      setBankBusy(false);
    }
  }, [situation, interviewId]);

  // Stable for the life of the screen, a memo, not state + effect.
  const ownPrompt = useMemo(
    () => (mode === "own" ? pickPrompt(category) : ""),
    [mode, category]
  );

  useEffect(() => {
    if (!isDaily) return;
    let cancelled = false;
    Promise.all([fetchDailyChallenge(), getChallengeState()])
      .then(([c, s]) => {
        if (cancelled) return;
        setDaily(c);
        setChallenge(s);
      })
      .catch(() => {
        if (!cancelled) setDailyError("Couldn't load today's Daily Minute. Try again in a moment.");
      });
    return () => {
      cancelled = true;
    };
  }, [isDaily]);

  // What the user performs, and its heading. The Daily Minute is improv:
  // there's no script, so `script` becomes the brief we send to Felix (topic
  // + the three points to hit) and the screen renders those as prompts, not
  // as lines to read.
  const dailyBrief = daily
    ? `Topic: ${daily.topic}\nPoints to hit:\n${(daily.bullets ?? [])
        .map((b) => `- ${b}`)
        .join("\n")}`
    : "";
  const script = isDaily
    ? dailyBrief
    : speech
      ? speech.text
      : generated
        ? generated.text
        : mode === "interview" || mode === "social"
          ? question
          : ownPrompt;

  const heading = isDaily
    ? (daily?.title ?? "The Daily Minute")
    : speech
      ? speech.title
      : generated
        ? generated.title
        : mode === "interview"
          ? getInterviewType(interviewId!).name
          : mode === "social"
            ? getSocialSkill(socialId!).name
            : cat.name;

  const scenario = isDaily
    ? daily?.scenario
    : speech
      ? speech.scenario
      : generated?.scenario;

  // Scripts are read verbatim; the Daily Minute, interview questions, social
  // moments and open prompts are answered/improvised in the speaker's own words.
  const isScript =
    mode !== "interview" && mode !== "social" && mode !== "own" && mode !== "daily";

  // The Daily Minute stops dead at sixty seconds. Everything else runs
  // until the speaker stops it, bounded only by the runaway guard.
  const limitSec = isDaily ? DAILY_LIMIT_SEC : MAX_RECORDING_SEC;

  const [goalId, setGoalId] = useState<GoalId | null>(null);
  const [videoOn, setVideoOn] = useState(false);
  const [state, setState] = useState<RecState>("idle");
  // Native takeover only: whether the one-line prompt peek is expanded to the
  // full brief. Pure presentation — nothing about the take reads it.
  const [peekOpen, setPeekOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // The only spoken account of the take: start, the countdown warnings, and the
  // stop. Nothing else on this screen says any of it out loud — the countdown
  // is a number that only changes color, and the record button's label flips
  // silently under a finger that has already left it.
  const [announcement, setAnnouncement] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  // True when the last error is worth retrying with the SAME take (server
  // busy / offline) rather than re-recording, drives the "Try again" button.
  const [canRetryTake, setCanRetryTake] = useState(false);
  // The delivery numbers the analyze stream sends the moment transcription is
  // done — shown in the loader while the coaching is still being written.
  // Cleared at the start of every analysis so a retry doesn't flash stale ones.
  const [liveMetrics, setLiveMetrics] = useState<LiveMetrics | null>(null);
  const goal = GOALS.find((g) => g.id === goalId);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const samplerRef = useRef<FrameSampler | null>(null);
  const rafRef = useRef<number>(0);
  const levelsRef = useRef<number[]>([]);
  const startedAtRef = useRef(0);
  const maxStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTakeRef = useRef<Take | null>(null);
  // Set synchronously before start()'s first await so a second Record tap
  // (while getUserMedia is still resolving) can't spin up a second capture
  // pipeline and orphan the first mic stream.
  const startingRef = useRef(false);
  // Last whole tenth of a second pushed to state, so the rAF loop can skip
  // the re-render on the ~5 frames out of every 6 that wouldn't change the
  // displayed timer.
  const lastTickRef = useRef(-1);
  // Lowest SR_WARN_AT_SEC mark already spoken this take, so each one is said
  // once. Null until the first warning; reset by start(), not by stop, so a
  // take that ends early can't leave the next one pre-warned.
  const warnedRef = useRef<number | null>(null);
  // Why the recorder stopped, read by onstop to say so. "limit" only when the
  // cutoff fired on its own — the one ending nobody chose and no one watching
  // the timer would have to ask about.
  const stopReasonRef = useRef<"user" | "limit">("user");
  // Analysis already done for a given take, so a retry that failed only at the
  // save step re-runs saveSession, NOT the metered analyze pipeline (which
  // would reserve a second daily attempt and re-bill the model).
  const pendingSaveRef = useRef<{
    take: Take;
    analysis: Analysis;
    id: string;
    xpEarned: number;
    attemptNumber?: number;
    /** The daily award's working, carried onto the session so the report can
     *  show the receipt on every later visit and not just this one. */
    xpReasons?: string[];
    leveledUpTo?: number;
    isNewBest?: boolean;
  } | null>(null);
  // False after unmount, so an analysis that finishes after the user navigated
  // away doesn't yank them to the report from wherever they went.
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const stopEverything = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (maxStopRef.current) {
      clearTimeout(maxStopRef.current);
      maxStopRef.current = null;
    }
    samplerRef.current?.stop();

    // Detach and stop the recorder BEFORE the tracks. When every track in a
    // recorder's stream ends, the UA stops the recording for us and queues a
    // `stop` event — so tearing down tracks alone made an in-progress take
    // fire onstop from a component that no longer exists, which ran the whole
    // paid analysis: a burned Daily attempt, a junk session written to the
    // user's history, and no way for them to know it happened. Clearing the
    // handlers first means the teardown is silent.
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Already torn down by the UA; nothing left to stop.
        }
      }
    }

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  useEffect(() => stopEverything, [stopEverything]);

  // Draw the level history as a symmetric bar waveform, responsive to
  // input. The inner tick schedules itself, so the callback never has to
  // reference its own binding.
  const draw = useCallback((analyser: AnalyserNode, data: Uint8Array<ArrayBuffer>) => {
    const tick = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const { clientWidth: w, clientHeight: h } = canvas;
      // Height has to be part of the test, not just a passenger inside a
      // width-triggered branch. Turning the camera on swaps the canvas from
      // h-full to h-1/4 without changing its width, so the backing store
      // stayed four times too tall: clearRect only wiped the top quarter and
      // the first frame's bars sat frozen in the middle of the strip for the
      // whole take.
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const levels = levelsRef.current;
      levels.push(Math.min(1, rms * 3.2));

      const barW = 3;
      const gap = 2;
      const maxBars = Math.floor(w / (barW + gap));
      if (levels.length > maxBars) levels.splice(0, levels.length - maxBars);

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#ff6b35";
      const mid = h / 2;
      for (let i = 0; i < levels.length; i++) {
        const amp = Math.max(0.015, levels[i]) * (h * 0.46);
        const x = w - (levels.length - i) * (barW + gap);
        ctx.fillRect(x, mid - amp, barW, amp * 2);
      }

      // Throttled to 10Hz. This used to write a float that changed every
      // frame, so React re-reconciled the entire 1,250-line recording screen
      // — both Felix SVG trees, the brief, the goal pills — at display
      // refresh rate, competing with the encoder and the frame sampler for
      // the main thread during the one operation that cannot stutter. The
      // timer only ever renders to one decimal place.
      const nowElapsed = (performance.now() - startedAtRef.current) / 1000;
      const tenths = Math.floor(nowElapsed * 10);
      if (tenths !== lastTickRef.current) {
        lastTickRef.current = tenths;
        setElapsed(nowElapsed);

        // The countdown, spoken. The marks decide WHEN to speak; what gets
        // spoken is the time actually left, and the lowest mark already
        // passed is the one that fires. Both of those are there for the same
        // reason: rAF is throttled to a stop in a backgrounded tab, so a take
        // can come back with forty seconds gone in a single tick, and "30
        // seconds left" said at T-8 is worse than silence — it's a wrong
        // number delivered with confidence. Under a second there's nothing
        // useful left to say and the stop is already on its way.
        const remaining = limitSec - nowElapsed;
        const due = SR_WARN_AT_SEC.filter((t) => remaining <= t).pop();
        if (due !== undefined && (warnedRef.current === null || due < warnedRef.current)) {
          warnedRef.current = due;
          const secs = Math.round(remaining);
          if (secs >= 1) {
            setAnnouncement(secs === 1 ? "1 second left" : `${secs} seconds left`);
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, [limitSec]);

  // Analyse a finished take and, only on success, persist it. A failed
  // analysis throws (AnalysisError), we never save a fabricated report, so
  // the take is held in lastTakeRef and the user can retry it as-is.
  const analyzeAndSave = useCallback(
    async (take: Take) => {
      const { audioBlob, durationSec, frames } = take;

      // Analyse ONLY if we haven't already for this exact take. A retry that
      // failed at the save step reuses the cached analysis, so it never
      // re-reserves a daily attempt or re-bills the model — it just re-saves.
      let cached = pendingSaveRef.current;
      if (!cached || cached.take !== take) {
        const analysis = await analyzeRecording({
          category,
          prompt: take.prompt, // frozen at record time, never live render
          goal: take.goal,
          durationSec,
          audioBlob,
          isDaily,
          date: todayKey(),
          ...(frames?.length ? { frames } : {}),
          // Surface the delivery numbers in the loader the instant they land,
          // several seconds before the coaching is ready.
          onMetrics: setLiveMetrics,
        });

        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

        // Cache the analysis the INSTANT it exists, before the XP step —
        // which is the expensive, already-paid-for part. It used to be cached
        // only after the awards landed, so anything throwing in between (a
        // truncated response body from the analyze call is enough) dropped a
        // billed analysis on the floor, and "Try again" re-entered this branch
        // for a second daily attempt, a second transcription and a second
        // model pass on one recording.
        cached = { take, analysis, id, xpEarned: 0 };
        pendingSaveRef.current = cached;

        // The Daily Minute is where levelling actually happens, beating
        // your own previous attempt is worth far more than the rep itself.
        let xpEarned: number;
        let attemptNumber: number | undefined;
        let xpReasons: string[] | undefined;
        let leveledUpTo: number | undefined;
        let isNewBest: boolean | undefined;
        if (isDaily) {
          const result = await recordChallengeAttempt({
            score: analysis.overall,
            sessionId: id,
          });
          xpEarned = result.attempt?.xp ?? 0;
          attemptNumber = result.attempt?.attempt;
          xpReasons = result.xpReasons.length ? result.xpReasons : undefined;
          leveledUpTo = result.leveledUpTo ?? undefined;
          isNewBest = result.isNewBest;
          // Today's rep is done, so drop today's reminder — being nudged to
          // practice an hour after you practised is how a reminder gets
          // switched off for good. Not awaited: this is housekeeping, and it
          // must never sit between the user and their score.
          void syncReminders();
        } else {
          xpEarned = xpForRep(analysis.overall);
          await awardPracticeXp(xpEarned);
        }
        cached = {
          take,
          analysis,
          id,
          xpEarned,
          attemptNumber,
          xpReasons,
          leveledUpTo,
          isNewBest,
        };
        pendingSaveRef.current = cached;
      }

      const { analysis, id, xpEarned, attemptNumber, xpReasons, leveledUpTo, isNewBest } =
        cached;

      await saveSession({
        id,
        category,
        mode,
        prompt: take.prompt,
        ...(take.goal ? { goal: take.goal } : {}),
        ...(speech ? { speechId: speech.id, speechTitle: speech.title } : {}),
        ...(generated ? { speechTitle: generated.title } : {}),
        ...(isDaily
          ? { challengeDate: todayKey(), speechTitle: daily?.title, attempt: attemptNumber }
          : {}),
        ...(interviewId ? { interviewType: interviewId } : {}),
        // The skill name doubles as the session title, so Progress reads
        // "Setting boundaries", not the catch-all "Conversation" bucket.
        ...(mode === "social" && socialId
          ? { socialSkillId: socialId, speechTitle: getSocialSkill(socialId).name }
          : {}),
        ...(frames?.length ? { withVideo: true } : {}),
        xpEarned,
        ...(xpReasons ? { xpReasons } : {}),
        ...(leveledUpTo !== undefined ? { leveledUpTo } : {}),
        ...(isNewBest !== undefined ? { isNewBest } : {}),
        createdAt: Date.now(),
        durationSec: Math.round(durationSec),
        analysis,
      });

      // Saved cleanly: drop the cache so a fresh take re-analyses.
      pendingSaveRef.current = null;
      if (activeRef.current) router.push(`/report/${id}`);
    },
    [category, speech, generated, daily, isDaily, interviewId, socialId, mode, router]
  );

  // Runs analysis for a take and drives the UI: success → report; failure →
  // an honest error with the take retained so "Try again" re-analyses the
  // very same recording. Nothing is saved and no daily attempt is spent on
  // a failure, the user is never charged for Felix having a bad moment.
  const runAnalysis = useCallback(
    async (take: Take) => {
      lastTakeRef.current = take;
      setErrorMsg("");
      setLiveMetrics(null); // clear any numbers from a previous take
      setState("analyzing");
      try {
        await analyzeAndSave(take);
        lastTakeRef.current = null;
      } catch (err) {
        const retryable = err instanceof AnalysisError ? err.retryable : true;
        const msg =
          err instanceof AnalysisError
            ? err.message
            : "Something went wrong saving that. Your recording is still here. Try again.";
        setErrorMsg(msg);
        setCanRetryTake(retryable);
        setState("error");
      }
    },
    [analyzeAndSave]
  );

  const start = useCallback(async () => {
    // Re-entry guard: a second tap while getUserMedia is still resolving (or
    // while a stream is already live) would create a second pipeline and
    // orphan the first mic stream. startingRef is set synchronously before the
    // first await, so the second call bails.
    if (startingRef.current || streamRef.current) return;
    startingRef.current = true;
    setErrorMsg("");
    setCanRetryTake(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: videoOn ? { width: { ideal: 1280 }, facingMode: "user" } : false,
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);

      // Record audio only, even with the camera on: the transcript comes
      // from audio, and body language is read from sampled frames. Keeps
      // the upload small and AssemblyAI happy.
      const recorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()));
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        // The one async continuation in this file that was missing the
        // activeRef guard. Belt to stopEverything's braces: if this fires
        // after unmount for any reason, nothing here should run — everything
        // below it spends money and writes to the user's history.
        if (!activeRef.current) return;
        // Said first, before the teardown, because this is the moment the user
        // is waiting to hear about. The analysing state that follows announces
        // itself (AnalyzingLoader is a polite live region), so this only has to
        // cover the ending — and whether it was theirs or the clock's.
        setAnnouncement(
          stopReasonRef.current === "limit"
            ? "Time's up. Recording stopped."
            : "Recording stopped."
        );
        if (maxStopRef.current) {
          clearTimeout(maxStopRef.current);
          maxStopRef.current = null;
        }
        const durationSec = (performance.now() - startedAtRef.current) / 1000;
        // Grab the frames while the sampler still has them, then stop it.
        const frames =
          videoOn && samplerRef.current
            ? samplerRef.current.collect(FRAMES_PER_RECORDING)
            : undefined;
        // `dispose`, not `stop`: the frames have been collected, and the
        // sampler was holding every one it buffered — up to 150 base64 JPEGs
        // — alive for the rest of the session. Stopping the timer never
        // released them.
        samplerRef.current?.dispose();
        samplerRef.current = null;
        const audioBlob = new Blob(chunks, { type: recorder.mimeType });
        // Devices are no longer needed, release them so the mic light goes
        // off while Felix works.
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        stopEverything();

        if (audioBlob.size === 0) {
          // The recorder produced nothing (permission yanked mid-take, an
          // instant error). Don't ship an empty blob into the pipeline.
          setErrorMsg(
            "That take didn't capture any audio. Check your microphone and record again."
          );
          setCanRetryTake(false);
          setState("error");
          return;
        }
        await runAnalysis({
          audioBlob,
          durationSec,
          // Freeze the brief with the take: during recording `locked` is true,
          // so script/goal can't change, but they CAN after the take lands in
          // the error state, and a retry must score against the same brief.
          prompt: script,
          ...(goal ? { goal: goal.label } : {}),
          ...(frames?.length ? { frames } : {}),
        });
      };
      // A device-level failure (mic unplugged, browser kills the stream)
      // fires onerror; without this the UI would sit in "recording" forever.
      recorder.onerror = () => {
        try {
          recorder.stop();
        } catch {
          /* already stopped */
        }
      };
      // If the OS or a Bluetooth handoff ends the mic track, MediaRecorder
      // won't necessarily stop itself, so finalise the take we have.
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (recorder.state !== "inactive") {
            try {
              recorder.stop();
            } catch {
              /* already stopping */
            }
          }
        };
      });
      recorderRef.current = recorder;

      levelsRef.current = [];
      startedAtRef.current = performance.now();

      if (videoOn && videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
        samplerRef.current = new FrameSampler(videoRef.current);
        samplerRef.current.start(startedAtRef.current);
      }

      // Timeslice: flush a chunk every second instead of buffering one giant
      // blob for the whole take. This is what keeps long recordings intact —
      // if anything interrupts, we still have every second up to that point.
      recorder.start(1000);
      // The cutoff. For the Daily Minute this IS the exercise ending at
      // sixty seconds; for every other mode it's just the runaway guard.
      // Either way we stop cleanly and analyze what we have.
      maxStopRef.current = setTimeout(() => {
        if (recorderRef.current?.state === "recording") {
          stopReasonRef.current = "limit";
          cancelAnimationFrame(rafRef.current);
          recorderRef.current.stop();
        }
      }, limitSec * 1000);
      warnedRef.current = null;
      stopReasonRef.current = "user";
      setState("recording");
      // The mic is live from here. Sighted users get a pulsing ring, a moving
      // waveform and a running clock; without this the only signal was a
      // button whose label had quietly become "Stop recording".
      setAnnouncement(
        isDaily ? "Recording started. 60 seconds." : "Recording started."
      );
      draw(analyser, new Uint8Array(analyser.fftSize));
    } catch (err) {
      // Hand the devices back. Only the getUserMedia call itself is a
      // permission problem; anything after it (AudioContext, MediaRecorder,
      // the camera preview) throws with the stream already open, and
      // returning without releasing it left the mic and camera lights on
      // with no take running and no way to turn them off but a reload.
      stopEverything();
      const denied =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "SecurityError");
      setState("error");
      setErrorMsg(
        denied
          ? videoOn
            ? "Elovox needs microphone and camera access for this. Check your browser permissions and try again."
            : "Elovox needs microphone access to hear you. Check your browser's mic permission and try again."
          : // Not a permission problem: no device at all, one already held by
            // another app, or a browser that couldn't start the recorder.
            // Telling these people to check permissions they have already
            // granted just sends them round in circles.
            "Couldn't start recording. Make sure no other app is using your microphone, then try again."
      );
    } finally {
      startingRef.current = false;
    }
  }, [videoOn, limitSec, isDaily, draw, runAnalysis, stopEverything, script, goal]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (maxStopRef.current) {
      clearTimeout(maxStopRef.current);
      maxStopRef.current = null;
    }
    // Only a live recorder can be stopped — calling stop() on an inactive
    // one throws InvalidStateError. Reachable by tapping Stop at the same
    // moment the sixty-second cutoff fires, or just after the mic track
    // ended on its own, which threw straight out of the click handler.
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        /* it finished between the check and the call */
      }
    }
  }, []);

  /**
   * Throw the take away and come back out of the booth.
   *
   * NOT `stop`. Stopping ends the recording and runs the analysis — which
   * spends a daily attempt and real money at two providers. This is the other
   * thing a person wants from a recording screen: "forget it, I wasn't ready".
   *
   * `stopEverything` is what makes it safe: it detaches the recorder's
   * handlers BEFORE tearing down the tracks, so `onstop` never fires and the
   * pipeline is never entered. Nothing is analysed, nothing is saved, no
   * attempt is spent.
   */
  const discardTake = useCallback(() => {
    stopEverything();
    levelsRef.current = [];
    setElapsed(0);
    setState("idle");
  }, [stopEverything]);

  const retryAnalysis = useCallback(() => {
    if (lastTakeRef.current) runAnalysis(lastTakeRef.current);
  }, [runAnalysis]);

  const recording = state === "recording";
  const busy = state === "analyzing";
  // Nothing about the brief may change once a take is under way, or the
  // report would be scored against a prompt the speaker never heard.
  const locked = state !== "idle" && state !== "error";

  if (loadError) {
    return (
      <div className="py-16 max-w-[560px] mx-auto">
        <p className="text-lg text-on-surface-variant">{loadError}</p>
        <Link href="/dashboard" className="mt-4 inline-block font-semibold text-primary underline">
          Back to practice
        </Link>
      </div>
    );
  }

  // Free users get the Daily Minute only, everything else is Premium.
  // The server enforces this too (the real boundary); this just avoids
  // letting a free user record a take that would be rejected. `plan === null`
  // means still loading, so we hold rather than flash the lock at a premium user.
  if (plan !== null && !isPremium && !isDaily) {
    return (
      <div className="py-16 max-w-[560px] mx-auto">
        <Felix mood="coach" className="mb-4 h-24 w-24" />
        <h1 className="text-title font-headline font-semibold text-primary">
          This one&apos;s Premium
        </h1>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant">
          Your free practice is today&apos;s Daily Minute, three attempts to
          beat your own best. The speech library, your own material, interview
          practice, social skills and camera coaching are part of Premium.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            href="/pricing"
            className="btn rounded-lg bg-accent-strong text-white font-semibold px-7 py-3 web-only"
          >
            See Premium
          </Link>
          <Link
            href="/practice?daily=1"
            className="pill rounded-[0.375rem] border border-primary/20 text-primary font-semibold px-7 py-3 hover:border-primary/40"
          >
            The Daily Minute
          </Link>
        </div>
      </div>
    );
  }

  // Daily Minute, already used up: the point is three focused attempts,
  // not grinding. Premium users have the library for unlimited reps.
  if (isDaily && challenge?.complete) {
    return (
      <div className="py-16 max-w-[620px] mx-auto">
        <Felix mood="cheer" animate className="mb-4 h-24 w-24" />
        <h1 className="text-title font-headline font-semibold text-primary">
          That&apos;s all three for today
        </h1>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant">
          Your best today was{" "}
          <span className="font-data text-primary">{challenge.bestScore}</span>. A new
          topic arrives tomorrow, the rest is rest.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            href="/progress"
            className="btn rounded-lg bg-accent-strong text-white font-semibold px-7 py-3"
          >
            See your progress
          </Link>
          <Link
            href="/dashboard"
            className="pill rounded-[0.375rem] border border-primary/20 text-primary font-semibold px-7 py-3 hover:border-primary/40"
          >
            Back to practice
          </Link>
        </div>
      </div>
    );
  }

  if (isDaily && !daily) {
    return (
      <div className="py-16 flex items-center gap-4">
        <Felix mood="listening" className="h-16 w-16" />
        <p className="text-lg text-on-surface-variant animate-pulse">
          Felix is picking today&apos;s topic…
        </p>
      </div>
    );
  }

  const attemptNumber = (challenge?.attempts.length ?? 0) + 1;

  return (
    // Two columns from `lg` up.
    //
    // This was one 880px column centred in the page, which on any desktop
    // meant a narrow ribbon of text with several hundred pixels of empty
    // margin either side, and the record button pushed below the fold by a
    // brief the speaker was still reading. Splitting it puts the thing you
    // read on the left and the thing you press on the right, both in view at
    // once, and the stage sticks so the button stays reachable however long
    // the brief runs. Below `lg` it stacks back to the original order:
    // brief, stage, button.
    <div className="py-8 md:py-12">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start lg:gap-10">
        <div className="stagger-in min-w-0 lg:col-span-7">
          {/* An <h1>, not a styled <span>. In its primary state this screen
              had no heading element at all, so "skip to the heading" — the
              way most screen-reader users orient on a new page — landed
              nowhere, on the one screen where knowing what you're about to
              record actually matters. */}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="inline-block rounded-full bg-violet/10 text-violet text-[13px] font-semibold tracking-wide px-3 py-1">
              {heading}
            </h1>
            {isDaily && (
              <>
                <span className="inline-block rounded-full bg-accent/12 text-accent-strong text-[13px] font-semibold tracking-wide px-3 py-1">
                  Attempt {attemptNumber} of {MAX_DAILY_ATTEMPTS}
                </span>
                {challenge?.bestScore !== null && challenge?.bestScore !== undefined && (
                  <span className="text-[13px] font-semibold tracking-wide text-on-surface-variant">
                    Best today: <span className="font-data text-primary">{challenge.bestScore}</span>, beat it
                  </span>
                )}
              </>
            )}
          </div>

          {scenario && (
            <p
              className={
                "mt-3 text-base leading-6 text-on-surface-variant max-w-[60ch]" +
                (native ? " nv-subhead" : "")
              }
            >
              {scenario}
            </p>
          )}

          {isDaily && daily ? (
            <div className="mt-3 max-w-[60ch]">
              <p
                className={
                  "font-headline text-[26px] leading-9 text-primary" +
                  (native ? " nv-title" : "")
                }
              >
                {daily.topic}
              </p>
              <p
                className={
                  "mt-2 text-[13px] font-semibold uppercase tracking-[0.03em] text-on-surface-variant" +
                  (native ? " nv-caption" : "")
                }
              >
                Improvise. Hit these three, in your own words.
              </p>
              <ul className="mt-2 space-y-2">
                {(daily.bullets ?? []).map((b, i) => (
                  <li
                    key={i}
                    className={
                      "flex gap-3 text-lg leading-7 text-on-surface" +
                      (native ? " nv-body" : "")
                    }
                  >
                    <span className="font-data text-sm text-accent-strong mt-1">{i + 1}</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              {/* People arrive at an improv challenge with no idea what good
                  practice looks like, hit record cold, ramble, and score badly
                  for reasons that have nothing to do with speaking.

                  This was six numbered paragraphs, which is more reading than
                  the exercise itself is speaking, sitting between someone and
                  the record button. Two points, because these two are where
                  nearly every bad first minute actually goes wrong: people
                  script it, and people run long on point one and then trail
                  off. The rest was good advice nobody was going to read. */}
              <div className="card-warm mt-5 p-4">
                <p
                  className={
                    "text-[13px] font-semibold uppercase tracking-[0.03em] text-on-surface-variant" +
                    (native ? " nv-caption" : "")
                  }
                >
                  How to run this
                </p>
                <ol
                  className={
                    "mt-2.5 space-y-2 text-[15px] leading-6 text-on-surface-variant" +
                    (native ? " nv-subhead" : "")
                  }
                >
                  <li>
                    <span className="font-semibold text-primary">
                      Don&apos;t script it.
                    </span>{" "}
                    Decide your first line and your last line, nothing else.
                    Thinking while speaking is the whole skill.
                  </li>
                  <li>
                    <span className="font-semibold text-primary">
                      Twenty seconds a point, then land it.
                    </span>{" "}
                    One example each, and stop talking on your last sentence
                    rather than trailing off.
                  </li>
                </ol>
              </div>
            </div>
          ) : (
            <p
              className={
                isScript
                  ? "mt-3 text-lg leading-8 text-on-surface max-w-[68ch]" +
                    (native ? " nv-body" : "")
                  : "mt-3 font-headline text-[26px] leading-9 text-primary max-w-[60ch]" +
                    (native ? " nv-title" : "")
              }
            >
              {script}
            </p>
          )}

          {isDaily && daily?.focus && (
            <p className="mt-3 text-base leading-6 text-accent-strong max-w-[60ch]">
              Felix is watching for: {daily.focus}
            </p>
          )}

          {mode === "social" && (
            <div className="mt-3">
              <button
                type="button"
                disabled={locked}
                onClick={rerollQuestion}
                className="text-[13px] font-semibold text-accent-strong underline underline-offset-4 disabled:opacity-50"
              >
                Give me a different one
              </button>
            </div>
          )}

          {mode === "interview" && (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  disabled={locked}
                  onClick={rerollQuestion}
                  className="text-[13px] font-semibold text-accent-strong underline underline-offset-4 disabled:opacity-50"
                >
                  Ask me a different one
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setComposer((c) => (c === "own" ? null : "own"));
                    setOwnQuestion("");
                  }}
                  aria-expanded={composer === "own"}
                  className="text-[13px] font-semibold text-primary/70 underline underline-offset-4 hover:text-primary disabled:opacity-50"
                >
                  {composer === "own" ? "Never mind" : "Write my own question"}
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setComposer((c) => (c === "felix" ? null : "felix"));
                    setBankError("");
                  }}
                  aria-expanded={composer === "felix"}
                  className="text-[13px] font-semibold text-primary/70 underline underline-offset-4 hover:text-primary disabled:opacity-50"
                >
                  {composer === "felix"
                    ? "Never mind"
                    : "Felix writes questions for my interview"}
                </button>
              </div>

              {felixBank && (
                <p className="mt-2 text-[13px] text-on-surface-variant">
                  Asking from {felixBank.length} questions Felix wrote for your
                  situation.{" "}
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      setFelixBank(null);
                      setSituation("");
                      if (interviewId) {
                        clearInterviewBank(interviewId);
                        setQuestion(pickInterviewQuestion(interviewId));
                      }
                    }}
                    className="font-semibold text-primary underline underline-offset-4 disabled:opacity-50"
                  >
                    Back to the standard bank
                  </button>
                </p>
              )}

              {composer === "own" && (
                <div className="mt-3 max-w-[60ch]">
                  <label
                    htmlFor="own-question"
                    className="block text-[13px] font-semibold tracking-wide text-on-surface-variant"
                  >
                    The question you are actually dreading
                  </label>
                  <textarea
                    id="own-question"
                    rows={3}
                    maxLength={OWN_QUESTION_MAX}
                    value={ownQuestion}
                    onChange={(e) => setOwnQuestion(e.target.value)}
                    placeholder="Why did you leave your last role after only seven months?"
                    className="card input-glow mt-1.5 w-full px-4 py-3 text-base text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={locked || !sanitizeText(ownQuestion)}
                      onClick={() => {
                        const clean = sanitizeText(ownQuestion).slice(0, OWN_QUESTION_MAX);
                        if (!clean) return;
                        setQuestion(clean);
                        setComposer(null);
                      }}
                      className="btn rounded-lg bg-accent-strong px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                    >
                      Ask me this
                    </button>
                    <span className="text-[13px] text-on-surface-variant">
                      Felix scores your answer exactly as he would any other
                      question for this panel.
                    </span>
                  </div>
                </div>
              )}

              {composer === "felix" && (
                <div className="mt-3 max-w-[60ch]">
                  <label
                    htmlFor="situation"
                    className="block text-[13px] font-semibold tracking-wide text-on-surface-variant"
                  >
                    What are you interviewing for?
                  </label>
                  <p className="mt-1 text-[13px] leading-5 text-on-surface-variant">
                    The role, the place, and anything you think they will push
                    on. The more specific you are, the less generic the questions.
                  </p>
                  <textarea
                    id="situation"
                    rows={4}
                    maxLength={SITUATION_MAX}
                    value={situation}
                    onChange={(e) => setSituation(e.target.value)}
                    placeholder="Second-round interview for a junior data analyst role at a hospital. I'm switching from retail, I have a certificate but no degree in it, and there's an eight-month gap on my resume."
                    className="card input-glow mt-2 w-full px-4 py-3 text-base text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none"
                  />
                  {bankError && (
                    <p role="alert" className="mt-2 text-[13px] leading-5 text-error">
                      {bankError}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={locked || bankBusy || !sanitizeText(situation)}
                      onClick={generateBank}
                      className="btn rounded-lg bg-accent-strong px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                    >
                      {bankBusy ? "Felix is writing…" : "Write my questions"}
                    </button>
                    <span className="text-[13px] text-on-surface-variant">
                      You will get a set to work through, and you can reroll
                      within it.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Coaching goal: what should this delivery do to the audience? */}
          <div className="mt-5">
            <span
              className={
                "text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant" +
                (native ? " nv-caption" : "")
              }
            >
              What do you want this to do?{" "}
              <span className="normal-case font-medium tracking-normal">
                (Felix judges against it)
              </span>
            </span>
            <div className={"mt-2 flex flex-wrap gap-2" + (native ? " nv-grid-2" : "")}>
              {GOALS.map((g) => {
                const active = goalId === g.id;
                if (native) {
                  return (
                    <NvChip
                      key={g.id}
                      selected={active}
                      disabled={state !== "idle" && state !== "error"}
                      onClick={() => setGoalId(active ? null : g.id)}
                      className="disabled:opacity-50"
                    >
                      {g.label}
                    </NvChip>
                  );
                }
                return (
                  <button
                    key={g.id}
                    type="button"
                    disabled={state !== "idle" && state !== "error"}
                    onClick={() => setGoalId(active ? null : g.id)}
                    aria-pressed={active}
                    className={`pill rounded-full border px-3.5 py-1.5 text-[13px] font-semibold tracking-wide disabled:opacity-50 ${
                      active
                        ? "border-accent bg-accent-strong text-white"
                        : "border-primary/20 text-primary hover:border-accent/60"
                    }`}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Camera: Premium. Body language is the other half of delivery.
              Rendered as a labeled SWITCH, not a pill whose label changes:
              "Practice with camera" as a button read like a separate mode you
              enter, when it has always been an option on the same take. The
              label stays put; only the switch moves. */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={videoOn}
              disabled={!isPremium || (state !== "idle" && state !== "error")}
              onClick={() => setVideoOn((v) => !v)}
              className="group flex items-center gap-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span
                aria-hidden="true"
                className={`relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors ${
                  videoOn ? "bg-violet" : "bg-primary/20 group-hover:bg-primary/30"
                }`}
              >
                {/* Knob: pinned at left-0.5, top-0.5, and slid right by exactly
                    its own travel (20px = translate-x-5) when on. Explicit
                    left, and a standard translate step rather than an arbitrary
                    value, so it starts and lands predictably. */}
                <span
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                    videoOn ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </span>
              <span className="text-[13px] font-semibold tracking-wide text-primary">
                Practice with camera
              </span>
            </button>
            {isPremium ? (
              <span className="text-[13px] text-on-surface-variant">
                Felix reads posture, gestures, eye contact, expression and sway.
              </span>
            ) : (
              <span className="text-[13px] text-on-surface-variant">
                <span className="font-semibold text-violet">Premium</span>, add
                body-language coaching: posture, gestures, eye contact, sway.
              </span>
            )}
          </div>
        </div>

        {/* The stage and the button, the half of the screen you act on.
            While the app records, this whole column becomes the screen: the
            nv-takeover class lifts it to a fixed, dark, full-screen booth
            (stage, timer, stop control — all already inside, so no node
            moves). Web never sees the class. */}
        <div
          className={
            "min-w-0 lg:col-span-5 lg:sticky lg:top-28" +
            (native && recording ? " nv-takeover" : "")
          }
        >
          {native && recording && (
            // The booth's own header. A recording screen with no way off it
            // reads as a trap, and the shell's chrome is gone by design while
            // the takeover is up — so the booth carries its own: a way out, a
            // reminder of which attempt this is, and one word saying the mic
            // is hot.
            //
            // The two controls do DIFFERENT things and must keep doing so: the
            // big square below ends the take and sends it to be scored (a
            // daily attempt, a paid pipeline); this X throws it away and spends
            // nothing.
            <div className="mb-3.5 flex items-center gap-3">
              <button
                type="button"
                onClick={discardTake}
                className="nv-booth-btn"
                aria-label="Discard this take and go back"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
              {isDaily && (
                <span className="nv-booth-meta">
                  Attempt {attemptNumber} of {MAX_DAILY_ATTEMPTS}
                </span>
              )}
              <span className="nv-booth-live ml-auto">Live</span>
            </div>
          )}
          {native && recording && (
            // The brief, collapsed to one peek line so the speaker can glance
            // without reading. Tap to expand. Color inherits from the takeover
            // (nv-footnote's ink would vanish on the always-dark booth).
            <button
              type="button"
              onClick={() => setPeekOpen((o) => !o)}
              aria-expanded={peekOpen}
              className={`nv-footnote mb-3 min-h-11 w-full text-left opacity-75 ${
                peekOpen ? "max-h-40 overflow-y-auto whitespace-pre-line" : "truncate"
              }`}
              style={{ color: "inherit" }}
            >
              {script}
            </button>
          )}
          {/* The stage: camera feed when on, waveform when off. Either way it's
              the dominant element on the screen. */}
          <div
            className={
              "practice-stage stagger-in w-full bg-oxford rounded-xl h-[34vh] min-h-[220px] relative overflow-hidden" +
              (native && recording ? " flex-1" : "")
            }
            style={{ animationDelay: "150ms" }}
          >
            <video
              ref={videoRef}
              muted
              playsInline
              className={`absolute inset-0 h-full w-full object-cover ${
                videoOn && recording ? "" : "hidden"
              }`}
            />
            {/* Two fully separate class sets rather than adding overrides: an
                added `h-1/4` loses to the base `h-full` (source order), so with
                the camera on the waveform used to cover the whole preview
                instead of sitting as a bottom strip. */}
            <canvas
              ref={canvasRef}
              className={
                videoOn && recording
                  ? "absolute inset-x-0 bottom-0 h-1/4 w-full opacity-80"
                  : "absolute inset-0 h-full w-full"
              }
            />
            {!recording && !busy && (
              // The scrim earns its keep in the error state: the canvas behind
              // still holds the frozen take at full amplitude, and amber text
              // straight over orange bars is unreadable (seen on the no-speech
              // error in the iOS sim). Ghosting the take through the stage's
              // own dark also backs up "Try again, same recording" — the take
              // is visibly still there.
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-oxford/85 px-6 text-center">
                {/* role="alert" because this <p> is the ONLY surface for
                    "Elovox needs microphone access", "that take didn't
                    capture any audio", and every analysis failure. Without
                    it a screen-reader user pressed record and got silence,
                    with no indication anything had gone wrong. */}
                <p
                  role={state === "error" ? "alert" : undefined}
                  className={state === "error" ? "text-amber text-base max-w-[46ch]" : "text-on-primary/50 text-base"}
                >
                  {state === "error"
                    ? errorMsg
                    : videoOn
                      ? "Stand back so Felix can see your hands. Press record when you're ready."
                      : "Press record when you're ready. Take a breath first."}
                </p>
                {state === "error" && canRetryTake && (
                  <button
                    type="button"
                    onClick={retryAnalysis}
                    className="btn rounded-lg bg-accent-strong text-white font-semibold px-6 py-2.5 text-sm"
                  >
                    Try again, same recording
                  </button>
                )}
              </div>
            )}
            {busy && <AnalyzingLoader withVideo={videoOn} metrics={liveMetrics} />}
          </div>

          <div className="mt-8 flex flex-col items-center gap-5">
            {/* The Daily Minute counts DOWN, because the sixty seconds is the
                exercise and running out is the point. Everything else counts up,
                because nothing is running out. */}
            <span
              className={
                native && recording
                  ? "nv-timer nv-num"
                  : `font-data text-2xl tabular-nums ${
                      isDaily && recording && elapsed > DAILY_LIMIT_SEC - 10
                        ? "text-accent-strong"
                        : "text-primary"
                    }`
              }
              // In the takeover the timer inherits the booth's chalk; the
              // last ten seconds go live-orange, driven by the same countdown.
              style={
                native && recording && isDaily && elapsed > DAILY_LIMIT_SEC - 10
                  ? { color: "var(--nv-accent-500)" }
                  : undefined
              }
              // Hidden rather than merely silent. This node's text is rewritten
              // ten times a second; keeping it in the accessibility tree buys a
              // reading of "0:44" — punctuation a screen reader has to guess at
              // — at the cost of churning the tree for the whole take. The
              // spoken countdown is the live region below, in words.
              aria-hidden="true"
            >
              {isDaily
                ? formatTime(Math.max(0, DAILY_LIMIT_SEC - elapsed))
                : formatTime(elapsed)}
            </span>

            {/* The take, narrated. Mounted for the whole screen and not just
                while recording, because a live region has to be in the DOM
                before its text changes or the first announcement — "Recording
                started" — is the one that gets swallowed.

                Text is left in place after it's spoken rather than cleared, so
                the last thing said is also the last thing here to navigate to
                and re-read. */}
            <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {announcement}
            </span>

            <div
              className={
                "relative h-24 w-24" +
                (native && recording ? " flex items-center justify-center" : "")
              }
            >
              {recording && (
                <span className="pulse-ring absolute inset-0 bg-accent/60" aria-hidden="true" />
              )}
              {native && recording && (
                // The ring that fills with the take: same elapsed/limit pair
                // the countdown renders, drawn with the system's dial classes.
                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  viewBox="0 0 96 96"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="nv-dial-track"
                    cx="48"
                    cy="48"
                    r={DIAL_R}
                    strokeWidth="3"
                  />
                  <circle
                    className="nv-dial-arc"
                    cx="48"
                    cy="48"
                    r={DIAL_R}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={DIAL_C}
                    strokeDashoffset={DIAL_C * Math.max(0, 1 - elapsed / limitSec)}
                    transform="rotate(-90 48 48)"
                  />
                </svg>
              )}
              <button
                type="button"
                onClick={recording ? stop : start}
                disabled={busy}
                aria-label={recording ? "Stop recording" : "Start recording"}
                className="record-blob relative h-24 w-24 bg-accent-strong text-white flex items-center justify-center disabled:opacity-50"
              >
                {recording ? (
                  <span className="block h-7 w-7 rounded-[4px] bg-primary" />
                ) : (
                  <span className="block h-8 w-8 rounded-full border-[3px] border-primary" />
                )}
              </button>
            </div>

            <span
              className={
                "text-[13px] font-semibold tracking-wide text-on-surface-variant" +
                (native && recording ? " opacity-75" : "")
              }
              // Same inheritance as the peek line: the variant ink is invisible
              // on the always-dark takeover, the booth's own chalk is not.
              style={native && recording ? { color: "inherit" } : undefined}
            >
              {recording
                ? isDaily
                  ? "Tap to finish, or it stops itself at zero"
                  : "Tap to finish"
                : busy
                  ? "One moment"
                  : state === "error"
                    ? "Tap to record again"
                    : isDaily
                      ? "Tap to record. You get sixty seconds."
                      : "Tap to record"}
            </span>

            {/* Felix, waiting on you. He steps aside while a take is being
                analyzed: AnalyzingLoader puts him inside the ring up on the
                stage, and two of him on one screen is one too many. In the
                app's booth he LISTENS while you speak — eyes shut, chest bars
                alive, tail going — the same pose the loader shows him in
                right after. The web keeps his quiet idle. */}
            {!busy && (
              <Felix
                mood={recording ? (native ? "listening" : "idle") : "coach"}
                animate={!recording || native}
                className="h-20 w-20 opacity-90"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PracticePage() {
  return (
    <RequireAuth>
      <Suspense>
        <RecordingScreen />
      </Suspense>
    </RequireAuth>
  );
}
