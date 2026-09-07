"use client";

// First-run onboarding wizard. Apple-setup-style: one idea per page, every
// page optional except Topics (which the feed needs to produce a real first
// briefing). Writes straight to the shared profile store — same store, same
// field components as /profile — and on finish marks onboarding complete and
// hands off to the feed with the coachmark tour (`/?tour=1`).
//
// Resume-aware: per-step completeness is derived live from the profile (see
// ./completeness), the wizard auto-opens at the first incomplete step, and
// the step rail shows done-ticks with click-to-jump — anything already done
// is visibly done and never has to be redone.
//
// This page intentionally renders regardless of the onboarding flag, so a
// developer can open /welcome at any time to iterate. The first-run *gating*
// (auto-redirect for brand-new users) lives in <FirstRunGate>.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useProfileStore } from "@/store/profile";
import type { Entitlement } from "@/lib/entitlement/types";
import { entitlementGrants } from "@/lib/entitlement/allowance";
import { careerStages, industryPreferences } from "@/types";
import type { UserProfile } from "@/types";
import {
  ChipInput,
  ChoiceGroup,
  RadioGroup,
  TogglePill,
  TopicsField,
  industryLabels,
  PAPER_FOCUS_OPTIONS,
  PAPER_FRESHNESS_OPTIONS,
  PAPER_COUNT_OPTIONS,
  PAPER_SOURCE_OPTIONS_DETAILED,
  PAPER_IMPORTANCE_OPTIONS,
  PAPER_DISCOVERY_OPTIONS,
} from "@/components/profile/field-kit";
import {
  AiKeyFields,
  ApiKeyHelp,
  AiProviderGuide,
  AiProviderRecommendation,
  providerShortLabel,
} from "@/components/profile/ai-setup";
import { SchoolAutocomplete } from "@/components/profile/school-autocomplete";
import { AdvisorField } from "@/components/profile/advisor-field";
import { CountryMultiSelect } from "@/components/profile/country-multi-select";
import { ConnectorPanel } from "@/components/profile/connector-panel";
import { useProfileSettled } from "@/components/first-run";
import { Callout } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";
import { sectionLabel } from "@/components/ui/section-label";
import { cardShell } from "@/components/ui/card-shell";
import { cn } from "@/lib/cn";
import { SURFACE_TOPIC_DESCRIPTIONS } from "@/lib/profile/topic-copy";
import {
  STEP_META,
  type StepKey,
  connectorCount,
  firstIncompleteStep,
  isStepDone,
  readPersonaDone,
  stepIndexFromKey,
} from "./completeness";
import {
  createTopicMirroringController,
  type TopicMirroringController,
} from "./topic-mirroring";

const DEFAULT_NAME = "Peer Member";
const TOPICS_IDX = STEP_META.findIndex((m) => m.key === "topics");

// The persona result lives in localStorage and never changes while this page
// is mounted (the quiz is its own route) — a no-op subscription is enough.
const subscribeNoop = () => () => {};
const personaServerSnapshot = () => false;
const requestedStepServerSnapshot = () => null;
const readRequestedStep = () => {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("step");
};

