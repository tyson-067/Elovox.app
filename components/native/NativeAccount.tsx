"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FelixScene } from "@/components/Biome";
import { CoinBadge, NvSparkles, popFor } from "@/components/native/felix";
import { type FelixAccessory } from "@/components/FoxLogo";
import { useIsNative, useTheme } from "@/lib/native";
import { LEGAL } from "@/lib/legal";
import { badgesFor, currentOutfit, wardrobeFor } from "@/lib/quests";
import { getStats, type UserStats } from "@/lib/daily";
import { listSessions } from "@/lib/store";
import type { Session } from "@/lib/types";
import { fetchShopState, type ShopState } from "@/lib/shop";
import { usePlanRecord, hasComp, type PlanRecord } from "@/lib/plan";
import { STREAK_REWARD_DAYS } from "@/lib/streakClaim";
import { fetchDataExport } from "@/lib/checkout";
import {
  accountErrorMessage,
  changeEmail,
  changePassword,
  deleteAccount,
  refreshVerifiedStatus,
  resendVerificationEmail,
  signOutUser,
  EMAIL_CHANGE_NOTICE,
} from "@/lib/auth";
import {
  readSettings,
  subscribeSettings,
  serverSettings,
  reconcilePermission,
  setEnabled,
  setTime,
} from "@/lib/reminders";
import {
  NvSectionHeader,
  NvGroup,
  NvRow,
  NvButton,
  NvSheet,
  NvChevron,
} from "@/components/native/ui";

/**
 * Account, at app scale: a Settings-style identity header (Felix in the
 * user's equipped gear, the account email under him), then five inset
 * grouped lists (Plan, Account, Practice, About, Data) instead of the web's
 * long scroll of form cards. The forms
 * didn't go away — email, password and deletion each open in a sheet, running
 * the exact same lib/auth calls the web cards run. The web sections carry
 * native-hide; this renders nothing in a browser.
 *
 * This screen also absorbs NativeAccountSection (reminders, appearance,
 * legal rows) so Account has one native surface, not two.
 */

/* --- Glyphs: mono-stroke, one weight, sized for the 29px icon square ------- */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const iconPlan = (
  <Glyph>
    <path d="M10 2.75c.6 3.9 3.35 6.65 7.25 7.25-3.9.6-6.65 3.35-7.25 7.25-.6-3.9-3.35-6.65-7.25-7.25 3.9-.6 6.65-3.35 7.25-7.25z" />
  </Glyph>
);
const iconMail = (
  <Glyph>
    <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
    <path d="m3.5 6.5 6.5 5 6.5-5" />
  </Glyph>
);
const iconLock = (
  <Glyph>
    <rect x="4.5" y="9" width="11" height="8" rx="2" />
    <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
  </Glyph>
);
const iconBell = (
  <Glyph>
    <path d="M10 3a4.5 4.5 0 0 1 4.5 4.5c0 3 .8 4.4 1.6 5.3H3.9c.8-.9 1.6-2.3 1.6-5.3A4.5 4.5 0 0 1 10 3z" />
    <path d="M8.4 15.8a1.8 1.8 0 0 0 3.2 0" />
  </Glyph>
);
const iconMoon = (
  <Glyph>
    <path d="M16.5 12.2A6.8 6.8 0 0 1 7.8 3.5a6.8 6.8 0 1 0 8.7 8.7z" />
  </Glyph>
);
const iconInfo = (
  <Glyph>
    <circle cx="10" cy="10" r="7.25" />
    <path d="M10 9.25v4" />
    <path d="M10 6.5h.01" />
  </Glyph>
);
const iconChat = (
  <Glyph>
    <path d="M10 3.5c4 0 7 2.6 7 5.9s-3 5.9-7 5.9c-.8 0-1.6-.1-2.3-.3L4 16.5l.9-2.9A5.5 5.5 0 0 1 3 9.4c0-3.3 3-5.9 7-5.9z" />
  </Glyph>
);
const iconCamera = (
  <Glyph>
    <rect x="3.5" y="3.5" width="13" height="13" rx="3.5" />
    <circle cx="10" cy="10" r="3" />
    <path d="M14.1 5.9h.01" />
  </Glyph>
);
const iconDoc = (
  <Glyph>
    <path d="M5 17.25V2.75h6.25L15 6.5v10.75z" />
    <path d="M11 3v4h4" />
    <path d="M7.5 10.5h5M7.5 13.25h5" />
  </Glyph>
);
const iconShield = (
  <Glyph>
    <path d="M10 2.75 16 5v5c0 4-2.5 6.3-6 7.25C6.5 16.3 4 14 4 10V5z" />
  </Glyph>
);
const iconDownload = (
  <Glyph>
    <path d="M10 3v9" />
    <path d="M6.5 8.5 10 12l3.5-3.5" />
    <path d="M4 16.5h12" />
  </Glyph>
);
const iconSignOut = (
  <Glyph>
    <path d="M12.5 6.5v-2a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h6.5a1 1 0 0 0 1-1v-2" />
    <path d="M8.5 10H17" />
    <path d="M14.5 7.5 17 10l-2.5 2.5" />
  </Glyph>
);
const iconTrash = (
  <Glyph>
    <path d="M4 6h12" />
    <path d="M8 6V4.5h4V6" />
    <path d="M6 6l.7 10.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L14 6" />
    <path d="M8.5 9v4.5M11.5 9v4.5" />
  </Glyph>
);

