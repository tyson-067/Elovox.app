"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { Reveal } from "@/components/Reveal";
import { WordReveal } from "@/components/WordReveal";
import { InfoTip } from "@/components/InfoTip";
import { Felix } from "@/components/FoxLogo";
import { useAuth } from "@/components/AuthProvider";
import {
  BOARD_SIZE,
  fetchFriendsBoard,
  fetchGlobalBoard,
  fetchMyHandle,
  saveHandle,
  suggestHandle,
  type Board,
  type BoardRow,
} from "@/lib/leaderboard";
import {
  inviteUrl,
  shareInvite,
  useInviteCode,
  type ShareOutcome,
} from "@/lib/invite";
import { REFERRAL_BONUS_XP } from "@/lib/referralShared";
import { NativeLeaderboard } from "@/components/native/NativeLeaderboard";

// The XP leaderboard.
//
// Every number on this screen was computed server-side and is read-only to
// the browser (see lib/leaderboardServer.ts and the `leaderboard` rules).
// Nothing on this page can award anything, which is the only reason a board
// like this is worth showing at all.

type Scope = "global" | "friends";

const MEDALS = ["🥇", "🥈", "🥉"];

/** The top three, given the size their rank deserves. */
function Podium({ rows }: { rows: BoardRow[] }) {
  // Second, first, third — so the winner stands in the middle.
  const order = [rows[1], rows[0], rows[2]].filter(Boolean);
  // Indexed by rank - 1, NOT by position in `order`: with fewer than three
  // rows `order` collapses (a lone #1 lands at index 0), so keying off the
  // filtered index gave the winner the second-place column height.
  const heights = ["h-32", "h-24", "h-20"];

  return (
    <div className="flex items-end justify-center gap-3 md:gap-5">
      {order.map((row) => {
        const place = row.rank;
        return (
          <div key={row.uid} className="flex w-full max-w-[9rem] flex-col items-center">
            <Felix
              mood={place === 1 ? "cheer" : "idle"}
              className={place === 1 ? "h-16 w-16" : "h-12 w-12"}
            />
            <span className="mt-1 text-2xl leading-none" aria-hidden="true">
              {MEDALS[place - 1]}
            </span>
            <span
              className={`mt-1 w-full truncate text-center text-body-sm font-semibold ${
                row.isSelf ? "text-accent-strong" : "text-primary"
              }`}
            >
              {row.handle ?? "A quiet fox"}
            </span>
            <span className="font-data text-label text-on-surface-variant">
              {row.xp.toLocaleString()} XP
            </span>
            {/* Both bars are OPAQUE fills, and that is load-bearing rather
                than cosmetic: a site backdrop paints the page ground, and a
                translucent tint (this was bg-accent/25) lets the sky through
                and has to take the ground's ink — which put a white numeral
                on pale peach at 3.6:1 over the night scenes. Shrimp Toast is
                the warm end of the palette, so "this is you" still reads at a
                glance, and the bar is a surface the numeral can sit on
                whatever is behind the page. See docs/BACKDROP_LEGIBILITY.md. */}
            <div
              className={`mt-2 w-full rounded-t-lg ${heights[place - 1]} ${
                row.isSelf ? "bg-shrimp" : "bg-surface-container"
              } grid place-items-end justify-center pb-2`}
            >
              <span className="font-data text-lg text-primary">{place}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Row({ row }: { row: BoardRow }) {
  return (
    <li
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${
        row.isSelf ? "bg-accent/12 ring-1 ring-accent/40" : ""
      }`}
    >
      <span className="w-8 shrink-0 text-right font-data text-sm text-on-surface-variant">
        {row.rank}
      </span>
      <span className="min-w-0 flex-1 truncate text-base text-on-surface">
        {row.handle ?? "A quiet fox"}
        {row.isSelf && (
          <span className="ml-2 text-label font-semibold text-accent-strong">you</span>
        )}
      </span>
      {row.streakDays > 0 && (
        <span className="shrink-0 font-data text-label text-on-surface-variant">
          <span aria-hidden="true">🔥</span> {row.streakDays}
        </span>
      )}
      <span className="shrink-0 font-data text-label text-violet">
        Lv {row.level}
      </span>
      <span className="w-20 shrink-0 text-right font-data text-sm text-primary">
        {row.xp.toLocaleString()}
      </span>
    </li>
  );
}

/** Naming yourself. Optional — an unnamed row still ranks, just anonymously. */
function HandleCard({
  handle,
  onSaved,
}: {
  handle: string | null;
  onSaved: (h: string) => void;
}) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const start = () => {
    setValue(handle ?? suggestHandle(user?.displayName));
    setError("");
    setEditing(true);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error: err } = await saveHandle(value);
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    onSaved(value.trim().replace(/\s+/g, " "));
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-body-sm leading-6 text-on-surface-variant">
          {handle ? (
            <>
              You appear as{" "}
              <span className="font-semibold text-primary">{handle}</span>.
            </>
          ) : (
            "You're showing up as a quiet fox. Pick a name and people can find you."
          )}
        </p>
        <button
          type="button"
          onClick={start}
          className="pill rounded-full border border-primary/25 px-4 py-1.5 text-label font-semibold text-primary hover:border-accent hover:text-accent-strong"
        >
          {handle ? "Change it" : "Pick a name"}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card p-4">
      <label
        htmlFor="handle"
        className="block text-label font-semibold text-primary"
      >
        Your name on the board
      </label>
      {/* Says the quiet part out loud: this is the one field on the account
          that strangers see, and it is not the name they signed up with. */}
      <p className="mt-1 text-label leading-5 text-on-surface-variant">
        Everyone on the leaderboard sees this. Your real name never appears
        here, so use whatever you&apos;re happy being called.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          id="handle"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={20}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface-lowest px-3 py-2 text-base text-on-surface"
        />
        <button
          type="submit"
          disabled={saving}
          className="btn rounded-lg bg-accent-strong px-5 py-2 text-body-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="pill rounded-full border border-primary/25 px-4 py-1.5 text-label font-semibold text-on-surface-variant"
        >
          Cancel
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-label text-error">{error}</p>}
    </form>
  );
}

/** The invite link, plus the one sentence explaining why anyone would send it. */
function InviteCard() {
  const { code, error } = useInviteCode();
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);

  async function share() {
    if (!code) return;
    setOutcome(await shareInvite(inviteUrl(code)));
  }

  return (
    <div className="card-warm p-5 md:p-6">
      <h2 className="font-headline text-xl font-semibold text-primary">
        Bring someone in
      </h2>
      <p className="mt-1.5 max-w-[52ch] text-body-sm leading-6 text-on-surface-variant">
        Send them this link. You become friends automatically, and you both get{" "}
        {REFERRAL_BONUS_XP} XP once they finish their first minute.
      </p>

      {code && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-white/70 px-3 py-2 font-data text-label text-primary">
            {inviteUrl(code)}
          </code>
          <button
            type="button"
            onClick={share}
            className="btn rounded-lg bg-accent-strong px-5 py-2 text-body-sm font-semibold text-white"
          >
            Share
          </button>
        </div>
      )}

      {outcome === "copied" && (
        <p className="mt-2 text-label font-semibold text-accent-strong" role="status">
          Link copied.
        </p>
      )}
      {outcome === "failed" && (
        <p className="mt-2 text-label text-on-surface-variant" role="status">
          Couldn&apos;t copy it. Select the link above and copy it yourself.
        </p>
      )}
      {error && <p className="mt-2 text-label text-on-surface-variant">{error}</p>}
    </div>
  );
}

function LeaderboardScreen() {
  const [scope, setScope] = useState<Scope>("global");
  const [board, setBoard] = useState<Board | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // A failed board used to be a dead end: one sentence saying "try again in a
  // moment" and no control that tries again. The only exit was killing the
  // app. This nonce is what gives the sentence a button.
  const [reloadNonce, setReloadNonce] = useState(0);

  const retry = useCallback(() => {
    setFailed(false);
    setBoard(null);
    setReloadNonce((n) => n + 1);
  }, []);

  // Clearing the old board happens in the tab's click handler, not in the
  // effect: setting state synchronously inside an effect body cascades a
  // render, and the lint rule that catches it is right to.
  const switchTo = useCallback(
    (next: Scope) => {
      // Re-tapping the tab you're already on used to blank the board for
      // good: setBoard(null) re-rendered, but React bailed on the identical
      // setScope, so the effect below never re-ran and "Counting everyone
      // up…" stayed on screen until a reload. Nothing to do if it's the
      // current scope.
      if (next === scope) return;
      setBoard(null);
      setFailed(false);
      setScope(next);
    },
    [scope]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next =
          scope === "global" ? await fetchGlobalBoard() : await fetchFriendsBoard();
        if (!cancelled) setBoard(next);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, reloadNonce]);

  // `cancelled` matters here even though the effect runs once: a slow read
  // that resolves AFTER the user has picked a name would overwrite the new
  // handle with the old one (or null), reverting the card to "You're showing
  // up as a quiet fox" while the patched board rows still showed the new name.
  const handleSetLocally = useRef(false);
  useEffect(() => {
    let cancelled = false;
    fetchMyHandle()
      .then((h) => {
        if (!cancelled && !handleSetLocally.current) setHandle(h);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Renaming patches the already-fetched board's own rows too, so the podium
  // and list update immediately instead of contradicting the handle card
  // (which showed the new name) until the next full board fetch.
  const onHandleSaved = useCallback((h: string) => {
    // Locks out a late-arriving initial read (see the effect above).
    handleSetLocally.current = true;
    setHandle(h);
    setBoard((b) =>
      b
        ? {
            ...b,
            rows: b.rows.map((r) => (r.isSelf ? { ...r, handle: h } : r)),
            self: b.self ? { ...b.self, handle: h } : b.self,
          }
        : b
    );
  }, []);

  const rows = board?.rows ?? [];
  const podium = scope === "global" ? rows.slice(0, 3) : [];
  const rest = scope === "global" ? rows.slice(3) : rows;

  return (
    <>
      {/* The board at app scale — same fetches, same server-computed numbers,
          same handle save. Renders nothing in a browser; the whole web page
          below it is native-hidden. */}
      <NativeLeaderboard
        onRetry={retry}
        scope={scope}
        onScope={switchTo}
        board={board}
        failed={failed}
        handle={handle}
        onHandleSaved={onHandleSaved}
      />

      <div className="native-hide py-[var(--space-page-y)]">
      <Reveal>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title font-headline font-semibold text-primary">
            <WordReveal text="Leaderboard" delay={80} step={60} />
          </h1>
          <InfoTip label="How is XP counted here?">
            XP is added by Felix when a recording is scored, and only then.
            It&apos;s worked out on our servers, so nobody can hand themselves
            points.
          </InfoTip>
        </div>
      </Reveal>

      <Reveal className="mt-6">
        {/* Toggle buttons, not tabs — see the same note on /pricing. */}
        <div
          role="group"
          aria-label="Leaderboard scope"
          className="inline-flex rounded-full bg-surface-container p-1"
        >
          {(["global", "friends"] as Scope[]).map((s) => (
            <button
              key={s}
              aria-pressed={scope === s}
              onClick={() => switchTo(s)}
              className={`rounded-full px-5 py-1.5 text-label font-semibold capitalize transition-colors ${
                scope === s
                  ? "bg-surface-lowest text-primary shadow-sm"
                  : "text-on-surface-variant hover:text-primary"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </Reveal>

      <Reveal className="mt-4">
        <HandleCard handle={handle} onSaved={onHandleSaved} />
      </Reveal>

      {scope === "friends" && (
        <Reveal className="mt-3">
          <InviteCard />
        </Reveal>
      )}

      {board === null && !failed && (
        <p className="mt-8 text-lg text-on-surface-variant" role="status">
          Counting everyone up…
        </p>
      )}

      {failed && (
        <p className="mt-8 text-lg text-on-surface-variant" role="status">
          Couldn&apos;t load the board just now. Try again in a moment.
        </p>
      )}

      {board && rows.length === 0 && (
        <div className="card mt-8 p-6">
          <Felix mood="coach" className="h-16 w-16" />
          <h2 className="mt-3 font-headline text-xl font-semibold text-primary">
            {scope === "friends"
              ? "No friends here yet"
              : "Nobody's on the board yet"}
          </h2>
          <p className="mt-1.5 max-w-[52ch] text-base leading-6 text-on-surface-variant">
            {scope === "friends"
              ? "Send someone the link above. They land on your friends board the moment they sign up."
              : "Record something and you'll be the first name on it."}
          </p>
          <Link
            href="/practice?daily=1"
            className="btn mt-5 inline-block rounded-lg bg-accent-strong px-6 py-3 font-semibold text-white"
          >
            Start your Daily Minute
          </Link>
        </div>
      )}

      {podium.length > 0 && (
        <Reveal className="mt-8">
          <Podium rows={podium} />
        </Reveal>
      )}

      {rest.length > 0 && (
        <Reveal className="mt-6">
          <ul className="card space-y-1 p-2">
            {rest.map((row) => (
              <Row key={row.uid} row={row} />
            ))}
          </ul>
        </Reveal>
      )}

      {/* Outside the top ten, pinned on so you can always see where you are. */}
      {board?.self && (
        <Reveal className="mt-3">
          <ul className="card p-2">
            <Row row={board.self} />
          </ul>
          <p className="mt-2 text-label text-on-surface-variant">
            {board.self.rank <= BOARD_SIZE + 2 ? (
              <>You&apos;re just outside the top {BOARD_SIZE}. Keep going.</>
            ) : (
              <>You&apos;re #{board.self.rank}. Keep climbing.</>
            )}
          </p>
        </Reveal>
      )}
      </div>
    </>
  );
}

export default function LeaderboardPage() {
  return (
    <RequireAuth>
      <LeaderboardScreen />
    </RequireAuth>
  );
}
