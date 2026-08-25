"use client";

import { useState } from "react";
import { useIsNative } from "@/lib/native";
import { useAuth } from "@/components/AuthProvider";
import { Felix } from "@/components/FoxLogo";
import { FlameGlyph, flameTier } from "@/components/native/felix";
import { NvSheet, NvButton, NvEmpty } from "@/components/native/ui";
import {
  BOARD_SIZE,
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

/**
 * THE BOARD, in the app.
 *
 * Two things were wrong with the leaderboard on native and only one of them
 * was visible. The visible one: it rendered the website — pill toggles, `card`
 * blocks, a podium built out of Tailwind height utilities — inside the shell.
 * The invisible one was worse: **there was no way to reach it.** The dock
 * carries four tabs, the rail carries the four Premium modules, and the coin
 * badge and the reward node both go to /shop. A signed-in user in the app
 * could not get to this screen at all. On the web it is a peer tab in SubNav.
 *
 * So this file is the screen, and the two doors added with it (the Ladder's
 * foot, the Den's Community group) are the way in.
 *
 * Every number here was computed server-side and is read-only to the client
 * (lib/leaderboardServer.ts + the `leaderboard` rules). Nothing on this screen
 * can award anything, which is the only reason a board is worth showing.
 *
 * Renders nothing in a browser; the web markup it replaces carries
 * `native-hide`.
 */

type Scope = "global" | "friends";

const MEDALS = ["🥇", "🥈", "🥉"];

/* --- The podium ------------------------------------------------------------
   Second, first, third, so the winner stands in the middle. Column heights are
   indexed by RANK, not by position in the filtered array — with fewer than
   three rows the array collapses and a lone #1 would take the silver plinth. */
function Podium({ rows }: { rows: BoardRow[] }) {
  const order = [rows[1], rows[0], rows[2]].filter(Boolean);
  const heights = [64, 46, 34];

  return (
    <div className="nv-podium">
      {order.map((row) => {
        const place = row.rank;
        return (
          <div key={row.uid} className="nv-podium-col">
            <Felix
              mood={place === 1 ? "cheer" : "idle"}
              className={place === 1 ? "h-14 w-14" : "h-11 w-11"}
            />
            <span className="nv-podium-medal" aria-hidden="true">
              {MEDALS[place - 1]}
            </span>
            <span className="nv-podium-name" data-self={row.isSelf ? "" : undefined}>
              {row.handle ?? "A quiet fox"}
            </span>
            <span className="nv-podium-xp nv-num">
              {row.xp.toLocaleString()} XP
            </span>
            <div
              className="nv-podium-plinth"
              data-self={row.isSelf ? "" : undefined}
              style={{ height: heights[place - 1] }}
            >
              <span className="nv-num">{place}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* --- One line of the board -------------------------------------------------- */
function Row({ row }: { row: BoardRow }) {
  return (
    <li className="nv-board-row" data-self={row.isSelf ? "" : undefined}>
      <span className="nv-board-rank nv-num">{row.rank}</span>
      <span className="nv-board-name">
        {row.handle ?? "A quiet fox"}
        {row.isSelf && <span className="nv-board-you">you</span>}
      </span>
      {row.streakDays > 0 && (
        <span
          className="nv-board-streak"
          data-tier={flameTier(row.streakDays)}
          aria-label={`${row.streakDays} day streak`}
        >
          <FlameGlyph className="h-[15px] w-[11px]" />
          <span className="nv-num" aria-hidden="true">
            {row.streakDays}
          </span>
        </span>
      )}
      <span className="nv-board-lv nv-num" data-pop="lilac">
        Lv {row.level}
      </span>
      <span className="nv-board-xp nv-num">{row.xp.toLocaleString()}</span>
    </li>
  );
}

/* --- Naming yourself --------------------------------------------------------
   Optional: an unnamed row still ranks, it just ranks as a quiet fox. The
   editor is a sheet rather than an inline form, because a keyboard opening
   under an inline field on a phone pushes the thing you are naming off
   screen. */
function HandleSheet({
  open,
  onClose,
  handle,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  handle: string | null;
  onSaved: (h: string) => void;
}) {
  const { user } = useAuth();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Seeds the field the first time the sheet comes up, and re-seeds it on
  // every reopen — `open` is the only signal, so a cancelled edit doesn't
  // leave its abandoned text waiting in the box next time.
  const [seededFor, setSeededFor] = useState(false);
  if (open && !seededFor) {
    setValue(handle ?? suggestHandle(user?.displayName));
    setError("");
    setSeededFor(true);
  }
  if (!open && seededFor) setSeededFor(false);

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
    onClose();
  }

  return (
    <NvSheet open={open} onClose={onClose} title="Your name on the board">
      <form onSubmit={submit}>
        {/* Says the quiet part out loud: this is the one field on the account
            that strangers see, and it is not the name they signed up with. */}
        <p className="nv-footnote mb-3 leading-5">
          Everyone on the leaderboard sees this. Your real name never appears
          here, so use whatever you&apos;re happy being called.
        </p>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={20}
          autoComplete="off"
          aria-label="Your name on the board"
          // suggestHandle answers "" for an account with no display name —
          // every email signup — so the field opens empty and needs to say
          // what would happen if it stayed that way.
          placeholder="A quiet fox"
          className="nv-input w-full"
        />
        {error && (
          <p role="alert" className="nv-footnote mt-2" style={{ color: "var(--nv-pop-rose-ink)" }}>
            {error}
          </p>
        )}
        <button type="submit" disabled={saving} className="nv-btn nv-btn-primary mt-4 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        <NvButton variant="plain" onClick={onClose} className="mt-1">
          Cancel
        </NvButton>
      </form>
    </NvSheet>
  );
}

/* --- Bringing someone in ---------------------------------------------------- */
function Invite() {
  const { code, error } = useInviteCode();
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);

  return (
    <div className="nv-invite">
      <span className="nv-headline">Bring someone in</span>
      <p className="nv-footnote mt-1 leading-5">
        You become friends automatically, and you both get {REFERRAL_BONUS_XP} XP
        once they finish their first minute.
      </p>
      {code && (
        <button
          type="button"
          onClick={async () => setOutcome(await shareInvite(inviteUrl(code)))}
          className="nv-btn nv-btn-primary mt-3.5"
        >
          Share the link
        </button>
      )}
      {outcome === "copied" && (
        <p className="nv-footnote mt-2 font-semibold" role="status">
          Link copied.
        </p>
      )}
      {outcome === "failed" && (
        <p className="nv-footnote mt-2" role="status">
          Couldn&apos;t copy it — no share sheet and no clipboard.
        </p>
      )}
      {error && <p className="nv-footnote mt-2">{error}</p>}
    </div>
  );
}

export function NativeLeaderboard({
  scope,
  onScope,
  board,
  failed,
  handle,
  onHandleSaved,
  onRetry,
}: {
  scope: Scope;
  onScope: (s: Scope) => void;
  /** null while the board is being counted. */
  board: Board | null;
  failed: boolean;
  handle: string | null;
  onHandleSaved: (h: string) => void;
  onRetry: () => void;
}) {
  const native = useIsNative();
  const [naming, setNaming] = useState(false);
  if (!native) return null;

  const rows = board?.rows ?? [];
  const podium = scope === "global" ? rows.slice(0, 3) : [];
  const rest = scope === "global" ? rows.slice(3) : rows;

  return (
    <div className="pt-4 pb-2">
      {/* Toggle buttons, not tabs: they swap the CONTENT of one screen, and a
          tab bar already means something else in this app. */}
      <div className="nv-seg" role="group" aria-label="Leaderboard scope">
        {(["global", "friends"] as Scope[]).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={scope === s}
            onClick={() => onScope(s)}
            className="nv-seg-item capitalize"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Who you are on the board. A row rather than a card: it's one fact and
          one action, and the podium underneath is what the screen is for. */}
      <button
        type="button"
        onClick={() => setNaming(true)}
        className="nv-handle"
      >
        <span className="min-w-0 flex-1 text-left">
          <span className="nv-footnote block">You appear as</span>
          <span className="nv-handle-name block truncate">
            {handle ?? "A quiet fox"}
          </span>
        </span>
        <span className="nv-handle-action">{handle ? "Change" : "Pick a name"}</span>
      </button>

      <HandleSheet
        open={naming}
        onClose={() => setNaming(false)}
        handle={handle}
        onSaved={onHandleSaved}
      />

      {scope === "friends" && <Invite />}

      {/* A skeleton in the SHAPE of the board, not a sentence about it. Rows
          of the right height in the right places mean the screen does not
          jump when the data lands, and the wait reads as loading rather than
          as nothing having happened. The sentence stays for screen readers,
          which cannot see a skeleton. */}
      {board === null && !failed && (
        <div className="mt-6" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="nv-board-skeleton">
              <span className="nv-skeleton nv-board-skeleton-rank" />
              <span className="nv-skeleton nv-board-skeleton-name" />
              <span className="nv-skeleton nv-board-skeleton-xp" />
            </div>
          ))}
        </div>
      )}
      {board === null && !failed && (
        <p className="sr-only" role="status">
          Counting everyone up…
        </p>
      )}

      {failed && (
        <div className="mt-8">
          <NvEmpty
            icon={<Felix mood="idle" className="h-16 w-16" />}
            line="Couldn't load the board just now."
            action={
              <NvButton variant="secondary" onClick={onRetry}>
                Try again
              </NvButton>
            }
          />
        </div>
      )}

      {board && rows.length === 0 && (
        <div className="mt-6">
          <NvEmpty
            icon={<Felix mood="coach" className="felix-idle h-16 w-16" />}
            line={
              scope === "friends"
                ? "No friends here yet. Send someone the link — they land on your board the moment they sign up."
                : "Nobody's on the board yet. Record something and you'll be the first name on it."
            }
          />
        </div>
      )}

      {podium.length > 0 && <Podium rows={podium} />}

      {rest.length > 0 && (
        <ul className="nv-board">{rest.map((row) => <Row key={row.uid} row={row} />)}</ul>
      )}

      {/* Outside the top ten, pinned on, so you can always see where you are. */}
      {board?.self && (
        <>
          <ul className="nv-board mt-3">
            <Row row={board.self} />
          </ul>
          <p className="nv-footnote mt-2 px-1">
            {board.self.rank <= BOARD_SIZE + 2
              ? `You're just outside the top ${BOARD_SIZE}. Keep going.`
              : `You're #${board.self.rank}. Keep climbing.`}
          </p>
        </>
      )}

      <p className="nv-footnote mt-8 px-1 leading-5">
        XP is added by Felix when a recording is scored, and only then. It&apos;s
        worked out on our servers, so nobody can hand themselves points.
      </p>
    </div>
  );
}