/* --- Small shared pieces ---------------------------------------------------- */

function fmtDate(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* Missing utility: no .nv-input exists yet, so sheet fields approximate the
   iOS grouped-form field with the tint-soft fill + token radius. */
function SheetInput({
  className = "",
  style,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`nv-body w-full min-h-[44px] px-4 py-3 ${className}`}
      style={{
        background: "var(--nv-tint-soft)",
        borderRadius: "var(--nv-r-btn)",
        ...style,
      }}
    />
  );
}

function SheetError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="nv-footnote" style={{ color: "var(--nv-destructive)" }}>
      {children}
    </p>
  );
}

function Hairline() {
  return <div className="my-4 h-px" style={{ background: "var(--nv-hairline)" }} aria-hidden="true" />;
}

/* An iOS switch on the nv tokens. A real checkbox under a track and a knob,
   so it keeps keyboard behaviour and its role for VoiceOver. (Missing
   utility: no .nv-switch primitive — knob uses --nv-card for want of a
   knob-white token.) */
function NvSwitch({
  checked,
  busy,
  onChange,
  label,
}: {
  checked: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="relative inline-flex min-h-[44px] shrink-0 cursor-pointer items-center">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={busy}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className={`relative block h-[31px] w-[51px] rounded-full transition-colors duration-200 motion-reduce:transition-none peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 ${
          busy ? "opacity-60" : ""
        }`}
        style={{
          background: checked ? "var(--nv-accent-500)" : "var(--nv-ink-3)",
          outlineColor: "var(--nv-accent-700)",
        }}
      >
        <span
          className={`absolute left-[2px] top-[2px] block h-[27px] w-[27px] rounded-full transition-transform duration-200 motion-reduce:transition-none ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
          style={{ background: "var(--nv-knob)", boxShadow: "var(--nv-shadow)" }}
        />
      </span>
    </label>
  );
}

/* External-link row (mailto, Instagram): same anatomy as NvRow, on an <a>. */
function ExternalRow({
  href,
  icon,
  label,
  newTab,
}: {
  href: string;
  icon: ReactNode;
  label: ReactNode;
  newTab?: boolean;
}) {
  return (
    <a
      href={href}
      className="nv-row"
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <span className="nv-icon-square" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
      </span>
      <NvChevron />
    </a>
  );
}

/* --- Identity header --------------------------------------------------------- */
/* Who you are, before what you can change — the shape iOS Settings opens
   with. The avatar is Felix in the user's equipped gear, same wiring as the
   Today card but without the quests machinery: no stats reach this screen,
   so there's no level-outfit fallback, and nothing equipped is just bare
   Felix at home. One read on mount; equipping happens on /shop, and this
   screen remounts on the way back. */
/**
 * THE DEN — what you've earned, opening the screen that used to open with a
 * form.
 *
 * "Account" was five grouped lists and nothing to be proud of. The Den is the
 * same five lists entered through the fox: him in his gear with the level on
 * his shoulder, the badge wall, and the wardrobe rail with the balance that
 * buys into it. The settings didn't move an inch — they just stopped being the
 * first thing this screen says about you.
 *
 * It fetches its own stats and history for the same reason IdentityHeader
 * already fetched the shop state: this is the only screen that needs them, and
 * threading three more props through /account for a native-only surface would
 * make the web page carry the cost of a screen it never renders.
 */
function DenHeader({
  email,
  shop,
  stats,
}: {
  email: string | null;
  shop: ShopState | null;
  stats: UserStats | null;
}) {
  const level = stats?.level;
  const outfit = currentOutfit(level?.level ?? 1);
  const wearing =
    (shop?.equippedAccessory as FelixAccessory | null) ?? outfit?.id;

  return (
    <div className="flex flex-col items-center pb-4 pt-2">
      {/* Decorative for VoiceOver: the lines right below carry the identity,
          so announcing an image here would only be noise. The skeleton holds
          the slot until the shop state lands, rather than flashing a
          default-dressed fox that swaps outfits a beat later. */}
      <div aria-hidden="true" className="relative">
        {shop ? (
          <>
            <span
              className="block h-[104px] w-[104px] overflow-hidden rounded-full"
              style={{
                background:
                  "radial-gradient(circle at 50% 28%, var(--nv-accent-50), var(--nv-accent-100))",
                boxShadow: "inset 0 0 0 2px var(--nv-accent-100)",
              }}
            >
              <FelixScene
                biome={shop.equippedBiome}
                mood="cheer"
                accessory={wearing}
                animate
                className="h-full w-full"
              />
            </span>
            <NvSparkles />
            {level && <span className="nv-lv-chip">{level.level}</span>}
          </>
        ) : (
          <span
            className="nv-skeleton block h-[104px] w-[104px]"
            style={{ borderRadius: "9999px" }}
          />
        )}
      </div>
      {level && (
        <p
          className="mt-3.5 text-center"
          style={{
            fontFamily: "var(--nv-font-display)",
            fontWeight: 800,
            fontSize: 22,
            letterSpacing: "-0.045em",
          }}
        >
          {level.title}
        </p>
      )}
      {/* Joined by hand rather than with a template, because either half can
          be absent — a provider account with no address, or stats still in
          flight — and a bare leading "· 716 XP" is what a template gives you. */}
      <p className="nv-footnote mt-1 break-all text-center">
        {[email, level ? `${level.xp} XP` : null].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

/** The badge wall. Six achievements, four states of pride. */
function BadgeWall({
  stats,
  sessions,
  failed,
  loaded,
}: {
  stats: UserStats | null;
  sessions: Session[];
  /** History couldn't be read — badges are unknown, not un-earned. */
  failed: boolean;
  /** History has actually arrived. Absent it, an empty array is not an answer. */
  loaded: boolean;
}) {
  // Nothing, rather than "0 of 6" with all six greyed out. Badges are computed
  // from the session history, and while that is in flight `sessions` is [] —
  // which badgesFor correctly reads as "earned none". Rendering it asserts
  // that every badge is unearned to someone who may have all six, on the
  // screen built to show them off. A beat of absence is the honest state.
  if (failed || !loaded) return null;
  const badges = badgesFor({ stats, sessions });
  const earned = badges.filter((b) => b.earned).length;
  const nextUp = badges.find((b) => !b.earned);

  return (
    <>
      <NvSectionHeader>Badges</NvSectionHeader>
      <NvGroup>
        <div className="px-4 py-4">
          <div className="mb-3.5 flex items-baseline justify-between">
            <span className="nv-footnote font-semibold">
              {earned} of {badges.length}
            </span>
          </div>
          <ul className="grid grid-cols-3 gap-2.5">
            {badges.map((b, i) => (
              <li
                key={b.id}
                className="nv-badge-tile"
                data-pop={b.earned ? popFor(i) : undefined}
                data-locked={b.earned ? undefined : ""}
              >
                <span className="nv-badge-emoji" aria-hidden="true">
                  {b.emoji}
                </span>
                <span className="nv-badge-name">{b.name}</span>
                <span className="sr-only">
                  {b.earned ? "earned" : `not earned yet — ${b.hint}`}
                </span>
              </li>
            ))}
          </ul>
          {nextUp && (
            <p className="nv-footnote mt-3.5">
              {nextUp.name}: {nextUp.hint.toLowerCase()}.
            </p>
          )}
        </div>
      </NvGroup>
    </>
  );
}

/**
 * Felix's wardrobe: the level-gated outfits, and the balance that buys the
 * rest. Tapping anything opens the shop, which is the only screen allowed to
 * change what he's wearing.
 */
function Wardrobe({
  shop,
  stats,
}: {
  shop: ShopState | null;
  stats: UserStats | null;
}) {
  if (!shop) return null;
  const level = stats?.level.level ?? 1;
  const worn = (shop.equippedAccessory as FelixAccessory | null) ?? currentOutfit(level)?.id;

  return (
    <>
      <NvSectionHeader>Felix&apos;s wardrobe</NvSectionHeader>
      <NvGroup>
        <div className="px-4 py-4">
          <div className="mb-3.5 flex items-baseline justify-between gap-3">
            <span className="nv-footnote font-semibold">
              Tap to open the shop
            </span>
            <CoinBadge coins={shop.coins} />
          </div>
          <div className="nv-wardrobe">
            {wardrobeFor(level).map((o) => (
              <Link
                key={o.id}
                href="/shop"
                className="nv-wardrobe-cell nv-press"
                data-worn={worn === o.id ? "" : undefined}
                aria-label={
                  o.unlocked
                    ? `${o.name}${worn === o.id ? ", worn" : ", unlocked"}`
                    : `${o.name}, unlocks at level ${o.level}`
                }
              >
                <span
                  className="nv-wardrobe-tile"
                  data-worn={worn === o.id ? "" : undefined}
                  data-locked={o.unlocked ? undefined : ""}
                  aria-hidden="true"
                >
                  {o.emoji}
                </span>
                <span className="nv-wardrobe-label">
                  {worn === o.id
                    ? "Worn"
                    : o.unlocked
                      ? o.name
                      : `Level ${o.level}`}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </NvGroup>
    </>
  );
}

/* --- Group 1: Plan ---------------------------------------------------------- */
/* Read-only by App Store rule: the plan's name and its dates, nothing to buy,
   no prices. The web keeps the billing buttons. */
function PlanSection() {
  const { record } = usePlanRecord();
  const r: PlanRecord | null = record;
  const isPremium = r?.plan === "premium";

  let footnote = "";
  if (r) {
    const ending = r.cancelAtPeriodEnd || r.cancelAt != null;
    const endsOn = fmtDate(
      r.cancelAt ??
        (r.status === "trialing" ? r.trialEnd : undefined) ??
        r.currentPeriodEnd
    );
    const subscribed =
      r.status === "trialing" || r.status === "active" || r.status === "past_due";
    if (r.status === "trialing" && ending) {
      footnote = `Trial canceled. Access until ${endsOn} — you won't be charged.`;
    } else if (r.status === "trialing") {
      footnote = `Free trial until ${fmtDate(r.trialEnd)}.`;
    } else if (r.status === "active" && ending) {
      footnote = `Premium ends ${endsOn}. Access continues until then.`;
    } else if (r.status === "active") {
      footnote = `Renews ${fmtDate(r.currentPeriodEnd)}.`;
    } else if (!subscribed && hasComp(r)) {
      footnote = `Premium until ${fmtDate(r.premiumUntil)}, free for your ${STREAK_REWARD_DAYS}-day streak.`;
    }
  }

  return (
    <>
      <NvSectionHeader>Plan</NvSectionHeader>
      <NvGroup>
        <NvRow
          icon={iconPlan}
          label="Plan"
          value={
            r === null ? (
              <span className="nv-skeleton inline-block h-4 w-16" aria-hidden="true" />
            ) : isPremium ? (
              "Premium"
            ) : (
              "Free"
            )
          }
        />
      </NvGroup>
      {footnote && <p className="nv-footnote mt-2 px-1">{footnote}</p>}
    </>
  );
}

