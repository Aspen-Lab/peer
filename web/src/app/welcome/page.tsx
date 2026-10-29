"use client";

// First-run onboarding wizard. Apple-setup-style: one idea per page, every
// page optional except Topics (which the feed needs to produce a real first
// briefing). Writes straight to the shared profile store — same store, same
// field components as /profile — and on finish (or on "Skip setup") marks
// onboarding complete and hands off to the feed, `/`.
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
import "./welcome-design.css";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useProfileStore } from "@/store/profile";
import { useSyncGate, type AuthOutcome } from "@/components/profile-sync";
import type { UserProfile } from "@/types";
import {
  ChipInput,
  ChoiceGroup,
  RadioGroup,
  TogglePill,
  industryLabels,
  PAPER_FOCUS_OPTIONS,
  PAPER_FRESHNESS_OPTIONS,
  PAPER_COUNT_OPTIONS,
  PAPER_SOURCE_OPTIONS_DETAILED,
  PAPER_IMPORTANCE_OPTIONS,
  PAPER_DISCOVERY_OPTIONS,
} from "@/components/profile/field-kit";
import { CareerStagePicker, DirectionPicker, RadarPicker } from "./welcome-inputs";
import {
  AiKeyFields,
  ApiKeyHelp,
  AiProviderGuide,
  AiProviderRecommendation,
} from "@/components/profile/ai-setup";
import { SchoolAutocomplete } from "@/components/profile/school-autocomplete";
import { AdvisorField } from "@/components/profile/advisor-field";
import { JevSetup } from "@/components/profile/jev-setup";
import { useProfileSettled } from "@/components/first-run";
import { Callout } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";
import { cardShell } from "@/components/ui/card-shell";
import { cn } from "@/lib/cn";
import {
  type StepKey,
  type StepMeta,
  firstIncompleteStep,
  isStepDone,
  offersSignIn,
  readPersonaDone,
  stepIndexFromKey,
  visibleSteps,
} from "./completeness";
import {
  AccountStep,
  SignInToUseKey,
  SkipSignInLabel,
  accountStepCopy,
} from "./account-step";
import { aiStepSummary } from "./summary";

