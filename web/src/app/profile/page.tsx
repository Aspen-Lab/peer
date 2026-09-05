"use client";

import {
  useState,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useProfileStore } from "@/store/profile";
import { formatTimeAgo } from "@/lib/format";
import { useFeedStore } from "@/store/feed";
import { useUIStore } from "@/store/ui";
import { careerStages, industryPreferences, themeAccentOptions, themeModeOptions, type ColorTheme, type ThemeAccent, type ThemeMode } from "@/types";
import { SchoolAutocomplete } from "@/components/profile/school-autocomplete";
import { AdvisorField } from "@/components/profile/advisor-field";
import { summarizePreferenceLedger } from "@/lib/preferences/ledger";
import { apiFetch } from "@/lib/api";
import { SURFACE_TOPIC_DESCRIPTIONS } from "@/lib/profile/topic-copy";
import { IconBook, IconBuilding, IconCheck } from "@/components/icons";
import { PageContainer } from "@/components/ui/page-container";
import { AiKeyFields } from "@/components/profile/ai-setup";
import { ConnectorPanel } from "@/components/profile/connector-panel";
import { Toggle } from "@/components/ui/toggle";
import { feedsUseAi } from "@/lib/feed/ai-tier";
import {
  type Tone,
  toneBadge,
  ChipInput,
  ChoiceGroup,
  TogglePill,
  TopicsField,
  industryLabels,
  PAPER_FOCUS_OPTIONS,
  PAPER_FRESHNESS_OPTIONS,
  PAPER_COUNT_OPTIONS,
  PAPER_SOURCE_OPTIONS,
  PAPER_IMPORTANCE_OPTIONS,
  PAPER_DISCOVERY_OPTIONS,
} from "@/components/profile/field-kit";

const DEFAULT_NAME = "Peer Member";

// Field option data, suggestion chips, and the interactive primitives
// (ChipInput, ChoiceGroup, TogglePill, TopicsField) now live in
// components/profile/field-kit.tsx so the profile editor and the onboarding
// wizard share one source of truth.

// ── Icons ───────────────────────────────────────────────────────

function IconUser() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
function IconHash() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
    </svg>
  );
}
function IconFlask() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 3h6" />
      <path d="M10 3v6L4 20a2 2 0 0 0 1.8 3h12.4A2 2 0 0 0 20 20L14 9V3" />
    </svg>
  );
}
function IconCareer() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="7" width="18" height="14" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

// ── Page ────────────────────────────────────────────────────────