/* --- Group 2: Account (email + password, forms in sheets) ------------------- */

function EmailSheet({
  open,
  onClose,
  email,
  hasPassword,
  verified,
  setVerified,
}: {
  open: boolean;
  onClose: () => void;
  email: string | null;
  hasPassword: boolean;
  verified: boolean;
  setVerified: (v: boolean) => void;
}) {
  // Verification — same calls and copy as the web card.
  const [verifyMsg, setVerifyMsg] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);

  const resend = async () => {
    setVerifyMsg("");
    setVerifyBusy(true);
    try {
      await resendVerificationEmail();
      setVerifyMsg("Verification email sent. Check your inbox.");
    } catch (err) {
      setVerifyMsg(accountErrorMessage(err) || "Couldn't send that. Try again.");
    } finally {
      setVerifyBusy(false);
    }
  };

  const refresh = async () => {
    setVerifyMsg("");
    setVerifyBusy(true);
    try {
      const ok = await refreshVerifiedStatus();
      setVerified(ok);
      setVerifyMsg(ok ? "" : "Not verified yet. Click the link in your email first.");
    } finally {
      setVerifyBusy(false);
    }
  };

  // Change email — same calls and copy as the web card.
  const [newEmail, setNewEmail] = useState("");
  const [emailPw, setEmailPw] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setEmailMsg("");
    setEmailErr("");
    setEmailBusy(true);
    try {
      await changeEmail(newEmail, hasPassword ? emailPw : undefined);
      setEmailMsg(EMAIL_CHANGE_NOTICE);
      setNewEmail("");
      setEmailPw("");
    } catch (err) {
      setEmailErr(accountErrorMessage(err));
    } finally {
      setEmailBusy(false);
    }
  };

  return (
    <NvSheet open={open} onClose={onClose} title="Email">
      <p className="nv-body break-all text-center">{email}</p>
      <p className="nv-footnote mt-1 text-center">
        {verified ? "Verified" : "Not verified"}
      </p>

      {!verified && (
        <div className="mt-4 flex flex-col gap-2">
          <NvButton variant="secondary" onClick={resend} disabled={verifyBusy}>
            {verifyBusy ? "One moment…" : "Send verification email"}
          </NvButton>
          <NvButton variant="plain" onClick={refresh} disabled={verifyBusy}>
            I&apos;ve verified. Refresh
          </NvButton>
        </div>
      )}
      {verifyMsg && (
        <p role="status" className="nv-footnote mt-2 text-center">
          {verifyMsg}
        </p>
      )}

      <Hairline />

      <h3 className="nv-headline">Change email</h3>
      <p className="nv-footnote mt-1">
        We&apos;ll send a confirmation link to the new address. Your login only
        changes once you click it.
      </p>
      <form onSubmit={submitEmail} className="mt-3 space-y-3">
        <SheetInput
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          id="nv-acct-new-email"
          aria-label="New email address"
          placeholder="New email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
        />
        {hasPassword && (
          <SheetInput
            type="password"
            required
            autoComplete="current-password"
            id="nv-acct-email-pw"
            aria-label="Current password"
            placeholder="Current password"
            value={emailPw}
            onChange={(e) => setEmailPw(e.target.value)}
          />
        )}
        {emailErr && <SheetError>{emailErr}</SheetError>}
        {emailMsg && (
          <p role="status" className="nv-footnote">
            {emailMsg}
          </p>
        )}
        <NvButton type="submit" disabled={emailBusy}>
          {emailBusy ? "Sending…" : "Update email"}
        </NvButton>
        {!hasPassword && (
          <p className="nv-footnote">
            You&apos;ll confirm this change in a quick Google popup.
          </p>
        )}
      </form>
    </NvSheet>
  );
}