const DEFAULT_NAME = "Peer Member";
const TOPIC_EXAMPLES = ["Artificial intelligence", "Climate science", "Materials science", "Neuroscience", "Design"];
const STEP_STORY: Record<StepKey, string> = {
  account: "A place for\nyour curiosity.",
  basics: "A little more you.\nA lot less noise.",
  topics: "Follow what\nmakes you curious.",
  work: "Make space for\nyour big questions.",
  radar: "Your field,\nyour way.",
  ai: "A little help\nwhen you need it.",
  persona: "Every curious mind\nis different.",
};

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
  // The `ai` step is complete when a model will run for this reader (their own
  // key, and signed in). While the sign-in check is unanswered the step reads
  // as not-yet-done rather than done, which is the direction that shows the
  // reader the step instead of hiding it.
  const auth = useSyncGate((s) => s.authOutcome);
  // The steps this reader is shown: Account is left out where sign-in is not
  // configured. Decided before the first step paints (the page waits for
  // `settled` below) and never changes after — see `visibleSteps`.
  const steps = useMemo(() => visibleSteps(auth), [auth]);
  const store = useProfileStore();
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
  const [topicDraft, setTopicDraft] = useState("");
  const [autoStart, setAutoStart] = useState<number | null>(null);
  if (settled && autoStart === null) {
    setAutoStart(
      stepIndexFromKey(requestedStep, steps) ??
        firstIncompleteStep(profile, readPersonaDone(), auth),
    );
  }
  const total = steps.length;
  const chosenStep = manualStep ?? autoStart;
  const step = chosenStep === null ? null : Math.min(chosenStep, total - 1);
  const setStep = setManualStep;

  const key: StepKey | null = step === null ? null : steps[step].key;
  const isLast = step === total - 1;
  const topicsIdx = steps.findIndex((m) => m.key === "topics");
  // On the Account step, until the reader signs in, Next skips sign-in.
  const skipSignIn = key === "account" && auth !== "signed-in";

  // Topics is the one gate: the feed needs at least one required topic to
  // build a real first briefing.
  const topicsSatisfied = profile.researchTopics.length > 0;
  const canContinue = key === "topics" ? topicsSatisfied || !!topicDraft.trim() : true;

  // Live done-map: ticks update as the user types, and when a synced profile
  // lands mid-wizard old data ticks steps instead of silently pre-filling.
  const done = useMemo(
    () =>
      Object.fromEntries(
        steps.map((m) => [
          m.key,
          isStepDone(m.key, profile, personaDone, auth),
        ]),
      ) as Record<StepKey, boolean>,
    [steps, profile, personaDone, auth],
  );

  // Jumping is free among the first steps and everywhere once the topics
  // gate is satisfied — the rail never routes around the one requirement.
  const canJumpTo = (i: number) => i <= topicsIdx || topicsSatisfied;

  // Base navigation on the computed `step` — the functional-updater form
  // would see `manualStep`, which stays null until the first manual move.
  const addTopic = (value: string) => {
    const topic = value.trim();
    if (!topic) return;
    if (!profile.researchTopics.some((existing) => existing.toLowerCase() === topic.toLowerCase())) {
      store.updateTopics([...profile.researchTopics, topic]);
    }
    setTopicDraft("");
  };
  const next = () => {
    if (key === "topics" && topicDraft.trim()) addTopic(topicDraft);
    if (step !== null) setManualStep(Math.min(step + 1, total - 1));
  };
  const back = () => {
    if (step !== null) setManualStep(Math.max(step - 1, 0));
  };

  const finishToTour = () => {
    completeOnboarding();
    router.push("/");
  };

  // Skipping marks onboarding complete too, so the first-visit redirect never
  // brings the reader back here by itself.
  const skipEverything = () => {
    completeOnboarding();
    router.push("/");
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

  return (
    <div className="welcome-page">
      <div className="welcome-shell">
        <aside className="welcome-visual" aria-label="About Peer">
          <Image src="/onboarding/peer-messenger.png" alt="" fill priority sizes="(min-width: 768px) 42vw, 100vw" className="welcome-artwork" />
          <div className="welcome-brand"><Image src="/logo-mark.png" alt="" width={32} height={32} /><span>Peer</span></div>
          <div className="welcome-visual-copy">
            <span>Your daily briefing, made personal</span>
            <h2>{key ? STEP_STORY[key] : STEP_STORY.basics}</h2>
          </div>
          <p className="welcome-visual-footer">Good ideas find their way to you.</p>
        </aside>
      <div className="welcome-form-panel">
        {/* Header / brand + skip */}
        <div className="welcome-topbar">
          <div className="flex items-center gap-2.5 invisible" aria-hidden="true">
            <Image src="/logo-mark.png" alt="Peer" width={28} height={28} className="opacity-90" />
            <span className="text-body-sm font-semibold tracking-[-0.01em] text-heading">Peer</span>
          </div>
          <button
            type="button"
            onClick={skipEverything}
            className="welcome-skip"
          >
            Skip setup <span aria-hidden>↗</span>
          </button>
        </div>

        {step === null || key === null ? (
          // A few ms of local hydration — hold layout, no spinner flash.
          <div className="min-h-[50dvh]" aria-hidden />
        ) : (
          <>
            <StepRail steps={steps} step={step} done={done} canJumpTo={canJumpTo} onJump={setStep} />

            {/* Step body — keyed so the entrance animation replays per step */}
            <div key={key} className="welcome-step" onKeyDown={handleEnter}>
              {key === "account" && (
                <StepFrame {...accountStepCopy(auth)}>
                  <AccountStep auth={auth} />
                </StepFrame>
              )}

              {key === "basics" && (
                <StepFrame
                  kicker="Welcome"
                  title="A little about you."
                  subtitle="Make Peer yours. You can change this later."
                >
                  <Field label="Your name">
                    <div className="welcome-name-field">
                    <span className="welcome-name-avatar" aria-hidden>{name.trim().charAt(0).toUpperCase() || "✳"}</span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => store.updateDisplayName(e.target.value)}
                      placeholder="What should we call you?"
                      aria-label="Your name"
                      className="welcome-name-input"
                    />
                    </div>
                  </Field>
                  <Field label="Career stage">
                    <CareerStagePicker
                      value={profile.careerStage}
                      onChange={store.updateCareerStage}
                    />
                  </Field>
                  <Field label="Looking toward">
                    <DirectionPicker
                      value={profile.industryVsAcademia}
                      onChange={(v) => store.updateIndustryPreference(v as typeof profile.industryVsAcademia)}
                    />
                  </Field>
                </StepFrame>
              )}

              {key === "topics" && (
                <StepFrame
                  kicker="The one that matters"
                  title="What should Peer track for you?"
                  subtitle="Add at least one topic for your paper briefing."
                >
                  <div data-enter-scope>
                    <label htmlFor="onboarding-topic" className="welcome-topic-label"><span>Your topics</span><span>{profile.researchTopics.length} selected</span></label>
                    <div className="welcome-topic-input">
                      <input id="onboarding-topic" value={topicDraft} onChange={(e) => setTopicDraft(e.target.value)} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === ",") && !e.nativeEvent.isComposing) { e.preventDefault(); addTopic(topicDraft); } }} placeholder="e.g. battery materials" className="min-w-0 flex-1 bg-transparent px-3 py-2 text-body text-text outline-none placeholder:text-text-faint" />
                      <button type="button" onClick={() => addTopic(topicDraft)} disabled={!topicDraft.trim()} aria-label="Add topic" className="welcome-topic-add">+</button>
                    </div>
                    {profile.researchTopics.length > 0 && <div className="mt-4 flex flex-wrap gap-2" aria-label="Selected topics" aria-live="polite">{profile.researchTopics.map((topic) => <span key={topic} className="welcome-topic-selected">{topic}<button type="button" aria-label={`Remove ${topic}`} onClick={() => store.updateTopics(profile.researchTopics.filter((item) => item !== topic))} className="rounded-full px-1 hover:bg-accent/10">×</button></span>)}</div>}
                    <p className="mt-6 text-meta text-text-muted">Start with a field</p>
                    <div className="welcome-topic-suggestions mt-2">{TOPIC_EXAMPLES.filter((topic) => !profile.researchTopics.some((item) => item.toLowerCase() === topic.toLowerCase())).map((topic) => <button key={topic} type="button" onClick={() => addTopic(topic)} className="welcome-topic-suggestion"><span className="welcome-topic-symbol" aria-hidden>{["✳", "◌", "⬡", "✺", "◇"][TOPIC_EXAMPLES.indexOf(topic)]}</span><span>{topic}</span><span className="welcome-topic-plus" aria-hidden>+</span></button>)}</div>
                    <details className="welcome-more-topics mt-6"><summary className="cursor-pointer text-body-sm text-text-muted">Add related interests <span className="text-text-faint">(optional)</span></summary><div className="mt-3"><ChipInput values={profile.softTopics ?? []} onChange={store.updateSoftTopics} placeholder="Add an interest, then press Enter" tone="tag" /></div></details>
                  </div>
                  {!canContinue && <p id="topics-gate-note" className="text-meta text-text-muted">Add a topic to continue.</p>}
                </StepFrame>
              )}

              {key === "work" && (
                <StepFrame
                  kicker="Your work"
                  title="What are you working on, and with whom?"
                  subtitle="Optional. Add context for more relevant papers."
                >
                  <Field label="Current project">
                    <textarea
                      value={profile.currentProject ?? ""}
                      onChange={(e) => store.updateCurrentProject(e.target.value)}
                      rows={3}
                      placeholder="Describe the specific project you're working on right now."
                      className="w-full bg-bg-secondary/40 rounded-lg px-3 py-2.5 text-body text-text placeholder-text-faint/60 outline-none focus:bg-bg-secondary/60 focus:ring-2 focus:ring-accent/20 transition-all resize-y leading-relaxed"
                    />
                  </Field>
                  <Field label="Open challenges">
                    <textarea
                      value={profile.currentChallenges ?? ""}
                      onChange={(e) => store.updateCurrentChallenges(e.target.value)}
                      rows={3}
                      placeholder="The open problems you want your briefing to help with."
                      className="w-full bg-bg-secondary/40 rounded-lg px-3 py-2.5 text-body text-text placeholder-text-faint/60 outline-none focus:bg-bg-secondary/60 focus:ring-2 focus:ring-accent/20 transition-all resize-y leading-relaxed"
                    />
                  </Field>

                  <div className="pt-2 border-t border-border/60 space-y-4">
                    <Field label="School / org">
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
                  subtitle="Defaults are ready. Adjust what matters to you."
                >
                  <div className="space-y-4">
                    <RadarPicker label="Focus" kind="focus" value={profile.feedFocus} options={PAPER_FOCUS_OPTIONS} onChange={(v) => store.updateFeedFocus(v as typeof profile.feedFocus)} />
                    <RadarPicker label="Freshness" kind="freshness" value={profile.feedFreshness} options={PAPER_FRESHNESS_OPTIONS} onChange={(v) => store.updateFeedFreshness(v as typeof profile.feedFreshness)} />
                    <RadarPicker label="Papers shown" kind="count" value={profile.paperCount} options={PAPER_COUNT_OPTIONS} onChange={(v) => store.updatePaperCount(v as typeof profile.paperCount)} />

                    <details className="rounded-xl bg-surface/50 px-4 py-3"><summary className="cursor-pointer text-body-sm text-text-muted">More preferences</summary><div className="mt-4 space-y-4">
                    <Field label="Sources">
                      <RadioGroup
                        value={profile.feedSourceMix}
                        options={PAPER_SOURCE_OPTIONS_DETAILED}
                        onChange={(v) => store.updateFeedSourceMix(v as typeof profile.feedSourceMix)}
                      />
                    </Field>

                    <Field
                      label="Preferred journals"
                      hint="Add journals you trust."
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
                    </div></details>
                  </div>
                </StepFrame>
              )}

              {key === "ai" && (
                <StepFrame
                  kicker="Optional power-up"
                  title="Connect an AI key (optional)."
                  subtitle="Peer works with no setup and shows the reading without a model. Add your own key to turn the AI on — you can always do this later."
                >
                  {/* Peer has no model of its own: a key is what turns AI on,
                      and it runs on the reader's own account. */}
                  <Callout variant="accent">
                    <strong>Without a key, Peer shows the reading without a model.</strong>{" "}
                    With one, ranking, relevance reasons, summaries and Deep
                    reports run on the model you choose, and that company bills
                    you.
                  </Callout>
                  {/* No plan or price card on this step: Peer has no paid tier,
                      so nothing here may name a plan or a price. */}
                  <div className="mt-4 space-y-3">
                    <ApiKeyHelp provider={profile.feedAiProvider} />
                    <AiProviderRecommendation />
                    {/* A key runs only while the reader is signed in, so the
                        way to sign in sits right above where it is pasted.
                        Pressing it comes back to this step. */}
                    {offersSignIn(auth) && <SignInToUseKey />}
                    <AiKeyFields
                      provider={profile.feedAiProvider}
                      apiKey={profile.feedAiApiKey ?? ""}
                      onProviderChange={store.updateFeedAiProvider}
                      onApiKeyChange={store.updateFeedAiApiKey}
                      idPrefix="welcome-ai"
                      emphasized
                      showRegistrationLink
                      // The sign-in block above already says a key runs only while signed in.
                      signInNote={false}
                    />
                    <AiProviderGuide
                      key={profile.feedAiProvider}
                      provider={profile.feedAiProvider}
                    />
                    <p className="text-caption leading-relaxed text-text-faint">
                      AI keys power ranking, summaries, and Deep reports.
                    </p>
                    {/* A second, optional pass over the paper shortlist on the
                        reader's own Jev key. Part of this step, not a step of
                        its own; the setup component owns the key. */}
                    <div className="rounded-xl bg-surface p-4 shadow-well">
                      <JevSetup variant="welcome" idPrefix="welcome" />
                    </div>
                  </div>
                </StepFrame>
              )}

              {key === "persona" && (
                <StepFrame
                  kicker="One more thing"
                  title="Want Peer to learn your reading style?"
                  subtitle="Optional. Discover your reading style in two minutes."
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
                          <span className={cn("eyebrow text-accent", "ml-2 align-middle")}>
                            Completed
                          </span>
                        )}
                      </p>
                      <p className="text-body-sm text-text-muted mt-1 leading-relaxed">
                        15 questions to discover how you read. This does not change your feed.
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
                    steps={steps}
                    profile={profile}
                    auth={auth}
                    onJump={setStep}
                  />
                </StepFrame>
              )}
            </div>

            {/* Footer nav — sticky so Continue stays reachable on tall steps */}
            <footer className="welcome-footer sticky bottom-0 z-10 mt-10 flex items-center justify-between gap-3 py-4">
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
                  aria-describedby={key === "topics" && !canContinue ? "topics-gate-note" : undefined}
                  className={cn(
                    buttonVariants({ tone: "primary", size: "lg" }),
                    "welcome-continue px-6",
                    "disabled:opacity-100 disabled:bg-bg-secondary disabled:text-text-faint/70 disabled:shadow-none disabled:cursor-not-allowed disabled:active:scale-100",
                  )}
                >
                  {skipSignIn ? <SkipSignInLabel /> : "Continue"}
                  <span aria-hidden>→</span>
                </button>
              )}
            </footer>
          </>
        )}
      </div>
      </div>
    </div>
  );
}