export default function ProfilePage() {
  const {
    profile,
    updateDisplayName,
    updateTopics,
    updateSoftTopics,
    updatePreferredJournals,
    updateCareerStage,
    updateIndustryPreference,
    updateSchool,
    updateCurrentProject,
    updateCurrentChallenges,
    updateFeedFocus,
    updateFeedFreshness,
    updatePaperCount,
    updateFeedSourceMix,
    updateFeedImportance,
    updateFeedDiscoveryMode,
    updateFeedAvoidReviews,
    updateFeedAvoidOldPapers,
    updateFeedAvoidBroadSurveys,
    updateAdvisorName,
    confirmAdvisorAuthor,
    clearAdvisorAuthor,
    updateColorTheme,
    resetPreferenceLedger,
    resetOnboarding,
    logOut,
  } = useProfileStore();
  const router = useRouter();

  const name = profile.displayName === DEFAULT_NAME ? "" : profile.displayName;
  const setName = updateDisplayName;
  const [showLogout, setShowLogout] = useState(false);

  const firstName = name.trim().split(/\s+/)[0];

  const [mode, setMode] = useState<"view" | "edit">("view");

  const signals = [
    profile.researchTopics.length > 0,
    (profile.softTopics ?? []).length > 0,
  ];
  const doneCount = signals.filter(Boolean).length;
  const total = signals.length;

  return (
    <PageContainer width="contentResponsive" className="px-6 py-16 lg:py-20">
      {/* ── Header ── */}
      <header className="mb-8">
        <p
          className="text-caption font-semibold uppercase tracking-[0.22em] text-accent/90 mb-3"
        >
          <span className="inline-block w-5 h-[1.5px] bg-accent/70 align-middle mr-2.5" />
          Your profile
        </p>
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <h1
            className="text-[36px] lg:text-[44px] font-semibold text-heading tracking-[-0.02em] leading-[1.05]"
          >
            {firstName ? (
              <>
                <span
                  className="italic font-medium font-reading"
                >
                  {firstName}
                </span>
                &rsquo;s signals
                <span className="text-text-faint/70">.</span>
              </>
            ) : (
              <>
                Your signals
                <span className="text-text-faint/70">.</span>
              </>
            )}
          </h1>
          {mode === "view" ? (
            <button
              onClick={() => setMode("edit")}
              className="group inline-flex items-center gap-1.5 h-9 pl-3 pr-4 rounded-full bg-accent-dim text-accent hover:bg-accent/15 transition-all duration-200 ease-out active:scale-[0.96] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_25%,transparent)] text-body-sm font-medium"
            >
              <span className="transition-transform duration-200 ease-out group-hover:-rotate-12">
                <IconPencil />
              </span>
              Edit
            </button>
          ) : (
            <button
              onClick={() => setMode("view")}
              className="group inline-flex items-center gap-1.5 h-9 pl-3 pr-4 rounded-full bg-heading text-bg hover:bg-heading/90 transition-all duration-200 ease-out active:scale-[0.96] text-body-sm font-medium shadow-card"
            >
              <IconCheck />
              Done
            </button>
          )}
        </div>
        <div className="mt-3.5 flex items-center gap-2.5">
          <div className="flex items-center gap-1">
            {signals.map((done, i) => (
              <span
                key={i}
                className={`block w-1.5 h-1.5 rounded-full transition-colors duration-500 ${
                  done ? "bg-accent" : "bg-border-strong/40"
                }`}
              />
            ))}
          </div>
          <span className="text-meta text-text-faint tabular-nums">
            <span className="text-text-muted font-medium">{doneCount}</span> of {total} signals set
          </span>
        </div>
      </header>

      {mode === "view" ? (
        <>
          <DashboardView
            profile={profile}
            displayName={name}
            onEdit={() => setMode("edit")}
          />
          <AppearanceCard
            colorTheme={profile.colorTheme}
            onChange={updateColorTheme}
          />
          <ReadingCard profile={profile} />
          <LearnedPreferences
            profile={profile}
            onReset={resetPreferenceLedger}
          />
          <PastBriefings />
        </>
      ) : (
        <EditView
          profile={profile}
          name={name}
          setName={setName}
          updateTopics={updateTopics}
          updateSoftTopics={updateSoftTopics}
          updatePreferredJournals={updatePreferredJournals}
          updateSchool={updateSchool}
          updateCurrentProject={updateCurrentProject}
          updateCurrentChallenges={updateCurrentChallenges}
          updateFeedFocus={updateFeedFocus}
          updateFeedFreshness={updateFeedFreshness}
          updatePaperCount={updatePaperCount}
          updateFeedSourceMix={updateFeedSourceMix}
          updateFeedImportance={updateFeedImportance}
          updateFeedDiscoveryMode={updateFeedDiscoveryMode}
          updateFeedAvoidReviews={updateFeedAvoidReviews}
          updateFeedAvoidOldPapers={updateFeedAvoidOldPapers}
          updateFeedAvoidBroadSurveys={updateFeedAvoidBroadSurveys}
          updateAdvisorName={updateAdvisorName}
          confirmAdvisorAuthor={confirmAdvisorAuthor}
          clearAdvisorAuthor={clearAdvisorAuthor}
          updateCareerStage={updateCareerStage}
          updateIndustryPreference={updateIndustryPreference}
        />
      )}

      {/* ── Reset ── */}
      <section
        className="mt-14 pt-6 border-t border-border flex flex-col items-start gap-3"
      >
        <button
          type="button"
          onClick={() => {
            resetOnboarding();
            router.push("/welcome");
          }}
          className="inline-flex items-center gap-1.5 text-meta text-text-faint hover:text-accent transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 3v6h6" />
          </svg>
          Replay walkthrough
        </button>
        {!showLogout ? (
          <button
            onClick={() => setShowLogout(true)}
            className="inline-flex items-center gap-1.5 text-meta text-text-faint hover:text-red transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            Reset profile to defaults
          </button>
        ) : (
          <div className="rounded-xl bg-red/[0.05] shadow-[inset_0_0_0_1px_rgba(185,28,28,0.15)] px-4 py-3 text-meta flex items-center flex-wrap gap-x-5 gap-y-2">
            <span className="text-text-muted">Reset all signals to defaults?</span>
            <div className="flex items-center gap-3 ml-auto">
              <button
                onClick={() => {
                  logOut();
                  setShowLogout(false);
                  setMode("view");
                }}
                className="text-red hover:text-red/80 font-medium transition-colors active:scale-95"
              >
                Confirm reset
              </button>
              <button
                onClick={() => setShowLogout(false)}
                className="text-text-faint hover:text-text-muted transition-colors active:scale-95"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </PageContainer>
  );
}

// ── View mode: editorial dashboard ─────────────────────────────

function DashboardView({
  profile,
  displayName,
  onEdit,
}: {
  profile: ReturnType<typeof useProfileStore.getState>["profile"];
  displayName: string;
  onEdit: () => void;
}) {
  const avatarLetter = displayName ? displayName[0].toUpperCase() : "";
  const industry =
    industryLabels[profile.industryVsAcademia] ?? profile.industryVsAcademia;

  return (
    <div
      className="relative rounded-3xl bg-surface shadow-card overflow-hidden animate-fade-in-up"
    >
      {/* ── Identity band ── */}
      <div className="relative px-7 pt-7 pb-6">
        {/* Ambient gradient wash */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              "radial-gradient(520px 200px at 90% -30%, color-mix(in_srgb,var(--color-accent)_12%,transparent), transparent 60%), radial-gradient(420px 180px at 0% 120%, color-mix(in srgb, var(--color-tag) 7%, transparent), transparent 60%)",
          }}
        />
        <div className="relative flex items-center gap-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-accent-dim shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_28%,transparent)]">
            {avatarLetter ? (
              <span
                className="text-accent text-[26px] font-medium italic leading-none font-reading"
              >
                {avatarLetter}
              </span>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src="/logo-mark.png"
                alt=""
                width={40}
                height={40}
                className="w-10 h-10 object-contain opacity-85"
              />
            )}
          </div>
          <div className="min-w-0">
            {displayName ? (
              <p
                className="text-[26px] italic font-medium text-heading tracking-tight leading-tight font-reading"
              >
                {displayName}
              </p>
            ) : (
              <p className="text-title text-text-faint italic font-reading">
                Unnamed — tap edit to introduce yourself
              </p>
            )}
          </div>
        </div>

        {/* Career caption */}
        <div className="relative mt-5 flex items-center gap-2 text-meta text-text-muted">
          <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${toneBadge("neutral")}`}>
            <IconCareer />
          </span>
          <span className="text-heading font-medium">{profile.careerStage}</span>
          <span className="text-text-faint/60" aria-hidden>·</span>
          <span className="text-text-muted">{industry}</span>
          {profile.school && (
            <>
              <span className="text-text-faint/60" aria-hidden>·</span>
              <span className="text-text-muted">
                {profile.school}
                {profile.advisorName && (
                  <span className="text-text-faint/80">{" · "}{profile.advisorName}</span>
                )}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="h-px bg-border/70 mx-7" />

      {/* ── Signals (compact table) ── */}
      <div className="px-7 py-5">
        <SectionHeader label="Signals" onAdjust={onEdit} />
        <div className="mt-3 space-y-2">
          <SignalRow tone="accent" icon={<IconHash />} label="Required" items={profile.researchTopics} />
          <SignalRow tone="tag" icon={<IconHash />} label="Explore" items={profile.softTopics ?? []} />
          <SignalRow tone="link" icon={<IconBook size={13} strokeWidth={1.9} />} label="Journals" items={profile.preferredJournals ?? []} />
        </div>
      </div>

    </div>
  );
}

// ── Reading: fancy editorial dashboard ─────────────────────────

function ReadingCard({
  profile,
}: {
  profile: ReturnType<typeof useProfileStore.getState>["profile"];
}) {
  const stats = useReadingStats();
  const realCells = useDailyActivityCells();
  const totalSurfaced = stats.saved + stats.read;
  const savedRate =
    totalSurfaced > 0 ? Math.round((stats.saved / totalSurfaced) * 100) : 0;
  const archetype = computeArchetype({
    saved: stats.saved,
    read: stats.read,
    savedRate,
    profile,
  });

  // Venue strength list (real data from saved papers)
  const venueBreakdown = stats.venueBreakdown.slice(0, 5);
  const maxVenue = venueBreakdown[0]?.count ?? 1;

  const pullQuote = composePullQuote({
    saved: stats.saved,
    read: stats.read,
    savedRate,
  });

  return (
    <div
      className="relative mt-5 rounded-3xl bg-surface shadow-card overflow-hidden animate-fade-in-up"
      style={{ animationDelay: "80ms" }}
    >
      {/* Ambient gradient wash — Anthropic-style warm backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          backgroundImage:
            "radial-gradient(680px 260px at 10% -10%, color-mix(in_srgb,var(--color-accent)_10%,transparent), transparent 60%), radial-gradient(520px 220px at 100% 120%, color-mix(in srgb, var(--color-tag) 7%, transparent), transparent 65%)",
        }}
      />

      {/* ── Header kicker ── */}
      <div className="relative px-7 pt-7 pb-4 flex items-baseline justify-between">
        <span className="inline-flex items-center gap-2 text-micro font-semibold uppercase tracking-[0.22em] text-accent/90">
          <span className="inline-block w-4 h-[1.5px] bg-accent/70" />
          Reading · your rhythm
        </span>
        <span className="text-micro uppercase tracking-[0.16em] text-text-faint/70">
          Since day one
        </span>
      </div>

      {/* ── Hero line ── */}
      <div className="relative px-7 pb-5">
        <p
          className="text-heading leading-[1.15] tracking-[-0.01em] text-[26px] lg:text-[30px] font-reading"
        >
          You&apos;ve kept{" "}
          <span className="italic font-medium text-accent tabular-nums">
            {stats.saved}
          </span>{" "}
          item{stats.saved === 1 ? "" : "s"} out of{" "}
          <span className="italic font-medium tabular-nums">
            {totalSurfaced}
          </span>{" "}
          Peer surfaced<span className="text-text-faint/70">.</span>
        </p>
        {stats.saved > 0 && (
          <p
            className="mt-3 text-body text-text-muted max-w-[56ch] leading-[1.55] italic font-reading"
          >
            {pullQuote}
          </p>
        )}
      </div>

      {/* ── 3-stat strip ── */}
      <div className="relative px-7 pb-5">
        <div className="grid grid-cols-3 gap-[1px] bg-border/80 rounded-xl overflow-hidden">
          <HeroStat label="Saved" value={String(stats.saved)} tone="accent" />
          <HeroStat label="Read" value={String(stats.read)} tone="tag" />
          <HeroStat
            label="Save rate"
            value={totalSurfaced ? `${savedRate}%` : "—"}
            tone="peach"
          />
        </div>
      </div>

      {/* ── What you save — tile grid ── */}
      {stats.saved > 0 && (
        <div className="relative px-7 pb-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-micro font-semibold uppercase tracking-[0.18em] text-text-faint">
              What you save
            </span>
            <span className="text-micro text-text-faint/60 tabular-nums">
              {stats.saved} total
            </span>
          </div>
          <TypeTiles breakdown={stats.typeBreakdown} total={stats.saved} />
        </div>
      )}

      {/* ── Top venues — tile grid ── */}
      {venueBreakdown.length > 0 && (
        <div className="relative px-7 pb-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-micro font-semibold uppercase tracking-[0.18em] text-text-faint">
              Where you read most
            </span>
            <span className="text-micro text-text-faint/60 tabular-nums">
              {venueBreakdown.length} venues
            </span>
          </div>
          <VenueGrid items={venueBreakdown} max={maxVenue} />
        </div>
      )}

      {/* ── Continuous learning calendar ── */}
      <div className="relative px-7 pb-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-micro font-semibold uppercase tracking-[0.18em] text-text-faint">
            Continuous reading
          </span>
          <StreakBadge cells={realCells ?? undefined} />
        </div>
        <ReadingCalendar cells={realCells ?? undefined} />
      </div>

      {/* ── Sticky topics (keyword weighted cloud) ── */}
      {stats.keywordBreakdown.length > 0 && (
        <div className="relative px-7 pb-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-micro font-semibold uppercase tracking-[0.18em] text-text-faint">
              Topics sticky with you
            </span>
            <span className="text-micro text-text-faint/60 tabular-nums">
              from {stats.saved} saves
            </span>
          </div>
          <KeywordCloud items={stats.keywordBreakdown} />
        </div>
      )}

      {/* ── Archetype pull ── */}
      <div className="relative mx-7 mb-6 rounded-2xl bg-bg-secondary/40 px-5 py-4 flex items-start gap-4">
        <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-accent text-bg shrink-0 shadow-card text-lead">
          {archetype.glyph}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-micro font-semibold uppercase tracking-[0.18em] text-text-faint">
            Reader archetype
          </p>
          <p
            className="text-title-lg lg:text-[22px] italic text-heading leading-tight mt-0.5 tracking-tight font-reading"
          >
            {archetype.label}
          </p>
          <p className="text-meta text-text-muted leading-[1.55] mt-1 max-w-[48ch]">
            {archetype.description}
          </p>
        </div>
      </div>

    </div>
  );
}

function HeroStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: Tone | "peach";
}) {
  const accent =
    tone === "accent"
      ? "text-accent"
      : tone === "tag"
      ? "text-tag"
      : tone === "link"
      ? "text-link"
      : tone === "peach"
      ? "text-peach"
      : "text-heading";

  return (
    <div
      className="bg-surface px-4 py-4 flex flex-col items-start"
    >
      <span className="text-caption uppercase tracking-[0.16em] text-text-faint">
        {label}
      </span>
      <span
        className={`mt-2 text-[30px] lg:text-[34px] font-semibold tabular-nums leading-none ${accent}`}
      >
        {value}
      </span>
    </div>
  );
}

// ── Charts ─────────────────────────────────────────────────────

function TypeTiles({
  breakdown,
  total,
}: {
  breakdown: { papers: number; events: number; jobs: number };
  total: number;
}) {
  const tiles = [
    {
      key: "papers",
      label: "Papers",
      count: breakdown.papers,
      color: "text-accent",
      bg: "bg-accent-dim",
      ring: "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_22%,transparent)]",
    },
    {
      key: "events",
      label: "Events",
      count: breakdown.events,
      color: "text-tag",
      bg: "bg-tag-dim",
      ring: "shadow-[inset_0_0_0_1px_rgba(194,99,14,0.20)]",
    },
    {
      key: "jobs",
      label: "Jobs",
      count: breakdown.jobs,
      color: "text-peach",
      bg: "bg-peach-dim",
      ring: "shadow-[inset_0_0_0_1px_rgba(217,122,48,0.20)]",
    },
  ];

  if (total === 0) return null;

  return (
    <div
      className="grid grid-cols-3 gap-2"
    >
      {tiles.map((t) => {
        const pct = total > 0 ? Math.round((t.count / total) * 100) : 0;
        const empty = t.count === 0;
        return (
          <div
            key={t.key}
            className={`relative rounded-xl px-3.5 py-3 transition-all duration-300 ${
              empty
                ? "bg-bg-secondary/30 text-text-faint/60"
                : `${t.bg} ${t.ring}`
            }`}
          >
            <div className={`text-[24px] font-semibold tabular-nums leading-none ${empty ? "" : t.color}`}>
              {t.count}
            </div>
            <div className="mt-1.5 flex items-baseline justify-between text-micro uppercase tracking-[0.14em]">
              <span className={empty ? "text-text-faint/60" : "text-text-muted"}>
                {t.label}
              </span>
              {!empty && (
                <span className={`tabular-nums ${t.color} opacity-70`}>
                  {pct}%
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Venue grid — blocks, warm intensity by rank ───────────────

function VenueGrid({
  items,
  max,
}: {
  items: { name: string; count: number }[];
  max: number;
}) {
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 gap-2"
    >
      {items.map((v) => {
        const weight = v.count / max;
        // Three warm intensity tiers
        const tier =
          weight > 0.66
            ? {
                text: "text-accent",
                bg: "bg-accent-dim",
                ring: "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_22%,transparent)]",
              }
            : weight > 0.33
            ? {
                text: "text-tag",
                bg: "bg-tag-dim",
                ring: "shadow-[inset_0_0_0_1px_rgba(194,99,14,0.20)]",
              }
            : {
                text: "text-peach",
                bg: "bg-peach-dim",
                ring: "shadow-[inset_0_0_0_1px_rgba(217,122,48,0.18)]",
              };
        return (
          <div
            key={v.name}
            className={`rounded-xl px-3 py-2.5 ${tier.bg} ${tier.ring} flex items-baseline justify-between gap-2`}
          >
            <span className="truncate text-meta text-heading font-medium">
              {v.name}
            </span>
            <span
              className={`text-body-lg font-semibold tabular-nums leading-none ${tier.text}`}
            >
              {v.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Calendar (GitHub-style contribution grid) ──────────────────
//
// Real per-day counts only, from /api/read?aggregate=daily. When the API has
// nothing to return the grid says so rather than drawing something.

const CAL_WEEKS = 18;
const CAL_DAYS = 7;

// Fetches real per-day read counts and maps them into a cells grid
// aligned with the calendar (CAL_WEEKS columns × CAL_DAYS rows,
// newest column = today). Returns null while loading / when unauthenticated,
// so callers can fall back to the synthesized shimmer.
function useDailyActivityCells(): number[] | null {
  const [cells, setCells] = useState<number[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<{ daily: { date: string; count: number }[] }>(
          "/api/read?aggregate=daily",
          { cache: "no-store" },
        );
        if (cancelled) return;
        const byDate = new Map(data.daily.map((d) => [d.date, d.count]));
        const out = new Array<number>(CAL_WEEKS * CAL_DAYS).fill(0);
        // Fill grid newest-first: rightmost column = today (UTC, to
        // match the server's UTC bucketing in /api/read?aggregate=daily).
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        for (let w = 0; w < CAL_WEEKS; w++) {
          for (let d = 0; d < CAL_DAYS; d++) {
            // cell at (w, d) represents (today - ((CAL_WEEKS-1-w) * 7 + (CAL_DAYS-1-d))) days
            const daysAgo = (CAL_WEEKS - 1 - w) * 7 + (CAL_DAYS - 1 - d);
            const dt = new Date(today.getTime() - daysAgo * 86_400_000);
            const key = dt.toISOString().slice(0, 10);
            out[w * CAL_DAYS + d] = byDate.get(key) ?? 0;
          }
        }
        setCells(out);
      } catch {
        // swallow — fallback to synth
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return cells;
}

function streakFromCells(cells: number[]): number {
  // Count consecutive active cells working backward from the last column.
  let streak = 0;
  for (let w = CAL_WEEKS - 1; w >= 0; w--) {
    let anyActivity = false;
    for (let d = 0; d < CAL_DAYS; d++) {
      if (cells[w * CAL_DAYS + d] > 0) {
        anyActivity = true;
        break;
      }
    }
    if (anyActivity) streak++;
    else break;
  }
  return streak;
}

function StreakBadge({ cells: realCells }: { cells?: number[] }) {
  // No fabrication. This used to fall back to synthesizeActivity() — a seeded
  // pseudo-random grid derived from the total activity count — whenever the
  // real per-day API was unavailable, which is every signed-out visitor. The
  // streak was then counted off those invented weeks and shown as fact.
  if (!realCells) return null;
  const weeks = streakFromCells(realCells);
  if (weeks === 0) {
    return (
      <span className="text-micro text-text-faint/60 uppercase tracking-[0.14em]">
        No streak yet
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-caption text-accent font-medium tabular-nums"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-accent" aria-hidden>
        <path d="M12 2s4 4 4 8a4 4 0 0 1-8 0c0-2 2-3 2-6z" />
        <path d="M6 14c0 4 3 7 6 7s6-3 6-7c0-2-1-4-2-5-1 2-3 3-4 3s-3-1-4-3c-1 1-2 3-2 5z" />
      </svg>
      {weeks}-week streak
    </span>
  );
}

function ReadingCalendar({ cells: realCells }: { cells?: number[] }) {
  // The "no data" branch lives below the hooks, not above them — an early
  // return here would call useMemo conditionally.
  const cells = realCells ?? [];
  const maxActivity = Math.max(1, ...cells);

  const intensity = (v: number): number => {
    if (v <= 0) return 0;
    const ratio = v / maxActivity;
    if (ratio > 0.75) return 4;
    if (ratio > 0.5) return 3;
    if (ratio > 0.25) return 2;
    return 1;
  };

  const cellClass = (level: number) => {
    switch (level) {
      case 0:
        return "bg-bg-secondary/60";
      case 1:
        return "bg-accent/20 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_15%,transparent)]";
      case 2:
        return "bg-accent/40 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]";
      case 3:
        return "bg-accent/70 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]";
      default:
        return "bg-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent)]";
    }
  };

  // Weekday labels we'll surface
  const dayLabels = ["Mon", "Wed", "Fri"];
  // Rough month markers — synthesized labels positioned across weeks
  const monthMarkers = useMemo(() => {
    const today = new Date();
    const labels: { col: number; label: string }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < CAL_WEEKS; w++) {
      const d = new Date(today);
      d.setDate(today.getDate() - (CAL_WEEKS - 1 - w) * 7);
      const m = d.getMonth();
      if (m !== lastMonth) {
        labels.push({ col: w, label: d.toLocaleDateString("en-US", { month: "short" }) });
        lastMonth = m;
      }
    }
    return labels;
  }, []);

  if (!realCells) {
    return (
      <p className="text-micro text-text-faint/70">
        Your reading history appears here once you have opened a few papers.
      </p>
    );
  }
  return (
    <div>
      <div className="flex gap-2">
        {/* Weekday labels */}
        <div className="flex flex-col justify-between pt-3.5 shrink-0">
          {[0, 1, 2, 3, 4, 5, 6].map((d) => {
            const visible = d === 1 || d === 3 || d === 5;
            return (
              <span
                key={d}
                className="text-[9px] text-text-faint/70 h-[11px] leading-[11px]"
              >
                {visible ? dayLabels[Math.floor(d / 2)] : "\u00A0"}
              </span>
            );
          })}
        </div>
        {/* Grid */}
        <div className="flex-1 min-w-0">
          {/* Month labels */}
          <div
            className="grid mb-1 text-[9px] text-text-faint/70 uppercase tracking-[0.1em]"
            style={{ gridTemplateColumns: `repeat(${CAL_WEEKS}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: CAL_WEEKS }).map((_, w) => {
              const m = monthMarkers.find((x) => x.col === w);
              return (
                <span key={w} className="truncate">
                  {m ? m.label : ""}
                </span>
              );
            })}
          </div>
          {/* Cells */}
          <div
            className="grid gap-[2px]"
            style={{
              gridTemplateColumns: `repeat(${CAL_WEEKS}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: CAL_WEEKS }).map((_, w) => (
              <div key={w} className="grid grid-rows-7 gap-[2px]">
                {Array.from({ length: CAL_DAYS }).map((__, d) => {
                  const v = cells[w * CAL_DAYS + d];
                  const level = intensity(v);
                  return (
                    <span
                      key={d}
                      className={`block aspect-square rounded-[3px] transition-colors ${cellClass(level)}`}
                      title={v > 0 ? `${v} interaction${v === 1 ? "" : "s"}` : "no activity"}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Legend */}
      <div className="mt-3 flex items-center justify-end gap-1.5 text-micro text-text-faint/70">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`w-2.5 h-2.5 rounded-[3px] ${cellClass(l)}`} aria-hidden />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function KeywordCloud({ items }: { items: { name: string; count: number }[] }) {
  if (items.length === 0) return null;
  const max = items[0]?.count ?? 1;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((k) => {
        const weight = k.count / max;
        // Map weight → size + tone intensity
        const fontSize =
          weight > 0.75 ? 15 : weight > 0.5 ? 13.5 : weight > 0.3 ? 12.5 : 11.5;
        const tone =
          weight > 0.6 ? "accent" : weight > 0.3 ? "tag" : "peach";
        const bg =
          tone === "accent"
            ? "bg-accent-dim text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]"
            : tone === "tag"
            ? "bg-tag-dim text-tag shadow-[inset_0_0_0_1px_rgba(194,99,14,0.18)]"
            : "bg-peach-dim text-peach shadow-[inset_0_0_0_1px_rgba(217,122,48,0.18)]";
        return (
          <span
            key={k.name}
            className={`inline-flex items-center gap-1 px-2.5 py-[3px] rounded-md font-medium ${bg}`}
            style={{
              fontSize: `${fontSize}px`,
            }}
          >
            {k.name}
            {k.count > 1 && (
              <span className="text-micro opacity-60 tabular-nums">
                ×{k.count}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function composePullQuote({
  saved,
  read,
  savedRate,
}: {
  saved: number;
  read: number;
  savedRate: number;
}): string {
  if (read === 0) return "Signal-to-noise pending — come back after a few briefings.";
  if (saved === 0) return "You've read through your briefings but not bookmarked. Peer is still learning your filter.";
  if (savedRate >= 40) return `A ${savedRate}% save rate — you don't waste taps. The filter is trusting.`;
  if (savedRate >= 20) return `Roughly one in ${Math.round(100 / savedRate)} survives the scroll. A considered reader.`;
  return `Selective — you keep fewer than one in five. The bar is high, and Peer is learning it.`;
}

type Archetype = {
  label: string;
  description: string;
  glyph: string;
};

function computeArchetype({
  saved,
  read,
  savedRate,
  profile,
}: {
  saved: number;
  read: number;
  savedRate: number;
  profile: ReturnType<typeof useProfileStore.getState>["profile"];
}): Archetype {
  if (saved + read === 0) {
    return {
      label: "Just landed",
      description: "No reading history yet. Your first briefing will set the tone.",
      glyph: "✶",
    };
  }
  if (savedRate >= 40) {
    return {
      label: "Editorial Curator",
      description: "High trust in the filter. You save what you mean to return to, and Peer is already converging on your taste.",
      glyph: "✎",
    };
  }
  if (savedRate >= 20) {
    return {
      label: "Methodical Explorer",
      description: "Balanced rhythm — reading widely, saving deliberately. You let the briefing stretch you a little.",
      glyph: "◎",
    };
  }
  if (profile.researchTopics.length >= 3) {
    return {
      label: "Deep Specialist",
      description: "Narrow topics, high standards. You want depth, not volume — Peer should lean niche.",
      glyph: "◉",
    };
  }
  return {
    label: "Selective Reader",
    description: "You move quickly and keep little. Great for keeping the briefing tight — Peer will trim more.",
    glyph: "◆",
  };
}

// ── Section header (reused for Signals / Reading) ──────────────

function SectionHeader({
  label,
  onAdjust,
}: {
  label: string;
  onAdjust?: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between"
    >
      <span className="inline-flex items-center gap-2 text-micro font-semibold uppercase tracking-[0.18em] text-text-faint">
        <span className="inline-block w-3.5 h-[1.5px] bg-accent/70" aria-hidden />
        {label}
      </span>
      {onAdjust && (
        <button
          onClick={onAdjust}
          className="text-caption text-text-faint/80 hover:text-accent transition-colors active:scale-95"
        >
          adjust
        </button>
      )}
    </div>
  );
}

// ── Compact signal row ─────────────────────────────────────────

function SignalRow({
  tone,
  icon,
  label,
  items,
}: {
  tone: Tone;
  icon: ReactNode;
  label: string;
  items: string[];
}) {
  const chipClass = toneBadge(tone);
  const hasAny = items.length > 0;

  return (
    <div
      className="flex items-center gap-3"
    >
      <div className="flex items-center gap-1.5 shrink-0 w-[92px]">
        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${toneBadge(tone)}`}>
          {icon}
        </span>
        <span className="text-caption font-medium text-text-muted">
          {label}
        </span>
      </div>
      <div className="flex-1 min-w-0 flex items-center flex-wrap gap-1">
        {hasAny ? (
          items.map((it) => (
            <span
              key={it}
              className={`inline-block px-2 py-[2px] rounded-md text-caption ${chipClass}`}
            >
              {it}
            </span>
          ))
        ) : (
          <span className="text-caption text-text-faint/60">—</span>
        )}
      </div>
      <span className="text-caption text-text-faint/50 tabular-nums w-5 text-right shrink-0">
        {hasAny ? items.length : ""}
      </span>
    </div>
  );
}

// ── Reading stats ──────────────────────────────────────────────

function useReadingStats() {
  const savedPapers = useFeedStore((s) => s.savedPapers);
  const savedEvents = useFeedStore((s) => s.savedEvents);
  const savedJobs = useFeedStore((s) => s.savedJobs);
  const readItems = useFeedStore((s) => s.readItems);
  const lastRefresh = useFeedStore((s) => s.lastRefresh);

  const saved = savedPapers.length + savedEvents.length + savedJobs.length;
  const read = Object.keys(readItems).length;

  // Saved-item type distribution
  const typeBreakdown = {
    papers: savedPapers.length,
    events: savedEvents.length,
    jobs: savedJobs.length,
  };

  // Top keywords across saved papers' experiment keywords
  const kwCounts = new Map<string, number>();
  savedPapers.forEach((p) => {
    (p.summaryExperimentKeywords ?? []).forEach((k) => {
      const key = k.toLowerCase();
      kwCounts.set(key, (kwCounts.get(key) ?? 0) + 1);
    });
  });
  const keywordBreakdown = [...kwCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Venue breakdown (saved papers)
  const venueCounts = new Map<string, number>();
  savedPapers.forEach((p) => {
    if (p.venue) venueCounts.set(p.venue, (venueCounts.get(p.venue) ?? 0) + 1);
  });
  const venueBreakdown = [...venueCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  const topVenue = venueBreakdown[0] ?? null;

  // Top source (saved papers)
  const sourceCounts = new Map<string, number>();
  savedPapers.forEach((p) => {
    sourceCounts.set(p.source, (sourceCounts.get(p.source) ?? 0) + 1);
  });
  const topSourceEntry = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const topSource = topSourceEntry ? { name: topSourceEntry[0], count: topSourceEntry[1] } : null;

  // Avg match (saved papers with scores)
  const scoredPapers = savedPapers.filter((p) => typeof p.relevanceScore === "number");
  const avgMatch = scoredPapers.length
    ? Math.round(
        (scoredPapers.reduce((a, p) => a + (p.relevanceScore ?? 0), 0) / scoredPapers.length) * 100
      )
    : null;

  // Reader profile classification (based on combined activity)
  const activity = saved + read;
  let readerLabel: string;
  let readerHint: string | undefined;
  if (activity === 0) {
    readerLabel = "Just arrived";
    readerHint = "read a few briefings";
  } else if (activity < 10) {
    readerLabel = "Casual";
    readerHint = `${activity} interactions`;
  } else if (activity < 40) {
    readerLabel = "Regular";
    readerHint = `${activity} interactions`;
  } else {
    readerLabel = "Heavy";
    readerHint = `${activity} interactions`;
  }

  const lastBriefing = lastRefresh ? (formatTimeAgo(lastRefresh) ?? "—") : null;

  return {
    saved,
    read,
    avgMatch,
    topVenue,
    topSource,
    readerLabel,
    readerHint,
    lastBriefing,
    venueBreakdown,
    typeBreakdown,
    keywordBreakdown,
  };
}

interface PastBriefing {
  id: number;
  deliveredAt: string;
  channel: "inapp" | "email" | "both";
  itemIds: string[];
  payload: { items?: { id: string; title?: string; summary?: string }[] } | null;
  openedAt: string | null;
}

// ── Learned preferences (the live ledger, human-readable + resettable) ──

function PreferenceChip({
  label,
  weight,
  tone,
}: {
  label: string;
  weight: number;
  tone: "accent" | "muted";
}) {
  // Decayed net strength → a subtle 1–3 intensity tier.
  const tier = weight >= 3 ? 2 : weight >= 1.5 ? 1 : 0;
  const cls =
    tone === "accent"
      ? [
          "bg-accent-dim/40 text-accent/80",
          "bg-accent-dim/70 text-accent",
          "bg-accent-dim text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent)]",
        ][tier]
      : [
          "bg-bg-secondary/50 text-text-faint",
          "bg-bg-secondary/70 text-text-muted",
          "bg-red/10 text-red/90 shadow-[inset_0_0_0_1px_rgba(185,28,28,0.15)]",
        ][tier];
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-meta ${cls}`}>
      {label}
    </span>
  );
}

function LearnedPreferences({
  profile,
  onReset,
}: {
  profile: ReturnType<typeof useProfileStore.getState>["profile"];
  onReset: () => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const { liked, disliked } = useMemo(
    // `now` is left to the lib default (Date.now) so we don't call an impure
    // function directly during render; the summary only recomputes on ledger
    // change, and sub-render time drift is irrelevant for a decayed display.
    () => summarizePreferenceLedger(profile.preferenceLedger, undefined, 8),
    [profile.preferenceLedger],
  );
  const hasAny = liked.length > 0 || disliked.length > 0;

  return (
    <section
      className="mt-5 rounded-3xl bg-surface shadow-card overflow-hidden animate-fade-in-up"
      style={{ animationDelay: "120ms" }}
    >
      <div className="px-7 pt-6 pb-4 flex items-baseline justify-between gap-4">
        <span className="inline-flex items-center gap-2 text-micro font-semibold uppercase tracking-[0.22em] text-accent/90">
          <span className="inline-block w-4 h-[1.5px] bg-accent/70" />
          What Peer has learned
        </span>
        {hasAny &&
          (confirmReset ? (
            <span className="text-caption flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  onReset();
                  setConfirmReset(false);
                }}
                className="text-red hover:text-red/80 font-medium transition-colors active:scale-95"
              >
                Reset all
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="text-text-faint hover:text-text-muted transition-colors active:scale-95"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="text-caption text-text-faint/80 hover:text-accent transition-colors shrink-0"
            >
              Reset
            </button>
          ))}
      </div>
      <div className="px-7 pb-6">
        {!hasAny ? (
          <p className="text-body-sm text-text-faint/80 leading-relaxed max-w-[60ch]">
            Nothing learned yet. As you like, save, or dismiss papers, Peer builds a private
            taste profile here — quietly boosting topics you favor and easing off ones you skip.
            Like and Save count equally; dismissing eases a topic down.
          </p>
        ) : (
          <div className="space-y-4">
            {liked.length > 0 && (
              <div>
                <p className="text-micro font-semibold uppercase tracking-[0.16em] text-text-faint mb-2">
                  Leaning toward
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {liked.map((row) => (
                    <PreferenceChip key={`like-${row.label}`} label={row.label} weight={row.weight} tone="accent" />
                  ))}
                </div>
              </div>
            )}
            {disliked.length > 0 && (
              <div>
                <p className="text-micro font-semibold uppercase tracking-[0.16em] text-text-faint mb-2">
                  Easing off
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {disliked.map((row) => (
                    <PreferenceChip key={`dis-${row.label}`} label={row.label} weight={row.weight} tone="muted" />
                  ))}
                </div>
              </div>
            )}
            <p className="text-caption text-text-faint/70 leading-relaxed pt-1">
              Learned from your likes, saves, and dismissals. Weights fade over ~2 months, and your
              required topics are never eased off.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function PastBriefings() {
  const [briefings, setBriefings] = useState<PastBriefing[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<{ briefings: PastBriefing[] }>(
          "/api/briefings",
          { cache: "no-store" },
        );
        if (!cancelled) {
          setBriefings(data.briefings ?? []);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;
  if (!briefings || briefings.length === 0) {
    return (
      <section
        className="mt-8 rounded-2xl bg-surface shadow-card px-7 py-6"
      >
        <p className="text-micro font-semibold uppercase tracking-[0.18em] text-text-faint mb-1.5">
          Past briefings
        </p>
        <p className="text-body-sm text-text-faint/80">
          Your first daily briefing will land here once the cron fires at your preferred hour.
        </p>
      </section>
    );
  }

  return (
    <section
      className="mt-8 rounded-2xl bg-surface shadow-card overflow-hidden"
    >
      <div className="px-7 pt-6 pb-3 flex items-center justify-between">
        <p className="text-micro font-semibold uppercase tracking-[0.18em] text-text-faint">
          Past briefings
        </p>
        <span className="text-micro text-text-faint/60 tabular-nums">
          {briefings.length} delivered
        </span>
      </div>
      <ul className="divide-y divide-border/70">
        {briefings.slice(0, 20).map((b) => {
          const items = b.payload?.items ?? [];
          const preview = items.slice(0, 3).map((i) => i.title).filter(Boolean).join(" · ");
          return (
            <li key={b.id} className="px-7 py-3.5 flex items-start gap-4">
              <div className="shrink-0 w-[84px] pt-0.5">
                <p className="text-caption text-text-muted tabular-nums">
                  {(formatTimeAgo(b.deliveredAt) ?? "—")}
                </p>
                <p className="text-micro text-text-faint/60 uppercase tracking-[0.1em] mt-0.5">
                  {b.channel}
                </p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-body-sm text-text truncate">
                  {preview || `${items.length} items`}
                </p>
                <p className="text-caption text-text-faint mt-0.5 tabular-nums">
                  {b.itemIds.length} items
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Edit mode: inline editor ───────────────────────────────────

function EditView({
  profile,
  name,
  setName,
  updateTopics,
  updateSoftTopics,
  updatePreferredJournals,
  updateSchool,
  updateCurrentProject,
  updateCurrentChallenges,
  updateFeedFocus,
  updateFeedFreshness,
  updatePaperCount,
  updateFeedSourceMix,
  updateFeedImportance,
  updateFeedDiscoveryMode,
  updateFeedAvoidReviews,
  updateFeedAvoidOldPapers,
  updateFeedAvoidBroadSurveys,
  updateAdvisorName,
  confirmAdvisorAuthor,
  clearAdvisorAuthor,
  updateCareerStage,
  updateIndustryPreference,
}: {
  profile: ReturnType<typeof useProfileStore.getState>["profile"];
  name: string;
  setName: (s: string) => void;
  updateTopics: (v: string[]) => void;
  updateSoftTopics: (v: string[]) => void;
  updatePreferredJournals: (v: string[]) => void;
  updateSchool: (s: string) => void;
  updateCurrentProject: (s: string) => void;
  updateCurrentChallenges: (s: string) => void;
  updateFeedFocus: ReturnType<typeof useProfileStore.getState>["updateFeedFocus"];
  updateFeedFreshness: ReturnType<typeof useProfileStore.getState>["updateFeedFreshness"];
  updatePaperCount: ReturnType<typeof useProfileStore.getState>["updatePaperCount"];
  updateFeedSourceMix: ReturnType<typeof useProfileStore.getState>["updateFeedSourceMix"];
  updateFeedImportance: ReturnType<typeof useProfileStore.getState>["updateFeedImportance"];
  updateFeedDiscoveryMode: ReturnType<typeof useProfileStore.getState>["updateFeedDiscoveryMode"];
  updateFeedAvoidReviews: ReturnType<typeof useProfileStore.getState>["updateFeedAvoidReviews"];
  updateFeedAvoidOldPapers: ReturnType<typeof useProfileStore.getState>["updateFeedAvoidOldPapers"];
  updateFeedAvoidBroadSurveys: ReturnType<typeof useProfileStore.getState>["updateFeedAvoidBroadSurveys"];
  updateAdvisorName: (s: string) => void;
  confirmAdvisorAuthor: (authorId: string, label: string) => void;
  clearAdvisorAuthor: () => void;
  updateCareerStage: (s: typeof profile.careerStage) => void;
  updateIndustryPreference: (s: typeof profile.industryVsAcademia) => void;
}) {
  // Pulled straight from the store rather than threaded through this
  // component's already-long prop list.
  const updateFeedAiProvider = useProfileStore((s) => s.updateFeedAiProvider);
  const updateFeedAiApiKey = useProfileStore((s) => s.updateFeedAiApiKey);
  const updateDeepReportEnabled = useProfileStore(
    (s) => s.updateDeepReportEnabled,
  );

  return (
    <div
      className="rounded-2xl bg-surface shadow-card divide-y divide-border/70 animate-fade-in-up"
    >
      <EditRow icon={<IconUser />} tone="neutral" label="Name">
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          placeholder="Aspen"
          className="w-full bg-bg-secondary/40 rounded-lg px-3 py-2 text-body text-text placeholder-text-faint/60 outline-none focus:bg-bg-secondary/60 focus:ring-2 focus:ring-accent/20 transition-all"
        />
      </EditRow>
      <EditRow icon={<IconHash />} tone="accent" label="Topics">
        <div className="space-y-6">
          <div>
            <p className="mb-3 text-caption text-text-faint">
              {SURFACE_TOPIC_DESCRIPTIONS.papers}
            </p>
            <TopicsField
              required={profile.researchTopics}
              soft={profile.softTopics ?? []}
              onChangeRequired={updateTopics}
              onChangeSoft={updateSoftTopics}
            />
          </div>
        </div>
      </EditRow>

      <EditRow icon={<IconBuilding size={13} strokeWidth={1.9} />} tone="neutral" label="Affiliation">
        <div className="space-y-2">
          <div>
            <p className="text-micro font-semibold uppercase tracking-[0.14em] text-text-faint/80 mb-1.5">
              School / org
            </p>
            <SchoolAutocomplete
              value={profile.school ?? ""}
              onChange={updateSchool}
              placeholder="University or company"
            />
          </div>
          <div>
            <p className="text-micro font-semibold uppercase tracking-[0.14em] text-text-faint/80 mb-1.5">
              Advisor / PI
            </p>
            <AdvisorField
              advisorName={profile.advisorName ?? ""}
              school={profile.school ?? ""}
              advisorAuthorId={profile.advisorAuthorId}
              advisorAuthorLabel={profile.advisorAuthorLabel}
              onChangeName={updateAdvisorName}
              onConfirm={confirmAdvisorAuthor}
              onClear={clearAdvisorAuthor}
            />
          </div>
        </div>
      </EditRow>

      <EditRow icon={<IconFlask />} tone="accent" label="Project">
        <textarea
          value={profile.currentProject ?? ""}
          onChange={(e) => updateCurrentProject(e.target.value)}
          placeholder="What specific project are you working on right now?"
          rows={3}
          className="w-full bg-bg-secondary/40 rounded-lg px-3 py-2 text-body text-text placeholder-text-faint/60 outline-none focus:bg-bg-secondary/60 focus:ring-2 focus:ring-accent/20 transition-all resize-y leading-relaxed"
        />
        <p className="text-caption text-text-faint/75 mt-1.5 px-1 leading-relaxed">
          Describe your project in 1–3 sentences. Peer uses this to bias the briefing toward your actual work, not just your generic field.
        </p>
      </EditRow>

      <EditRow icon={<IconHash />} tone="tag" label="Challenges">
        <textarea
          value={profile.currentChallenges ?? ""}
          onChange={(e) => updateCurrentChallenges(e.target.value)}
          placeholder="What open problems are you hunting information for?"
          rows={3}
          className="w-full bg-bg-secondary/40 rounded-lg px-3 py-2 text-body text-text placeholder-text-faint/60 outline-none focus:bg-bg-secondary/60 focus:ring-2 focus:ring-accent/20 transition-all resize-y leading-relaxed"
        />
        <p className="text-caption text-text-faint/75 mt-1.5 px-1 leading-relaxed">
          The unknowns you wish someone would solve for you. Highest-leverage signal — papers that mention these will rise to the top.
        </p>
      </EditRow>

      <EditRow icon={<IconCareer />} tone="neutral" label="Career">
        <div className="space-y-3">
          <div>
            <p className="text-micro font-semibold uppercase tracking-[0.14em] text-text-faint/80 mb-1.5">
              Stage
            </p>
            <div className="flex flex-wrap gap-1.5">
              {careerStages.map((s) => {
                const active = profile.careerStage === s;
                return (
                  <button
                    key={s}
                    onClick={() => updateCareerStage(s)}
                    className={`text-meta px-2.5 py-1 rounded-full transition-all duration-200 ease-out active:scale-[0.94] ${
                      active
                        ? "bg-accent-dim text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent)] scale-[1.03]"
                        : "text-text-faint hover:text-text-muted bg-bg-secondary/40 hover:bg-bg-secondary/70"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-micro font-semibold uppercase tracking-[0.14em] text-text-faint/80 mb-1.5">
              Looking toward
            </p>
            <div className="flex flex-wrap gap-1.5">
              {industryPreferences.map((p) => {
                const active = profile.industryVsAcademia === p;
                return (
                  <button
                    key={p}
                    onClick={() => updateIndustryPreference(p)}
                    className={`text-meta px-2.5 py-1 rounded-full transition-all duration-200 ease-out active:scale-[0.94] ${
                      active
                        ? "bg-accent-dim text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent)] scale-[1.03]"
                        : "text-text-faint hover:text-text-muted bg-bg-secondary/40 hover:bg-bg-secondary/70"
                    }`}
                  >
                    {industryLabels[p] ?? p}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </EditRow>

      <EditRow icon={<IconBook size={13} strokeWidth={1.9} />} tone="link" label="Paper radar">
        <div className="space-y-4">
          <p className="text-meta text-text-faint/85 leading-relaxed">
            Tell Peer how widely to look before it chooses your final daily papers.
          </p>
          <ChoiceGroup
            label="Focus"
            value={profile.feedFocus}
            options={PAPER_FOCUS_OPTIONS}
            onChange={(value) => updateFeedFocus(value as typeof profile.feedFocus)}
          />
          <ChoiceGroup
            label="Freshness"
            value={profile.feedFreshness}
            options={PAPER_FRESHNESS_OPTIONS}
            onChange={(value) => updateFeedFreshness(value as typeof profile.feedFreshness)}
          />
          <ChoiceGroup
            label="Papers shown"
            value={profile.paperCount}
            options={PAPER_COUNT_OPTIONS}
            onChange={(value) => updatePaperCount(value as typeof profile.paperCount)}
          />
          <ChoiceGroup
            label="Sources"
            value={profile.feedSourceMix}
            options={PAPER_SOURCE_OPTIONS}
            onChange={(value) => updateFeedSourceMix(value as typeof profile.feedSourceMix)}
          />
          <div>
            <p className="text-micro font-semibold uppercase tracking-[0.14em] text-text-faint/80 mb-1.5">
              Preferred journals
            </p>
            <ChipInput
              values={profile.preferredJournals ?? []}
              onChange={updatePreferredJournals}
              placeholder="Add a journal, press Enter"
              tone="link"
            />
            <p className="mt-1.5 px-0.5 text-micro leading-snug text-text-faint/70">
              Journals you trust most. Peer treats these as a primary source and boosts their
              papers (+1/3 of the score) so they rise to the top — though an exceptionally
              on-target paper from elsewhere can still win.
            </p>
          </div>
          <ChoiceGroup
            label="Importance"
            value={profile.feedImportance}
            options={PAPER_IMPORTANCE_OPTIONS}
            onChange={(value) => updateFeedImportance(value as typeof profile.feedImportance)}
          />
          <ChoiceGroup
            label="Discovery"
            value={profile.feedDiscoveryMode}
            options={PAPER_DISCOVERY_OPTIONS}
            onChange={(value) => updateFeedDiscoveryMode(value as typeof profile.feedDiscoveryMode)}
          />
          <div>
            <p className="text-micro font-semibold uppercase tracking-[0.14em] text-text-faint/80 mb-1.5">
              Avoid
            </p>
            <div className="flex flex-wrap gap-1.5">
              <TogglePill
                label="Review papers"
                active={profile.feedAvoidReviews}
                onToggle={() => updateFeedAvoidReviews(!profile.feedAvoidReviews)}
              />
              <TogglePill
                label="Old papers"
                active={profile.feedAvoidOldPapers}
                onToggle={() => updateFeedAvoidOldPapers(!profile.feedAvoidOldPapers)}
              />
              <TogglePill
                label="Broad surveys"
                active={profile.feedAvoidBroadSurveys}
                onToggle={() => updateFeedAvoidBroadSurveys(!profile.feedAvoidBroadSurveys)}
              />
            </div>
          </div>
        </div>
      </EditRow>

      {/* Credentials and model settings. These had NO section on this page —
          they lived only in the one-time /welcome wizard and permanently
          pinned to the daily feed, which is why the feed ended up doing double
          duty as the settings page. They have a home now. */}
      <EditRow icon={<IconKey />} tone="neutral" label="AI provider">
        <div className="space-y-3">
          <p className="text-caption leading-relaxed text-text-muted">
            Tier 0 uses no AI API and always works. To turn on Tier 2 reranking
            and written relevance reasons, choose a provider and add your own
            key. Peer sends model calls only to the key you enter here.
          </p>
          <AiKeyFields
            provider={profile.feedAiProvider}
            apiKey={profile.feedAiApiKey ?? ""}
            onProviderChange={updateFeedAiProvider}
            onApiKeyChange={updateFeedAiApiKey}
            idPrefix="profile-ai"
          />
        </div>
      </EditRow>

      <EditRow icon={<IconBook size={13} strokeWidth={1.9} />} tone="link" label="Deep report">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-caption leading-relaxed text-text-muted">
              Read each paper&apos;s full text (HTML when available, PDF as
              fallback) before writing the report. Costs more tokens per paper
              and produces paper-grounded reports instead of a summary of the
              abstract.
            </p>
            <Toggle
              checked={profile.deepReportEnabled}
              onChange={(next) => updateDeepReportEnabled(next)}
              disabled={!feedsUseAi(profile)}
              className="mt-0.5"
              aria-label="Deep report"
            />
          </div>
          {!feedsUseAi(profile) && (
            <p className="text-micro leading-relaxed text-text-faint">
              Add your own provider and key above first. Without one, Peer shows
              the Tier 0 report and makes no AI model call.
            </p>
          )}
        </div>
      </EditRow>

      <EditRow icon={<IconGlobe />} tone="tag" label="Data APIs">
        <div className="space-y-3">
          <p className="text-caption leading-relaxed text-text-muted">
            Optional third-party keys that widen coverage. All of Peer works
            without them.
          </p>
          <ConnectorPanel />
        </div>
      </EditRow>



    </div>
  );
}

function IconKey() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="14" r="4" />
      <path d="M11 11l7-7M16 6l3 3M14 8l3 3" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

function AppearanceCard({
  colorTheme,
  onChange,
}: {
  colorTheme: ColorTheme;
  onChange: (theme: ColorTheme) => void;
}) {
  return (
    <section
      className="mt-5 rounded-3xl bg-surface shadow-card overflow-hidden animate-fade-in-up"
      style={{ animationDelay: "40ms" }}
    >
      <div className="px-7 pt-6 pb-4">
        <p className="text-caption font-semibold uppercase tracking-[0.18em] text-text-faint/80">
          Appearance
        </p>
        <h2 className="mt-1 text-title-lg text-heading font-medium tracking-[-0.01em]">
          Color theme
        </h2>
      </div>
      <div className="px-7 pb-6">
        <ColorThemePicker value={colorTheme} onChange={onChange} />
        <RevealMotionToggle />
      </div>
    </section>
  );
}

/**
 * Opt back into the full decode animation when the operating system asks for
 * reduced motion. Off by default — the OS preference is respected unless the
 * reader deliberately turns this on.
 */
function RevealMotionToggle() {
  const revealMotion = useUIStore((s) => s.revealMotion);
  const setRevealMotion = useUIStore((s) => s.setRevealMotion);
  const forced = revealMotion === "full";

  return (
    <div className="mt-6 pt-5 border-t border-border/50">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-body-sm font-medium text-heading">
            Always animate report text
          </p>
          <p className="mt-1 text-meta leading-relaxed text-text-muted">
            Reports and briefings decode into place as they are written. Your
            system currently asks apps to reduce motion, so Peer fades the text
            in gently instead. Turn this on to always play the full effect.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={forced}
          aria-label="Always animate report text"
          onClick={() => setRevealMotion(forced ? "auto" : "full")}
          className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ease-out ${
            forced ? "bg-accent" : "bg-bg-secondary"
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-bg shadow transition-transform duration-200 ease-out ${
              forced ? "translate-x-4" : ""
            }`}
          />
        </button>
      </div>
    </div>
  );
}

function ColorThemePicker({
  value,
  onChange,
}: {
  value: ColorTheme;
  onChange: (theme: ColorTheme) => void;
}) {
  const [mode, accent] = value.split(":") as [ThemeMode, ThemeAccent];

  return (
    <div className="space-y-6">
      {/* Mode: auto / light / dark */}
      <div>
        <p className="mb-2 text-micro font-semibold uppercase tracking-[0.18em] text-text-faint/80">
          Mode
        </p>
        <div className="inline-flex items-center gap-1 rounded-full bg-bg-secondary/70 shadow-well p-1">
          {themeModeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={mode === option.value}
              onClick={() => onChange(`${option.value}:${accent}` as ColorTheme)}
              className={`h-8 px-4 rounded-full text-meta font-medium transition-all duration-200 ease-out active:scale-[0.96] ${
                mode === option.value
                  ? "bg-surface text-heading shadow-card"
                  : "text-text-muted hover:text-heading"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Accent palette: one color drives the whole palette */}
      <div>
        <p className="mb-1 text-micro font-semibold uppercase tracking-[0.18em] text-text-faint/80">
          Color
        </p>
        <p className="mb-3 text-meta text-text-muted">
          One pick tunes the accent, secondaries, and the neutral cast together.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {themeAccentOptions.map((option) => {
            const selected = accent === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                title={option.label}
                onClick={() => onChange(`${mode}:${option.value}` as ColorTheme)}
                className={`group relative inline-flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 ease-out active:scale-[0.94] ${
                  selected ? "shadow-card-hover scale-[1.06]" : "shadow-card hover:scale-[1.04]"
                }`}
                style={{
                  background: `linear-gradient(135deg, ${option.seed} 0%, ${option.seed} 55%, ${option.seedDark} 100%)`,
                }}
              >
                {selected && (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-bg/90 text-heading shadow-card">
                    <IconCheck />
                  </span>
                )}
                <span className="sr-only">{option.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-meta text-text-faint">
          {themeAccentOptions.find((o) => o.value === accent)?.label}
        </p>
      </div>
    </div>
  );
}

function EditRow({
  icon,
  tone = "neutral",
  label,
  children,
}: {
  icon: ReactNode;
  tone?: Tone;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className="flex items-start gap-4 px-5 py-4"
    >
      <div className="flex items-center gap-2.5 shrink-0 w-[108px] pt-1">
        <span
          className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${toneBadge(tone)}`}
        >
          {icon}
        </span>
        <span className="text-meta font-medium text-text-faint uppercase tracking-[0.1em]">
          {label}
        </span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// toneBadge, ChipInput, and the module-level drag state now live in
// components/profile/field-kit.tsx (imported at the top of this file).