function PasswordSheet({
  open,
  onClose,
  hasPassword,
  providerName,
}: {
  open: boolean;
  onClose: () => void;
  hasPassword: boolean;
  /** Who actually holds the credentials — "Apple", "Google", or a neutral
   *  fallback. Hardcoding "Google" was wrong on every Apple account. */
  providerName: string;
}) {
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwMsg("");
    setPwErr("");
    setPwBusy(true);
    try {
      await changePassword(curPw, newPw);
      setPwMsg("Password updated.");
      setCurPw("");
      setNewPw("");
    } catch (err) {
      setPwErr(accountErrorMessage(err));
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <NvSheet open={open} onClose={onClose} title="Password">
      {hasPassword ? (
        <form onSubmit={submitPassword} className="space-y-3">
          <SheetInput
            type="password"
            required
            autoComplete="current-password"
            id="nv-acct-cur-pw"
            aria-label="Current password"
            placeholder="Current password"
            value={curPw}
            onChange={(e) => setCurPw(e.target.value)}
          />
          <SheetInput
            type="password"
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            id="nv-acct-new-pw"
            aria-label="New password, 8 or more characters"
            placeholder="New password (8+ characters)"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
          {pwErr && <SheetError>{pwErr}</SheetError>}
          {pwMsg && (
            <p role="status" className="nv-footnote">
              {pwMsg}
            </p>
          )}
          <NvButton type="submit" disabled={pwBusy}>
            {pwBusy ? "Updating…" : "Update password"}
          </NvButton>
        </form>
      ) : (
        <p className="nv-subhead pb-2 text-center">
          This account signs in with {providerName}, so {providerName} manages
          the password.
        </p>
      )}
    </NvSheet>
  );
}