export default function WelcomePage() {
  const router = useRouter();
  const profile = useProfileStore((s) => s.profile);
  // ABC-freemium 1-15 — the `ai` step is complete when the reader has AI at all.
  // ABC-freemium 6-04 — a capability question, so the anonymous view while the
  // plan is unknown: the step reads as not-yet-done rather than done, which is
  // the direction that shows the reader the step instead of hiding it.
  const entitlement = entitlementGrants(
    useProfileStore((s) => s.entitlement),
  );
  const store = useProfileStore();
  const topicMirroringRef = useRef<TopicMirroringController | null>(null);
  const completeOnboarding = useProfileStore((s) => s.completeOnboarding);
  // Wait for local hydration AND the initial remote sync before choosing the
  // resume position — otherwise a signed-in returning user's wizard freezes
  // its start step from the pre-sync default profile (stuck at Basics with
  // every tick lit once the pull lands).
  const settled = useProfileSettled();

  // Prerender-safe read of the persona quiz result (false on the server and
  // during the first client paint, the real value once mounted).
  const personaDone = useSyncExternalStore(
    subscribeNoop,
    readPersonaDone,
    personaServerSnapshot,
  );
  const requestedStep = useSyncExternalStore(
    subscribeNoop,
    readRequestedStep,
    requestedStepServerSnapshot,
  );

  // The wizard opens at the first incomplete step (a returning visitor
  // resumes; a fully set-up profile lands on the final step where "Enter
  // Peer" is one click away). The position is frozen on the first hydrated
  // render via the documented adjust-state-during-render pattern, so it
  // never re-fires while the user is typing or when a remote sync lands
  // mid-session.
  const [manualStep, setManualStep] = useState<number | null>(null);
  const [autoStart, setAutoStart] = useState<number | null>(null);
  if (settled && autoStart === null) {
    setAutoStart(
      stepIndexFromKey(requestedStep) ??
        firstIncompleteStep(profile, readPersonaDone(), entitlement),
    );
  }
  const step = manualStep ?? autoStart;
  const setStep = setManualStep;

  const total = STEP_META.length;
  const key: StepKey | null = step === null ? null : STEP_META[step].key;
  const isLast = step === total - 1;

  // Topics is the one gate: the feed needs at least one required topic to
  // build a real first briefing.
  const topicsSatisfied = profile.researchTopics.length > 0;
  const canContinue = key === "topics" ? topicsSatisfied : true;

  // Live done-map: ticks update as the user types, and when a synced profile
  // lands mid-wizard old data ticks steps instead of silently pre-filling.
  const done = useMemo(
    () =>
      Object.fromEntries(
        STEP_META.map((m) => [
          m.key,
          isStepDone(m.key, profile, personaDone, entitlement),
        ]),
      ) as Record<StepKey, boolean>,
    [profile, personaDone, entitlement],
  );

  // Jumping is free among the first steps and everywhere once the topics
  // gate is satisfied — the rail never routes around the one requirement.
  const canJumpTo = (i: number) => i <= TOPICS_IDX || topicsSatisfied;

  // Base navigation on the computed `step` — the functional-updater form
  // would see `manualStep`, which stays null until the first manual move.
  const next = () => {
    if (step !== null) setManualStep(Math.min(step + 1, total - 1));
  };
  const back = () => {
    if (step !== null) setManualStep(Math.max(step - 1, 0));
  };

  const finishToTour = () => {
    completeOnboarding();
    router.push("/?tour=1");
  };

  // Skippers get the coachmark tour too — they need it most.
  const skipEverything = () => {
    completeOnboarding();
    router.push("/?tour=1");
  };

  // On step change (not on first paint), move focus to the new step's
  // heading — announces the step to screen readers and resets scroll on the
  // taller steps.
  const prevStepRef = useRef<number | null>(null);
  useEffect(() => {
    if (step === null) return;
    if (prevStepRef.current === null) {
      prevStepRef.current = step;
      return;
    }
    if (prevStepRef.current === step) return;
    prevStepRef.current = step;
    document
      .querySelector<HTMLElement>("[data-step-heading]")
      ?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [step]);

  // Enter advances the wizard — except inside controls that own Enter
  // themselves (chip inputs, autocompletes, buttons, links, textareas).
  const handleEnter = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) {
      return;
    }
    // An Enter that commits an IME candidate (Chinese/Japanese/Korean input)
    // must never advance the step — it would destroy the composition
    // mid-typing. keyCode 229 covers Safari's post-composition quirk.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const t = e.target as HTMLElement;
    if (["TEXTAREA", "BUTTON", "A", "SELECT"].includes(t.tagName)) return;
    if (t.closest("[data-enter-scope]")) return;
    if (!canContinue) return;
    e.preventDefault();
    if (isLast) finishToTour();
    else next();
  };

  // The sticky glass footer floats over the tail of tall steps — reserve
  // scroll padding so keyboard-focused controls auto-scroll clear of it.
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.scrollPaddingBottom;
    html.style.scrollPaddingBottom = "96px";
    return () => {
      html.style.scrollPaddingBottom = prev;
    };
  }, []);

  const name = profile.displayName === DEFAULT_NAME ? "" : profile.displayName;
  const topicMirroring = () => {
    topicMirroringRef.current ??= createTopicMirroringController(
      profile,
      store,
    );
    return topicMirroringRef.current;
  };

  return (
    <div className="min-h-[100dvh] bg-bg flex flex-col items-center">
      <div className="w-full max-w-[640px] px-6 py-12 lg:py-16">
        {/* Header / brand + skip */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2.5">
            <Image src="/logo-mark.png" alt="Peer" width={28} height={28} className="opacity-90" />
            <span className="text-body-sm font-semibold tracking-[-0.01em] text-heading">Peer</span>
          </div>
          <button
            type="button"
            onClick={skipEverything}
            className={cn(buttonVariants({ tone: "ghost", size: "sm" }))}
          >
            Skip setup →
          </button>
        </div>

        {step === null || key === null ? (
          // A few ms of local hydration — hold layout, no spinner flash.
          <div className="min-h-[50dvh]" aria-hidden />
        ) : (
          <>
            <StepRail step={step} done={done} canJumpTo={canJumpTo} onJump={setStep} />

            {/* Step body — keyed so the entrance animation replays per step */}
            <div key={key} className="animate-fade-in-up" onKeyDown={handleEnter}>
              {key === "basics" && (
                <StepFrame
                  kicker="Welcome"
                  title="Let's get you set up."
                  subtitle="A few quick details so Peer knows who it's briefing. All optional — change anything later in your profile."
                >
                  <Field label="Your name">
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => store.updateDisplayName(e.target.value)}
                      placeholder="Your name"
                      className="w-full bg-bg-secondary/40 rounded-lg px-3 py-2.5 text-body text-text placeholder-text-faint/60 outline-none focus:bg-bg-secondary/60 focus:ring-2 focus:ring-accent/20 transition-all"
                    />
                  </Field>
                  <Field label="Career stage">
                    <PillGroup
                      options={careerStages.map((s) => ({ value: s, label: s }))}
                      value={profile.careerStage}
                      onChange={(v) => store.updateCareerStage(v as typeof profile.careerStage)}
                    />
                  </Field>
                  <Field label="Looking toward">
                    <PillGroup
                      options={industryPreferences.map((p) => ({ value: p, label: industryLabels[p] ?? p }))}
                      value={profile.industryVsAcademia}
                      onChange={(v) => store.updateIndustryPreference(v as typeof profile.industryVsAcademia)}
                    />
                  </Field>
                </StepFrame>
              )}

              {key === "visa" && (
                <StepFrame
                  kicker="Work rights"
                  title="Where can you already work?"
                  subtitle="Add countries where you can work without employer sponsorship. Peer uses this only to hide visa warnings that do not apply to you. You can skip this and keep every visa label visible."
                >
                  <Field label="Countries where you do not need sponsorship">
                    <div data-enter-scope>
                      <CountryMultiSelect
                        values={profile.authorisedCountries}
                        onChange={store.updateAuthorisedCountries}
                        idPrefix="welcome-authorised-country"
                      />
                    </div>
                  </Field>
                  <p className="text-caption leading-relaxed text-text-faint">
                    When you sign in, this setting follows you to your other
                    devices.
                  </p>
                </StepFrame>
              )}

              {key === "topics" && (
                <StepFrame
                  kicker="The one that matters"
                  title="What should Peer track for you?"
                  subtitle="This is the heart of your briefing. Add at least one Required topic — every paper in your feed must match one of these. Type a topic and press comma or Enter to turn it into a tag; drag a tag between columns to re-rank it."
                >
                  <Field
                    label="Papers"
                    hint={SURFACE_TOPIC_DESCRIPTIONS.papers}
                  >
                    <div data-enter-scope>
                      <TopicsField
                        required={profile.researchTopics}
                        soft={profile.softTopics ?? []}
                        onChangeRequired={(topics) =>
                          topicMirroring().updatePaperRequired(topics)
                        }
                        onChangeSoft={(topics) =>
                          topicMirroring().updatePaperExplore(topics)
                        }
                      />
                    </div>
                  </Field>
                  <Field
                    label="Events"
                    hint={SURFACE_TOPIC_DESCRIPTIONS.events}
                  >
                    <div data-enter-scope>
                      <TopicsField
                        required={profile.eventRequiredTopics}
                        soft={profile.eventExploreTopics}
                        onChangeRequired={(topics) =>
                          topicMirroring().updateEventRequired(topics)
                        }
                        onChangeSoft={(topics) =>
                          topicMirroring().updateEventExplore(topics)
                        }
                      />
                    </div>
                  </Field>
                  <Field
                    label="Jobs"
                    hint={SURFACE_TOPIC_DESCRIPTIONS.jobs}
                  >
                    <div data-enter-scope>
                      <TopicsField
                        required={profile.jobRequiredTopics}
                        soft={profile.jobExploreTopics}
                        onChangeRequired={(topics) =>
                          topicMirroring().updateJobRequired(topics)
                        }
                        onChangeSoft={(topics) =>
                          topicMirroring().updateJobExplore(topics)
                        }
                      />
                    </div>
                  </Field>
                  {!topicsSatisfied && (
                    <p id="topics-gate-note" className="mt-4 text-meta text-accent/90 flex items-center gap-1.5">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                      </svg>
                      Add one Required topic to continue — this is what your first briefing is built from.
                    </p>
                  )}
                </StepFrame>
              )}

              {key === "work" && (
                <StepFrame
                  kicker="Your work"
                  title="What are you working on, and with whom?"
                  subtitle="Optional, but the single biggest lever on quality. Peer biases your briefing toward your real project, open problems, and your advisor's research lineage."
                >
                  <Field label="Current project" hint="1–3 sentences about what you're building right now.">
                    <textarea
                      value={profile.currentProject ?? ""}
                      onChange={(e) => store.updateCurrentProject(e.target.value)}
                      rows={3}
                      placeholder="Describe the specific project you're working on right now."
                      className="w-full bg-bg-secondary/40 rounded-lg px-3 py-2.5 text-body text-text placeholder-text-faint/60 outline-none focus:bg-bg-secondary/60 focus:ring-2 focus:ring-accent/20 transition-all resize-y leading-relaxed"
                    />
                  </Field>
                  <Field label="Open challenges" hint="The unknowns you wish someone would solve. Papers that mention these rise to the top.">
                    <textarea
                      value={profile.currentChallenges ?? ""}
                      onChange={(e) => store.updateCurrentChallenges(e.target.value)}
                      rows={3}
                      placeholder="The open problems you want your briefing to help with."
                      className="w-full bg-bg-secondary/40 rounded-lg px-3 py-2.5 text-body text-text placeholder-text-faint/60 outline-none focus:bg-bg-secondary/60 focus:ring-2 focus:ring-accent/20 transition-all resize-y leading-relaxed"
                    />
                  </Field>

                  <div className="pt-2 border-t border-border/60 space-y-4">
                    <Field label="School / org" hint="Used to pin down the right advisor.">
                      <div data-enter-scope>
                        <SchoolAutocomplete
                          value={profile.school ?? ""}
                          onChange={store.updateSchool}
                          placeholder="University or company"
                        />
                      </div>
                    </Field>
                    <Field label="Advisor / PI">
                      <div data-enter-scope>
                        <AdvisorField
                          advisorName={profile.advisorName ?? ""}
                          school={profile.school ?? ""}
                          advisorAuthorId={profile.advisorAuthorId}
                          advisorAuthorLabel={profile.advisorAuthorLabel}
                          onChangeName={store.updateAdvisorName}
                          onConfirm={store.confirmAdvisorAuthor}
                          onClear={store.clearAdvisorAuthor}
                        />
                      </div>
                    </Field>
                  </div>
                </StepFrame>
              )}

              {key === "radar" && (
                <StepFrame
                  kicker="Tuning"
                  title="How should your radar sweep?"
                  subtitle="Sensible defaults are already chosen — adjust only what you care about, or just continue."
                >
                  <div className="space-y-4">
                    <ChoiceGroup label="Focus" value={profile.feedFocus} options={PAPER_FOCUS_OPTIONS} onChange={(v) => store.updateFeedFocus(v as typeof profile.feedFocus)} />
                    <ChoiceGroup label="Freshness" value={profile.feedFreshness} options={PAPER_FRESHNESS_OPTIONS} onChange={(v) => store.updateFeedFreshness(v as typeof profile.feedFreshness)} />
                    <ChoiceGroup label="Papers shown" value={profile.paperCount} options={PAPER_COUNT_OPTIONS} onChange={(v) => store.updatePaperCount(v as typeof profile.paperCount)} />

                    <Field label="Sources">
                      <RadioGroup
                        value={profile.feedSourceMix}
                        options={PAPER_SOURCE_OPTIONS_DETAILED}
                        onChange={(v) => store.updateFeedSourceMix(v as typeof profile.feedSourceMix)}
                      />
                    </Field>

                    <Field
                      label="Preferred journals"
                      hint="List the journals you trust most. Peer treats these as a primary source and gives papers from them a relevance boost (+1/3 of their score), so they rise to the top — though an exceptionally on-target paper from elsewhere can still win."
                    >
                      <div data-enter-scope>
                        <ChipInput
                          values={profile.preferredJournals ?? []}
                          onChange={store.updatePreferredJournals}
                          placeholder="Add a journal, press Enter"
                          tone="link"
                        />
                      </div>
                    </Field>

                    <ChoiceGroup label="Importance" value={profile.feedImportance} options={PAPER_IMPORTANCE_OPTIONS} onChange={(v) => store.updateFeedImportance(v as typeof profile.feedImportance)} />
                    <ChoiceGroup label="Discovery" value={profile.feedDiscoveryMode} options={PAPER_DISCOVERY_OPTIONS} onChange={(v) => store.updateFeedDiscoveryMode(v as typeof profile.feedDiscoveryMode)} />
                    <Field label="Avoid">
                      <div className="flex flex-wrap gap-1.5">
                        <TogglePill label="Review papers" active={profile.feedAvoidReviews} onToggle={() => store.updateFeedAvoidReviews(!profile.feedAvoidReviews)} />
                        <TogglePill label="Old papers" active={profile.feedAvoidOldPapers} onToggle={() => store.updateFeedAvoidOldPapers(!profile.feedAvoidOldPapers)} />
                        <TogglePill label="Broad surveys" active={profile.feedAvoidBroadSurveys} onToggle={() => store.updateFeedAvoidBroadSurveys(!profile.feedAvoidBroadSurveys)} />
                      </div>
                    </Field>
                  </div>
                </StepFrame>
              )}

              {key === "ai" && (
                <StepFrame
                  kicker="Optional power-up"
                  title="Connect an AI key (optional)."
                  subtitle="Peer works fully free with zero setup, and its AI is included. Adding your own key is optional — it sends the model calls to your account instead, and you can always do this later."
                >
                  {/* ABC-freemium 1-24 · R-UI-1, D1 — this said a key is what
                      unlocks AI. Peer's AI is included now, so a key is an
                      alternative rather than an unlock. */}
                  <Callout variant="accent">
                    <strong>Peer&apos;s AI is included — no key needed.</strong>{" "}
                    Ranking, summaries and Deep reports across Papers, Events and
                    Jobs all run on it. Adding your own key sends those calls to
                    your own account instead, on whichever model you prefer.
                  </Callout>
                  <div className="mt-4 space-y-3">
                    <ApiKeyHelp provider={profile.feedAiProvider} />
                    <AiProviderRecommendation />
                    <AiKeyFields
                      provider={profile.feedAiProvider}
                      apiKey={profile.feedAiApiKey ?? ""}
                      onProviderChange={store.updateFeedAiProvider}
                      onApiKeyChange={store.updateFeedAiApiKey}
                      idPrefix="welcome-ai"
                      emphasized
                      showRegistrationLink
                    />
                    <AiProviderGuide
                      key={profile.feedAiProvider}
                      provider={profile.feedAiProvider}
                    />
                    <p className="text-caption leading-relaxed text-text-faint">
                      AI keys power ranking, summaries, and Deep reports. Tavily
                      web scouting uses its own separate search key and remains
                      limited by Peer&apos;s daily search schedule.
                    </p>
                  </div>
                </StepFrame>
              )}

              {key === "connectors" && (
                <StepFrame
                  kicker="Optional power-up"
                  title="Turn on Events & Jobs for your field."
                  subtitle="Papers work out of the box. Events and jobs need a data source — the free curated feeds only cover CS/AI, so for every other field these three free keys are what make your Events and Jobs tabs fill up."
                >
                  <Callout variant="accent">
                    <strong>Why this matters:</strong> a materials-science conference or a
                    battery-lab postdoc never appears in a CS-only feed. These sources search
                    the whole web and every major job board for <em>your</em> topics — all free,
                    all stored only in your browser.
                  </Callout>

                  <div className="space-y-2.5">
                    <ApiIntro
                      name="Tavily"
                      tag="Events + academic jobs · all fields"
                      why="Discovers conferences, CFPs, and postings on sites that have no API (HigherEdJobs, jobs.ac.uk, Nature Careers). This is the single biggest unlock for non-CS fields."
                      how="Free — 1,000 searches/month. Sign up, copy the key from your dashboard."
                      href="https://tavily.com"
                    />
                    <ApiIntro
                      name="Adzuna"
                      tag="Industry jobs · 19 countries"
                      why="Aggregates company R&D and lab roles across major job boards — the best source of industry positions for researchers eyeing the private sector."
                      how="Free tier. Register an app at developer.adzuna.com for an App ID + App Key."
                      href="https://developer.adzuna.com"
                    />
                    <ApiIntro
                      name="USAJobs"
                      tag="US federal & national labs"
                      why="Every US government research posting — NIH, NSF, and DOE national labs (Argonne, NREL, Berkeley Lab). Nowhere else lists these as cleanly."
                      how="Free, instant. Request a key with your email at developer.usajobs.gov."
                      href="https://developer.usajobs.gov/apirequest/"
                    />
                  </div>

                  <div data-enter-scope className="rounded-xl bg-surface shadow-well overflow-hidden">
                    <ConnectorPanel />
                  </div>
                  <p className="text-caption leading-relaxed text-text-faint">
                    Add any or none now — you can paste keys later from the “Data APIs” button in
                    the search bar. Keys never leave your browser.
                  </p>
                </StepFrame>
              )}

              {key === "persona" && (
                <StepFrame
                  kicker="One more thing"
                  title="Want Peer to learn your reading style?"
                  subtitle="An optional 2-minute quiz that maps how you tend to work across five axes. It helps shape your feed — but you can absolutely skip it and just explore."
                >
                  <div className={cn(cardShell({ interactive: false, entrance: "none", padding: "none" }), "p-6 flex items-start gap-4")}>
                    <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-accent-dim text-accent shrink-0">
                      <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
                        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
                        <circle cx="10" cy="10" r="2.5" fill="currentColor" />
                      </svg>
                    </span>
                    <div className="min-w-0">
                      <p className="text-body-lg font-medium text-heading">
                        Academic persona quiz
                        {personaDone && (
                          <span className={cn(sectionLabel({ tone: "accent", tracking: "tight" }), "ml-2 align-middle")}>
                            Completed
                          </span>
                        )}
                      </p>
                      <p className="text-body-sm text-text-muted mt-1 leading-relaxed">
                        Fifteen forced-choice questions. Not a test — a description of your
                        defaults, useful for tuning what you see.
                      </p>
                      <Link
                        href="/persona"
                        className="mt-3 inline-flex items-center gap-1.5 text-body-sm text-accent hover:text-accent/80 font-medium transition-colors"
                      >
                        {personaDone ? "Review your persona" : "Take the quiz"}
                        <span aria-hidden>→</span>
                      </Link>
                    </div>
                  </div>

                  <ReviewList
                    profile={profile}
                    entitlement={entitlement}
                    onJump={setStep}
                  />
                </StepFrame>
              )}
            </div>

            {/* Footer nav — sticky so Continue stays reachable on tall steps */}
            <footer className="sticky bottom-0 z-10 -mx-6 mt-10 flex items-center justify-between gap-3 px-6 py-4 glass-bar">
              <button
                type="button"
                onClick={back}
                disabled={step === 0}
                className={cn(
                  buttonVariants({ tone: "ghost", size: "md" }),
                  "disabled:opacity-35 disabled:cursor-default",
                )}
              >
                ← Back
              </button>

              {isLast ? (
                <button
                  type="button"
                  onClick={finishToTour}
                  className={cn(buttonVariants({ tone: "primary", size: "lg" }), "px-6")}
                >
                  Enter Peer
                  <span aria-hidden>→</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={next}
                  disabled={!canContinue}
                  aria-describedby={key === "topics" && !topicsSatisfied ? "topics-gate-note" : undefined}
                  className={cn(
                    buttonVariants({ tone: "primary", size: "lg" }),
                    "bg-heading hover:bg-heading/90 px-6",
                    "disabled:opacity-100 disabled:bg-bg-secondary disabled:text-text-faint/70 disabled:shadow-none disabled:cursor-not-allowed disabled:active:scale-100",
                  )}
                >
                  Continue
                  <span aria-hidden>→</span>
                </button>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

// ── Step rail ──────────────────────────────────────────────────

// Labeled, clickable stepper replacing the anonymous progress bar: done steps
// get an accent tick, the current step a solid accent node, locked steps
// (past Topics while the gate is unmet) a real disabled button.
function StepRail({
  step,
  done,
  canJumpTo,
  onJump,
}: {
  step: number;
  done: Record<StepKey, boolean>;
  canJumpTo: (i: number) => boolean;
  onJump: (i: number) => void;
}) {
  const total = STEP_META.length;
  return (
    <nav aria-label="Setup progress" className="mb-10">
      <ol className="relative flex items-start">
        <span aria-hidden className="absolute left-6 right-6 top-[15px] h-[1.5px] bg-heading/10" />
        {STEP_META.map((m, i) => {
          const isCurrent = i === step;
          const isDone = done[m.key];
          const locked = !canJumpTo(i);
          return (
            <li key={m.key} className="relative z-10 flex-1 flex justify-center">
              <button
                type="button"
                disabled={locked}
                onClick={() => onJump(i)}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={
                  locked
                    ? `Step ${i + 1}: ${m.label} — locked until a required topic is added`
                    : `Step ${i + 1}: ${m.label}${isDone ? " (completed)" : ""}`
                }
                title={locked ? "Add a required topic first" : undefined}
                className={cn(
                  "group flex flex-col items-center gap-1.5 bg-bg px-1 sm:px-1.5 pt-0.5 pb-1 rounded-lg outline-none",
                  "focus-visible:ring-2 focus-visible:ring-accent/30",
                  locked && "opacity-40 cursor-not-allowed",
                )}
              >
                <span
                  className={cn(
                    "flex h-[26px] w-[26px] items-center justify-center rounded-full text-micro font-semibold tabular-nums",
                    "transition-[background-color,color,transform,box-shadow] duration-150 ease-snap",
                    isCurrent
                      ? "bg-accent text-bg shadow-card scale-110"
                      : isDone
                        ? "bg-accent-dim text-accent"
                        : "bg-bg-secondary text-text-faint group-hover:text-text-muted",
                    !locked && !isCurrent && "group-active:scale-90",
                  )}
                >
                  {isDone ? (
                    <svg viewBox="0 0 12 12" className="h-3 w-3 animate-pop-in" aria-hidden>
                      <path d="M2.5 6.5 5 9l4.5-5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={cn(
                    sectionLabel({ tracking: "tight" }),
                    "hidden sm:block",
                    isCurrent ? "text-heading" : isDone ? "text-text-muted" : "text-text-faint/80",
                  )}
                >
                  {m.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="sm:hidden mt-2.5 text-center text-meta text-text-faint tabular-nums">
        {step + 1} / {total}
      </p>
      <p aria-live="polite" className="sr-only">
        Step {step + 1} of {total}: {STEP_META[step].label}
      </p>
    </nav>
  );
}

// ── Review summary (final step) ────────────────────────────────

// Compact recap of everything captured so far, with jump-to-edit — the user
// confirms at a glance instead of paging back through steps.
function ReviewList({
  profile,
  entitlement,
  onJump,
}: {
  profile: UserProfile;
  entitlement: Pick<Entitlement, "userId">;
  onJump: (i: number) => void;
}) {
  const rows = STEP_META.slice(0, -1).map((m, i) => ({
    index: i,
    label: m.label,
    summary: summarizeStep(m.key, profile, entitlement),
  }));
  return (
    <div>
      <p className={cn(sectionLabel({ tracking: "tight" }), "text-text-faint/80 mb-2")}>
        What Peer knows so far
      </p>
      <div className={cn(cardShell({ interactive: false, entrance: "none", padding: "none", radius: "xl" }), "divide-y divide-border/60")}>
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 px-4 py-2.5">
            <span className={cn(sectionLabel({ tracking: "tight" }), "w-[72px] shrink-0")}>
              {row.label}
            </span>
            <span className="flex-1 min-w-0 truncate text-meta text-text-muted">
              {row.summary}
            </span>
            <button
              type="button"
              onClick={() => onJump(row.index)}
              aria-label={`Edit ${row.label}`}
              className="shrink-0 text-meta text-accent hover:text-accent/80 font-medium transition-colors"
            >
              Edit
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function summarizeStep(
  key: StepKey,
  profile: UserProfile,
  entitlement: Pick<Entitlement, "userId">,
): string {
  switch (key) {
    case "basics": {
      const name =
        profile.displayName && profile.displayName !== DEFAULT_NAME
          ? profile.displayName
          : null;
      return [name, profile.careerStage, industryLabels[profile.industryVsAcademia] ?? profile.industryVsAcademia]
        .filter(Boolean)
        .join(" · ");
    }
    case "visa":
      return profile.authorisedCountries.length > 0
        ? profile.authorisedCountries.join(" · ")
        : "Not set — all visa labels stay visible";
    case "topics": {
      const req = profile.researchTopics.length;
      const soft = profile.softTopics?.length ?? 0;
      if (req === 0) return "No topics yet";
      return `${req} required${soft > 0 ? ` · ${soft} nice-to-have` : ""}`;
    }
    case "work": {
      const parts = [
        profile.currentProject ? "Project" : null,
        profile.currentChallenges ? "Challenges" : null,
        profile.school || null,
        profile.advisorName || null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : "Not filled in";
    }
    case "radar":
      return isStepDone("radar", profile, false) ? "Customized" : "Defaults";
    case "ai":
      return isStepDone("ai", profile, false, entitlement)
        ? `${providerShortLabel(profile.feedAiProvider)} key connected`
        : "Not connected — works free";
    case "connectors": {
      const n = connectorCount(profile);
      return n > 0 ? `${n} of 3 sources connected` : "None connected yet";
    }
    case "persona":
      return "";
  }
}

// ── Small layout helpers ───────────────────────────────────────

// Compact "what this API is and why it's worth 2 minutes" card, used in the
// connectors onboarding step.
function ApiIntro({
  name,
  tag,
  why,
  how,
  href,
}: {
  name: string;
  tag: string;
  why: string;
  how: string;
  href: string;
}) {
  return (
    <div className="rounded-xl bg-bg-secondary/40 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-body-sm font-semibold text-heading">{name}</span>
        <span className={cn(sectionLabel({ tracking: "tight", tone: "accent" }), "text-right")}>
          {tag}
        </span>
      </div>
      <p className="text-meta leading-relaxed text-text-muted">{why}</p>
      <p className="text-caption leading-relaxed text-text-faint mt-1.5">
        {how}{" "}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          Get a key ↗
        </a>
      </p>
    </div>
  );
}

function StepFrame({
  kicker,
  title,
  subtitle,
  children,
}: {
  kicker: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className={cn(sectionLabel({ tone: "accent", tracking: "wider" }), "mb-2.5 flex items-center gap-2")}>
        <span aria-hidden className="inline-block w-4 h-[1.5px] bg-accent/70" />
        {kicker}
      </p>
      <h1
        tabIndex={-1}
        data-step-heading
        className="font-display font-light text-[30px] lg:text-[34px] tracking-[-0.015em] leading-[1.1] text-heading outline-none"
      >
        {title}
      </h1>
      <p className="text-text-muted mt-3 text-body leading-[1.6] max-w-[56ch]">
        {subtitle}
      </p>
      <div className="mt-8 space-y-5">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className={cn(sectionLabel({ tracking: "tight" }), "text-text-faint/80 mb-1.5 block")}>
        {label}
      </p>
      {children}
      {hint && (
        <p className="text-caption text-text-faint/75 mt-1.5 px-0.5 leading-relaxed">{hint}</p>
      )}
    </div>
  );
}

function PillGroup({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`text-meta px-2.5 py-1 rounded-full transition-all duration-200 ease-out active:scale-[0.94] ${
              active
                ? "bg-accent-dim text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent)] scale-[1.03]"
                : "text-text-faint hover:text-text-muted bg-bg-secondary/40 hover:bg-bg-secondary/70"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