// ── Step rail ──────────────────────────────────────────────────

// Labeled, clickable stepper replacing the anonymous progress bar: done steps
// get an accent tick, the current step a solid accent node, locked steps
// (past Topics while the gate is unmet) a real disabled button.
function StepRail({
  steps,
  step,
  done,
  canJumpTo,
  onJump,
}: {
  steps: readonly StepMeta[];
  step: number;
  done: Record<StepKey, boolean>;
  canJumpTo: (i: number) => boolean;
  onJump: (i: number) => void;
}) {
  const total = steps.length;
  return (
    <nav aria-label="Setup progress" className="welcome-progress">
      <div className="welcome-progress-caption"><span>{steps[step].label}</span><span>{step + 1} <span aria-hidden>/</span> {total}</span></div>
      <ol className="welcome-progress-track">
        {steps.map((m, i) => {
          const locked = !canJumpTo(i);
          return <li key={m.key}><button type="button" disabled={locked} onClick={() => onJump(i)} aria-current={i === step ? "step" : undefined} aria-label={locked ? `Step ${i + 1}: ${m.label} — locked until a required topic is added` : `Step ${i + 1}: ${m.label}${done[m.key] ? " (completed)" : ""}`} title={m.label} className={cn("welcome-progress-segment", i === step && "is-active", i !== step && done[m.key] && "is-complete")} /></li>;
        })}
      </ol>
      <p aria-live="polite" className="sr-only">Step {step + 1} of {total}: {steps[step].label}</p>
    </nav>
  );
}