/* --- Group 3: Practice (reminder + appearance) ------------------------------ */
/* The reminder logic is ReminderCard's, verbatim: read through the store
   (localStorage can't be touched during render, and the schedule is rewritten
   from outside), reconcile the saved switch against the real permission in an
   effect. */
function PracticeSection() {
  const settings = useSyncExternalStore(
    subscribeSettings,
    readSettings,
    serverSettings
  );
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const [theme, setThemeState] = useTheme();

  useEffect(() => {
    void reconcilePermission();
  }, []);

  const onToggle = async (next: boolean) => {
    setBusy(true);
    const applied = await setEnabled(next);
    setRefused(next && !applied.enabled);
    setBusy(false);
  };

  return (
    <>
      <NvSectionHeader>Practice</NvSectionHeader>
      <NvGroup>
        {/* Both icon rows pin their colour: the "Remind me at" row between
            them comes and goes with the switch, and an nth-child cycle would
            have repainted Appearance every time it did. */}
        <NvRow
          icon={iconBell}
          pop="ember"
          label="Daily reminder"
          value={
            <NvSwitch
              checked={settings.enabled}
              busy={busy}
              onChange={onToggle}
              label="Daily reminder"
            />
          }
        />
        {settings.enabled && (
          <NvRow
            label="Remind me at"
            value={
              /* A real time input, so iOS raises its own wheel rather than us
                 rebuilding one badly. */
              <input
                type="time"
                value={settings.time}
                onChange={(e) => void setTime(e.target.value)}
                aria-label="Reminder time"
                className="nv-num min-h-[36px] rounded-[10px] px-3 py-1.5"
                style={{
                  background: "var(--nv-tint-soft)",
                  color: "var(--nv-ink)",
                  fontSize: "var(--nv-subhead-size)",
                }}
              />
            }
          />
        )}
        <NvRow
          icon={iconMoon}
          pop="sky"
          label="Appearance"
          value={
            <div className="nv-seg" role="group" aria-label="Appearance">
              <button
                type="button"
                className="nv-seg-item"
                aria-pressed={theme === "light"}
                onClick={() => setThemeState("light")}
              >
                Daylight
              </button>
              <button
                type="button"
                className="nv-seg-item"
                aria-pressed={theme === "dark"}
                onClick={() => setThemeState("dark")}
              >
                Booth
              </button>
            </div>
          }
        />
      </NvGroup>
      {refused ? (
        <p className="nv-footnote mt-2 px-1">
          Notifications are off for Elovox. Turn them on in Settings &rsaquo;
          Notifications &rsaquo; Elovox, then flip this back on.
        </p>
      ) : (
        <p className="nv-footnote mt-2 px-1">
          A nudge when today&rsquo;s speech is ready. Nothing on days
          you&rsquo;ve already practiced.
        </p>
      )}
    </>
  );
}

