"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { getCategory, pickPrompt } from "@/lib/categories";
import { getSpeech } from "@/lib/speeches";
import { getInterviewType, pickInterviewQuestion } from "@/lib/interviews";
import { GOALS } from "@/lib/goals";
import { usePlan } from "@/lib/plan";
import { analyzeRecording, AnalysisError } from "@/lib/analyze";
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
import { readGeneratedSpeech } from "@/lib/generated";
import type { CategoryId, GoalId, InterviewTypeId, PracticeMode } from "@/lib/types";

type RecState = "idle" | "recording" | "analyzing" | "error";

const FRAMES_PER_RECORDING = 10;

// Hard ceiling on a single take. The analyze route rejects anything longer,
// and a runaway recording (device left on) shouldn't silently balloon the
// upload — so we stop cleanly and analyse what we have.
const MAX_RECORDING_SEC = 300;

/** What a finished take carries into analysis — kept so a failed analysis
 *  can be retried without making the user perform the whole thing again. */
interface Take {
  audioBlob: Blob;
  durationSec: number;
  frames?: string[];
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * What the user is practicing, resolved from the query string:
 *   ?daily=1              the universal 1-minute challenge (free + premium)
 *   ?speech=<id>          a speech from the Premium library
 *   ?gen=<key>            a speech Felix just wrote (sessionStorage handoff)
 *   ?interview=<type>     interview practice
 *   ?category=<id>        the user's own material
 */
function RecordingScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { plan, isPremium } = usePlan();

  const isDaily = params.get("daily") === "1";
  const speech = getSpeech(params.get("speech") ?? "");
  const interviewId = params.get("interview") as InterviewTypeId | null;
  const genKey = params.get("gen");

  const mode: PracticeMode = isDaily
    ? "daily"
    : speech
      ? "library"
      : interviewId
        ? "interview"
        : genKey
          ? "custom"
          : "own";

  // Analysis categories are coarser than practice modes — everything that
  // is "read this script aloud" scores as a prepared speech.
  const category: CategoryId =
    mode === "interview"
      ? "job-interview"
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

  // Interview questions reroll on demand, so this is state rather than a memo.
  const [question, setQuestion] = useState(() =>
    interviewId ? pickInterviewQuestion(interviewId) : ""
  );