// ── Review summary (final step) ────────────────────────────────

// Compact recap of everything captured so far, with jump-to-edit — the user
// confirms at a glance instead of paging back through steps.
function ReviewList({
  steps,
  profile,
  auth,
  onJump,
}: {
  steps: readonly StepMeta[];
  profile: UserProfile;
  auth: AuthOutcome;
  onJump: (i: number) => void;
}) {
  const rows = steps.slice(0, -1).map((m, i) => ({
    index: i,
    label: m.label,
    summary: summarizeStep(m.key, profile, auth),
  }));
  return (
    <div>
      <p className={cn("eyebrow text-text-faint", "text-text-faint/80 mb-2")}>
        What Peer knows so far
      </p>
      <div className={cn(cardShell({ interactive: false, entrance: "none", padding: "none" }), "divide-y divide-border/60")}>
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 px-4 py-2.5">
            <span className={cn("eyebrow text-text-faint", "w-[72px] shrink-0")}>
              {row.label}
            </span>
            {/* Wraps, never cut (R2-fix item 3): at 375 px the AI row used to
                read "Gemini key saved — sign in t…", losing the instruction. */}
            <span className="flex-1 min-w-0 break-words text-meta text-text-muted">
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
  auth: AuthOutcome,
): string {
  switch (key) {
    case "account":
      return auth === "signed-in" ? "Signed in" : "Not signed in";
    case "basics": {
      const name =
        profile.displayName && profile.displayName !== DEFAULT_NAME
          ? profile.displayName
          : null;
      return [name, profile.careerStage, industryLabels[profile.industryVsAcademia] ?? profile.industryVsAcademia]
        .filter(Boolean)
        .join(" · ");
    }
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
      return aiStepSummary(profile, auth);
    case "persona":
      return "";
  }
}

// ── Small layout helpers ───────────────────────────────────────

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
      <p className="welcome-kicker">{kicker}</p>
      <h1
        tabIndex={-1}
        data-step-heading
        className="welcome-question text-balance outline-none"
      >
        {title}
      </h1>
      <p className="welcome-subtitle">
        {subtitle}
      </p>
      <div className="welcome-fields mt-8 space-y-6">{children}</div>
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
      <p className="welcome-field-label">{label}</p>
      {children}
      {hint && (
        <p className="text-caption text-text-faint/75 mt-1.5 px-0.5 leading-relaxed">{hint}</p>
      )}
    </div>
  );
}