/* --- Group 4: About --------------------------------------------------------- */
function AboutSection() {
  return (
    <>
      <NvSectionHeader>About</NvSectionHeader>
      <NvGroup>
        <NvRow icon={iconInfo} label="About Elovox" href="/about" />
        <ExternalRow
          href={`mailto:${LEGAL.contactEmail}`}
          icon={iconChat}
          label="Support"
        />
        <ExternalRow
          href={LEGAL.instagramUrl}
          icon={iconCamera}
          label="Instagram"
          newTab
        />
        <NvRow icon={iconDoc} label="Terms" href="/terms" />
        <NvRow icon={iconShield} label="Privacy" href="/privacy" />
      </NvGroup>
      <p className="nv-footnote mt-2 px-1">
        © {new Date().getFullYear()} {LEGAL.serviceName}. Coaching feedback is
        generated by AI and can be wrong. Treat it as practice, not advice.
      </p>
    </>
  );
}

/* --- Group 5: Data (export, sign out, delete) ------------------------------- */

function DeleteSheet({
  open,
  onClose,
  hasPassword,
}: {
  open: boolean;
  onClose: () => void;
  hasPassword: boolean;
}) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const armed = confirmText.trim().toUpperCase() === "DELETE";

  const close = () => {
    setConfirmText("");
    setPassword("");
    setError("");
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!armed) return;
    setError("");
    setBusy(true);
    try {
      await deleteAccount(hasPassword ? password : undefined);
      // The account is gone; there's nothing signed-in to return to.
      router.replace("/?deleted=1");
    } catch (err) {
      setError(accountErrorMessage(err) || "Couldn't delete your account.");
      setBusy(false);
    }
  };

  return (
    <NvSheet open={open} onClose={close} title="Delete account">
      <p className="nv-footnote">
        Permanently erases your practice history, your progress, and your
        login. If you have a subscription it&apos;s canceled immediately. This
        cannot be undone, and we can&apos;t recover any of it afterwards.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <label htmlFor="nv-acct-delete-confirm" className="nv-subhead block">
          Type <span className="nv-num font-semibold">DELETE</span> to confirm.
        </label>
        <SheetInput
          type="text"
          required
          id="nv-acct-delete-confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          aria-label="Type DELETE to confirm"
        />
        {hasPassword && (
          <SheetInput
            type="password"
            required
            autoComplete="current-password"
            id="nv-acct-delete-pw"
            aria-label="Current password"
            placeholder="Current password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {!hasPassword && (
          <p className="nv-footnote">
            You&apos;ll confirm this in a quick Google popup.
          </p>
        )}
        {error && <SheetError>{error}</SheetError>}
        {/* Missing utility: no destructive .nv-btn variant — iOS action-sheet
            grammar instead (destructive ink on the quiet fill). */}
        <NvButton
          type="submit"
          variant="secondary"
          disabled={busy || !armed}
          style={{ color: "var(--nv-destructive)" }}
        >
          {busy ? "Deleting…" : "Permanently delete"}
        </NvButton>
        <NvButton variant="plain" onClick={close} disabled={busy}>
          Cancel
        </NvButton>
      </form>
    </NvSheet>
  );
}