  // Stable for the life of the screen — a memo, not state + effect.
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
        if (!cancelled) setDailyError("Couldn't load today's challenge. Try again in a moment.");
      });
    return () => {
      cancelled = true;
    };
  }, [isDaily]);

  // What the user performs, and its heading. The daily challenge is improv:
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
        : mode === "interview"
          ? question
          : ownPrompt;

  const heading = isDaily
    ? (daily?.title ?? "Today's challenge")
    : speech
      ? speech.title
      : generated
        ? generated.title
        : mode === "interview"
          ? getInterviewType(interviewId!).name
          : cat.name;

  const scenario = isDaily
    ? daily?.scenario
    : speech
      ? speech.scenario
      : generated?.scenario;

  // Scripts are read verbatim; the daily challenge, interview questions and
  // open prompts are answered/improvised in the speaker's own words.
  const isScript = mode !== "interview" && mode !== "own" && mode !== "daily";

  const [goalId, setGoalId] = useState<GoalId | null>(null);
  const [videoOn, setVideoOn] = useState(false);
  const [state, setState] = useState<RecState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  // True when the last error is worth retrying with the SAME take (server
  // busy / offline) rather than re-recording — drives the "Try again" button.
  const [canRetryTake, setCanRetryTake] = useState(false);
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

  const stopEverything = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (maxStopRef.current) {
      clearTimeout(maxStopRef.current);
      maxStopRef.current = null;
    }
    samplerRef.current?.stop();
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
      if (canvas.width !== w * dpr) {
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
      ctx.fillStyle = "#e8792f";
      const mid = h / 2;
      for (let i = 0; i < levels.length; i++) {
        const amp = Math.max(0.015, levels[i]) * (h * 0.46);
        const x = w - (levels.length - i) * (barW + gap);
        ctx.fillRect(x, mid - amp, barW, amp * 2);
      }

      setElapsed((performance.now() - startedAtRef.current) / 1000);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  // Analyse a finished take and, only on success, persist it. A failed
  // analysis throws (AnalysisError) — we never save a fabricated report, so
  // the take is held in lastTakeRef and the user can retry it as-is.
  const analyzeAndSave = useCallback(
    async (take: Take) => {
      const { audioBlob, durationSec, frames } = take;

      const analysis = await analyzeRecording({
        category,
        prompt: script,
        goal: goal?.label,
        durationSec,
        audioBlob,
        isDaily,
        date: todayKey(),
        ...(frames?.length ? { frames } : {}),
      });

      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

      // The daily challenge is where levelling actually happens — beating
      // your own previous attempt is worth far more than the rep itself.
      let xpEarned: number;
      let attemptNumber: number | undefined;
      if (isDaily) {
        const result = await recordChallengeAttempt({
          score: analysis.overall,
          sessionId: id,
        });
        xpEarned = result.attempt?.xp ?? 0;
        attemptNumber = result.attempt?.attempt;
      } else {
        xpEarned = xpForRep(analysis.overall);
        await awardPracticeXp(xpEarned);
      }

      await saveSession({
        id,
        category,
        mode,
        prompt: script,
        ...(goal ? { goal: goal.label } : {}),
        ...(speech ? { speechId: speech.id, speechTitle: speech.title } : {}),
        ...(generated ? { speechTitle: generated.title } : {}),
        ...(isDaily
          ? { challengeDate: todayKey(), speechTitle: daily?.title, attempt: attemptNumber }
          : {}),
        ...(interviewId ? { interviewType: interviewId } : {}),
        ...(frames?.length ? { withVideo: true } : {}),
        xpEarned,
        createdAt: Date.now(),
        durationSec: Math.round(durationSec),
        analysis,
      });

      router.push(`/report/${id}`);
    },
    [category, script, goal, speech, generated, daily, isDaily, interviewId, mode, router]
  );

  // Runs analysis for a take and drives the UI: success → report; failure →
  // an honest error with the take retained so "Try again" re-analyses the
  // very same recording. Nothing is saved and no daily attempt is spent on
  // a failure — the user is never charged for Felix having a bad moment.
  const runAnalysis = useCallback(
    async (take: Take) => {
      lastTakeRef.current = take;
      setErrorMsg("");
      setState("analyzing");
      try {
        await analyzeAndSave(take);
        lastTakeRef.current = null;
      } catch (err) {
        const retryable = err instanceof AnalysisError ? err.retryable : true;
        const msg =
          err instanceof AnalysisError
            ? err.message
            : "Something went wrong saving that. Your recording is still here — try again.";
        setErrorMsg(msg);
        setCanRetryTake(retryable);
        setState("error");
      }
    },
    [analyzeAndSave]
  );

  const start = useCallback(async () => {
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
        samplerRef.current?.stop();
        const audioBlob = new Blob(chunks, { type: recorder.mimeType });
        // Devices are no longer needed — release them so the mic light goes
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
      // won't necessarily stop itself — so finalise the take we have.
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
      // Safety net: stop cleanly at the ceiling rather than recording forever.
      maxStopRef.current = setTimeout(() => {
        if (recorderRef.current?.state === "recording") {
          cancelAnimationFrame(rafRef.current);
          recorderRef.current.stop();
        }
      }, MAX_RECORDING_SEC * 1000);
      setState("recording");
      draw(analyser, new Uint8Array(analyser.fftSize));
    } catch {
      setState("error");
      setErrorMsg(
        videoOn
          ? "Elovox needs microphone and camera access for this. Check your browser permissions and try again."
          : "Elovox needs microphone access to hear you. Check your browser's mic permission and try again."
      );
    }
  }, [videoOn, draw, runAnalysis, stopEverything]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (maxStopRef.current) {
      clearTimeout(maxStopRef.current);
      maxStopRef.current = null;
    }
    recorderRef.current?.stop();
  }, []);

  const retryAnalysis = useCallback(() => {
    if (lastTakeRef.current) runAnalysis(lastTakeRef.current);
  }, [runAnalysis]);

  const recording = state === "recording";
  const busy = state === "analyzing";

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

  // Free users get the daily challenge only — everything else is Premium.
  // The server enforces this too (the real boundary); this just avoids
  // letting a free user record a take that would be rejected. `plan === null`
  // means still loading, so we hold rather than flash the lock at a premium user.
  if (plan !== null && !isPremium && !isDaily) {
    return (
      <div className="py-16 max-w-[560px] mx-auto">
        <h1 className="text-title font-headline font-semibold text-primary">
          This one&apos;s Premium
        </h1>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant">
          Your free practice is today&apos;s daily challenge — three attempts to
          beat your own best. The speech library, your own material, interview
          practice and camera coaching are part of Premium.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            href="/pricing"
            className="btn rounded-lg bg-accent text-white font-semibold px-7 py-3"
          >
            See Premium
          </Link>
          <Link
            href="/practice?daily=1"
            className="pill rounded-[0.375rem] border border-primary/20 text-primary font-semibold px-7 py-3 hover:border-primary/40"
          >
            Today&apos;s challenge
          </Link>
        </div>
      </div>
    );
  }

  // Daily challenge, already used up: the point is three focused attempts,
  // not grinding. Premium users have the library for unlimited reps.
  if (isDaily && challenge?.complete) {
    return (
      <div className="py-16 max-w-[620px] mx-auto">
        <h1 className="text-title font-headline font-semibold text-primary">
          That&apos;s all three for today
        </h1>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant">
          Your best today was{" "}
          <span className="font-data text-primary">{challenge.bestScore}</span>. A new
          topic arrives tomorrow — the rest is rest.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            href="/progress"
            className="btn rounded-lg bg-accent text-white font-semibold px-7 py-3"
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
      <div className="py-16">
        <p className="text-lg text-on-surface-variant animate-pulse">
          Felix is picking today&apos;s topic…
        </p>
      </div>
    );
  }

  const attemptNumber = (challenge?.attempts.length ?? 0) + 1;

  return (
    <div className="py-8 md:py-12 flex flex-col items-center">
      <div className="stagger-in w-full max-w-[880px] mx-auto">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-block rounded-full bg-violet/10 text-violet text-[13px] font-semibold tracking-wide px-3 py-1">
            {heading}
          </span>
          {isDaily && (
            <>
              <span className="inline-block rounded-full bg-accent/12 text-accent text-[13px] font-semibold tracking-wide px-3 py-1">
                Attempt {attemptNumber} of {MAX_DAILY_ATTEMPTS}
              </span>
              {challenge?.bestScore !== null && challenge?.bestScore !== undefined && (
                <span className="text-[13px] font-semibold tracking-wide text-on-surface-variant">
                  Best today: <span className="font-data text-primary">{challenge.bestScore}</span> — beat it
                </span>
              )}
            </>
          )}
        </div>

        {scenario && (
          <p className="mt-3 text-base leading-6 text-on-surface-variant max-w-[60ch]">
            {scenario}
          </p>
        )}

        {isDaily && daily ? (
          <div className="mt-3 max-w-[60ch]">
            <p className="font-headline text-[26px] leading-9 text-primary">
              {daily.topic}
            </p>
            <p className="mt-2 text-[13px] font-semibold uppercase tracking-[0.03em] text-on-surface-variant">
              Improvise — hit these three, in your own words
            </p>
            <ul className="mt-2 space-y-2">
              {(daily.bullets ?? []).map((b, i) => (
                <li key={i} className="flex gap-3 text-lg leading-7 text-on-surface">
                  <span className="font-data text-sm text-accent mt-1">{i + 1}</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p
            className={
              isScript
                ? "mt-3 text-lg leading-8 text-on-surface max-w-[68ch]"
                : "mt-3 font-headline text-[26px] leading-9 text-primary max-w-[60ch]"
            }
          >
            {script}
          </p>
        )}

        {isDaily && daily?.focus && (
          <p className="mt-3 text-base leading-6 text-accent max-w-[60ch]">
            Felix is watching for: {daily.focus}
          </p>
        )}

        {mode === "interview" && (
          <button
            type="button"
            disabled={state !== "idle" && state !== "error"}
            onClick={() => setQuestion(pickInterviewQuestion(interviewId!, question))}
            className="mt-3 text-[13px] font-semibold text-accent underline underline-offset-4 disabled:opacity-50"
          >
            Ask me a different one
          </button>
        )}

        {/* Coaching goal: what should this delivery do to the audience? */}
        <div className="mt-5">
          <span className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            What do you want this to do?{" "}
            <span className="normal-case font-medium tracking-normal">
              (Felix judges against it)
            </span>
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {GOALS.map((g) => {
              const active = goalId === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  disabled={state !== "idle" && state !== "error"}
                  onClick={() => setGoalId(active ? null : g.id)}
                  aria-pressed={active}
                  className={`pill rounded-full border px-3.5 py-1.5 text-[13px] font-semibold tracking-wide disabled:opacity-50 ${
                    active
                      ? "border-accent bg-accent text-white"
                      : "border-primary/20 text-primary hover:border-accent/60"
                  }`}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Camera: Premium. Body language is the other half of delivery. */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!isPremium || (state !== "idle" && state !== "error")}
            onClick={() => setVideoOn((v) => !v)}
            aria-pressed={videoOn}
            className={`pill rounded-full border px-4 py-2 text-[13px] font-semibold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed ${
              videoOn
                ? "border-violet bg-violet text-white"
                : "border-primary/20 text-primary hover:border-violet/60"
            }`}
          >
            {videoOn ? "Camera on" : "Practice with camera"}
          </button>
          {isPremium ? (
            <span className="text-[13px] text-on-surface-variant">
              Felix reads posture, gestures, eye contact, expression and sway.
            </span>
          ) : (
            <span className="text-[13px] text-on-surface-variant">
              <span className="font-semibold text-violet">Premium</span> — add
              body-language coaching: posture, gestures, eye contact, sway.
            </span>
          )}
        </div>
      </div>

      {/* The stage: camera feed when on, waveform when off. Either way it's
          the dominant element on the screen. */}
      <div
        className="stagger-in mt-6 w-full max-w-[880px] mx-auto bg-primary rounded-none h-[38vh] min-h-[240px] relative overflow-hidden"
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
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 w-full h-full ${
            videoOn && recording ? "top-auto bottom-0 h-1/4 opacity-80" : ""
          }`}
        />
        {!recording && !busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <p className={state === "error" ? "text-amber text-base max-w-[46ch]" : "text-on-primary/50 text-base"}>
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
                className="btn rounded-lg bg-accent text-white font-semibold px-6 py-2.5 text-sm"
              >
                Try again — same recording
              </button>
            )}
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-accent text-base animate-pulse">
              {videoOn
                ? "Felix is watching that back — voice and body…"
                : "Felix is listening back to how that landed…"}
            </p>
          </div>
        )}
      </div>

      <div className="mt-8 flex flex-col items-center gap-5">
        <span className="font-data text-2xl text-primary tabular-nums" aria-live="off">
          {formatTime(elapsed)}
        </span>

        <div className="relative h-24 w-24">
          {recording && (
            <span className="pulse-ring absolute inset-0 bg-accent/60" aria-hidden="true" />
          )}
          <button
            type="button"
            onClick={recording ? stop : start}
            disabled={busy}
            aria-label={recording ? "Stop recording" : "Start recording"}
            className="record-blob relative h-24 w-24 bg-accent text-white flex items-center justify-center disabled:opacity-50"
          >
            {recording ? (
              <span className="block h-7 w-7 rounded-[4px] bg-primary" />
            ) : (
              <span className="block h-8 w-8 rounded-full border-[3px] border-primary" />
            )}
          </button>
        </div>

        <span className="text-[13px] font-semibold tracking-wide text-on-surface-variant">
          {recording
            ? "Tap to finish"
            : busy
              ? "One moment"
              : state === "error"
                ? "Tap to record again"
                : "Tap to record"}
        </span>
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