function DataSection({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // The existing export flow, unchanged: fetch the JSON, hand the file to the
  // browser without ever navigating away.
  const download = async () => {
    setExportErr("");
    setExportBusy(true);
    try {
      const blob = await fetchDataExport();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "elovox-my-data.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportErr(
        e instanceof Error ? e.message : "Couldn't prepare your download."
      );
    } finally {
      setExportBusy(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await signOutUser();
      router.replace("/login");
    } catch {
      setSigningOut(false);
    }
  };

  return (
    <>
      <NvSectionHeader>Data</NvSectionHeader>
      <NvGroup>
        <NvRow
          icon={iconDownload}
          label="Download your data"
          value={exportBusy ? "Preparing…" : undefined}
          onClick={download}
          disabled={exportBusy}
        />
        <NvRow
          icon={iconSignOut}
          label="Sign out"
          onClick={signOut}
          disabled={signingOut}
        />
        <NvRow
          icon={iconTrash}
          label="Delete account"
          destructive
          onClick={() => setDeleteOpen(true)}
        />
      </NvGroup>
      {exportErr ? (
        <p role="alert" className="nv-footnote mt-2 px-1" style={{ color: "var(--nv-destructive)" }}>
          {exportErr}
        </p>
      ) : (
        <p className="nv-footnote mt-2 px-1">
          Your export is a JSON file: practice history, scores, and settings.
          Card details stay with Stripe and never reach us.
        </p>
      )}
      <DeleteSheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        hasPassword={hasPassword}
      />
    </>
  );
}

/* --- The screen -------------------------------------------------------------- */

function AccountNative({
  email,
  hasPassword,
  initialVerified,
  providerName,
}: {
  email: string | null;
  hasPassword: boolean;
  initialVerified: boolean;
  providerName: string;
}) {
  const [verified, setVerified] = useState(initialVerified);
  const [emailOpen, setEmailOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  // The Den's three reads. Each fails soft and independently: a shop outage
  // costs the wardrobe, a history outage costs the badges, and the settings
  // below — the reason anyone actually opens this screen — never wait on any
  // of it. fetchShopState already never rejects; the other two are caught.
  const [shop, setShop] = useState<ShopState | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsFailed, setSessionsFailed] = useState(false);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);

  useEffect(() => {
    let stale = false;
    void fetchShopState().then((s) => {
      if (!stale) setShop(s);
    });
    getStats()
      .then((s) => !stale && setStats(s))
      .catch(() => {});
    listSessions()
      .then((s) => {
        if (stale) return;
        setSessions(s);
        setSessionsFailed(false);
        setSessionsLoaded(true);
      })
      .catch(() => !stale && setSessionsFailed(true));
    return () => {
      stale = true;
    };
  }, []);

  return (
    <div className="pb-2">
      <DenHeader email={email} shop={shop} stats={stats} />
      <BadgeWall
        stats={stats}
        sessions={sessions}
        failed={sessionsFailed}
        loaded={sessionsLoaded}
      />
      <Wardrobe shop={shop} stats={stats} />
      <PlanSection />

      <NvSectionHeader>Account</NvSectionHeader>
      <NvGroup>
        <NvRow
          icon={iconMail}
          label="Email"
          sub={verified ? undefined : "Not verified"}
          value={<span className="max-w-[9.5rem] truncate">{email}</span>}
          chevron
          onClick={() => setEmailOpen(true)}
          ariaLabel="Email settings"
        />
        <NvRow
          icon={iconLock}
          label="Password"
          chevron
          onClick={() => setPwOpen(true)}
          ariaLabel="Password settings"
        />
      </NvGroup>

      <PracticeSection />
      <AboutSection />
      <DataSection hasPassword={hasPassword} />

      <EmailSheet
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        email={email}
        hasPassword={hasPassword}
        verified={verified}
        setVerified={setVerified}
      />
      <PasswordSheet
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        hasPassword={hasPassword}
        providerName={providerName}
      />
    </div>
  );
}

/**
 * Renders nothing in a browser; the web keeps its cards, marked native-hide.
 * The inner component mounts only on native so its hooks (plan record,
 * reminder store, theme) cost the website nothing.
 */
export function NativeAccount(props: {
  email: string | null;
  hasPassword: boolean;
  initialVerified: boolean;
  /** "Apple" / "Google" / a neutral fallback, from the account's providers. */
  providerName: string;
}) {
  const native = useIsNative();
  if (!native) return null;
  return <AccountNative {...props} />;
}
