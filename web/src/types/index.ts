// ── Paper ──

export type PaperSource = "arxiv" | "neurIPS" | "iclr" | "icml" | "chi" | "other";

export type ItemFeedback = "liked" | "saved" | "notInterested" | "moreLikeThis";

export type PreferenceConceptSource =
  | "openalex_topic"
  | "openalex_keyword"
  | "openalex_concept"
  | "paper_keyword"
  | "job_tag"
  | "event_topic"
  | "opportunity_facet"
  | "legacy_disliked_topic";

export interface PreferenceConcept {
  key: string;
  label: string;
  source: PreferenceConceptSource;
  confidence?: number;
}

/** Which feed surface a piece of feedback came from. */
export type FeedItemKind = "paper" | "event" | "job";

export interface PreferenceLedgerEntry extends PreferenceConcept {
  positive: number;
  negative: number;
  lastPositiveAt?: string;
  lastNegativeAt?: string;
  /**
   * Positive evidence inferred from a facet selection. Kept separate from
   * explicit save/like evidence so scoring can cap and decay it independently.
   */
  facetPositive?: number;
  lastFacetAt?: string;
  lastSeenAt: string;
  /**
   * The surface the feedback was recorded from. Ledger influence is
   * directional: paper feedback informs events (strongly) and jobs
   * (moderately), event feedback informs jobs (weakly), and job/event
   * feedback never flows back into paper scoring. Entries without an
   * origin are legacy paper entries.
   */
  origin?: FeedItemKind;
}

export type PreferenceLedger = Record<string, PreferenceLedgerEntry>;

export interface Paper {
  id: string;
  title: string;
  authors: string[];
  relevanceReason: string;
  venue: string;
  source: PaperSource;
  summaryIntro: string;
  summaryExperimentKeywords: string[];
  summaryResultDiscussion: string;
  /** Semantic Scholar TLDR — machine-written, labelled as such on the reading page; never the abstract. */
  tldr?: string;
  linkPaper?: string;
  linkArxiv?: string;
  linkScholar?: string;
  linkCode?: string;
  /** DOI (without the https://doi.org/ prefix). Used for Semantic Scholar lookups. */
  doi?: string;
  publishedDate?: string;
  isSaved: boolean;
  feedback?: ItemFeedback;
  relevanceScore?: number;
  preferenceSignals?: PreferenceConcept[];
}

// ── Event ──

export type EventType =
  | "conference"
  | "workshop"
  | "seminar"
  | "meetup"
  | "job-fair"
  | "career-fair"
  | "summit"
  | "expo"
  | "hackathon";

// B2-09. Kept beside the union like `careerStages` / `industryPreferences`
// below — the event report needs the actual runtime values to tell a real
// EventType apart from prose that merely looks like one.
export const eventTypes: EventType[] = [
  "conference",
  "workshop",
  "seminar",
  "meetup",
  "job-fair",
  "career-fair",
  "summit",
  "expo",
  "hackathon",
];

export interface OpportunityPlace {
  city?: string;
  region?: string;
  country?: string;
}

export type OpportunityFormat = "in-person" | "online" | "hybrid";

export interface OpportunityFacetCounts {
  location: Record<string, number>;
  month: Record<string, number>;
  format: Record<OpportunityFormat, number>;
}

export interface OpportunityFacetSelection {
  /** OR within a group; different groups combine with AND. */
  location?: string[];
  month?: string[];
  format?: OpportunityFormat[];
}

export interface EventFee {
  label: string;
  standard?: string;
  student?: string;
  online?: string;
  deadline?: string;
}

export interface EventOrg {
  name: string;
  descriptor?: string;
  relevance?: string;
  atEvent?: string;
}

export interface EventPerson {
  name: string;
  role?: string;
  institution?: string;
  /**
   * B2-16 / Ruling 13. The short "why glance at this one" line —
   * `EventOrg.descriptor`'s equivalent. Plate 03's examples ("2 papers in
   * your feed", "Matches a topic you typed") are both Tier 0, computed
   * locally in `events/[id]/page.tsx` alongside `relevance`; this field lets
   * a future extraction source it directly the same way org descriptors are,
   * without a render-layer change.
   */
  descriptor?: string;
  relevance?: string;
  speaking?: string;
}

export interface Event {
  id: string;
  name: string;
  type: EventType;
  date: string;
  endDate?: string;
  location: string;
  place?: OpportunityPlace;
  isOnline: boolean;
  deadline?: string;
  registrationDeadline?: string;
  fees?: EventFee[];
  activities?: string[];
  organisations?: EventOrg[];
  people?: EventPerson[];
  travelGrant?: string;
  invitationLetter?: boolean;
  expectedSize?: number;
  shortDescription: string;
  /** A source-owned summary that may be stated in an event report. */
  reportSummary?: {
    text: string;
    authority: "source-record" | "page-owned";
  };
  relevanceReason: string;
  /** Shown separately when weak facet history materially changed rank. */
  facetPreferenceReason?: string;
  linkRegistration?: string;
  linkOfficial?: string;
  relevanceScore?: number;
  isSaved?: boolean;
  feedback?: ItemFeedback;
  preferenceSignals?: PreferenceConcept[];
  // Detailed-card fields (additive for cross-branch merge safety).
  rank?: string;
  tags?: string[];
  matchedTerms?: string[];
  locationFit?: number;
}

// ── Job ──

export type RoleKind =
  | "internship"
  | "phd-position"
  | "postdoc"
  | "staff"
  | "faculty";

export interface Job {
  id: string;
  roleTitle: string;
  companyOrLab?: string;
  location: string;
  place?: OpportunityPlace;
  isRemote: boolean;
  /**
   * B2-06. Plate 02 needs a three-state work mode (LOCATION tile's sub-line,
   * subtitle's third segment); `isRemote` alone cannot express "hybrid".
   * Additive beside `isRemote` — every existing reader of `isRemote` (feed,
   * filters, scoring) is unchanged. Only ever set from a signal the posting
   * actually gives (an explicit "hybrid" / "on-site" mention, or `isRemote`
   * itself); `undefined` when the posting states neither, never a guess.
   */
  workMode?: "on-site" | "hybrid" | "remote";
  keyRequirements: string[];
  matchReason: string;
  /** Shown separately when weak facet history materially changed rank. */
  facetPreferenceReason?: string;
  linkPosting?: string;
  postedDate?: string;
  applicationDeadline?: string;
  startDate?: string;
  /**
   * B3-06 / Ruling 20. Plate 02's STARTS tile sub-line ("flexible") --
   * whether the posting itself says the start date can move. Additive;
   * `undefined` unless the posting states it explicitly, never inferred
   * from silence, exactly like `workMode` (B2-06).
   */
  startDateFlexible?: boolean;
  contractLength?: string;
  applicationMaterials?: string[];
  /**
   * V26-J06 / Ruling 74. Plate 02's `ELIGIBILITY` row — the posting's own
   * clause about who may apply. Never derived from `keyRequirements` (Peer's
   * own skills list) and never from LLM enrichment.
   */
  eligibility?: string;
  /**
   * V26-J06 / Ruling 74. Plate 02's `TEAM` row, NAME HALF ONLY. The plate
   * also carries a headcount (`, 14 researchers`); no honest source for it
   * exists on the no-LLM path, so its absence is an ACCEPTED, NAMED COST
   * under Ruling 74 and must not be "fixed" by inventing a number.
   */
  team?: string;
  roleKind?: RoleKind;
  visa?: {
    state: "sponsors" | "not-stated" | "wont-sponsor";
    evidence?: string;
    country?: string;
  };
  relevanceScore?: number;
  isSaved?: boolean;
  feedback?: ItemFeedback;
  preferenceSignals?: PreferenceConcept[];
  // Detailed-card fields (additive for cross-branch merge safety).
  salary?: {
    min: number;
    max: number;
    currency: string;
    period: "hour" | "month" | "year";
  };
  salaryIsEstimated?: boolean;
  employmentType?: string;
  sourceId?: string;
  summary?: string;
  matchedTerms?: string[];
  locationFit?: number;
}

// ── User Profile ──

export type CareerStage =
  | "PhD Year 1"
  | "PhD Year 2"
  | "PhD Year 3"
  | "PhD Year 4"
  | "PhD Year 5"
  | "PhD Year 6"
  | "Postdoc"
  | "Research Scientist";

export interface SurfaceTopics {
  required: string[];
  explore: string[];
}

export interface ActiveSearchInputs {
  papers: SurfaceTopics;
  events: SurfaceTopics;
  jobs: SurfaceTopics;
  careerStage?: CareerStage;
  locationPreferences: string[];
  promotedOn: string;
}

export type IndustryAcademiaPreference =
  | "academia"
  | "industry"
  | "both"
  | "startups"
  | "bigTech";

export type DigestChannel = "inapp" | "email" | "both";
export type DigestFrequency = "daily" | "weekdays" | "weekly" | "off";
export type FeedFocus = "tight" | "balanced" | "exploratory";
export type FeedFreshness = "today" | "week" | "month";
export type FeedSourceMix = "balanced" | "preprints" | "published" | "code" | "web";
export type FeedImportance = "new" | "highlyCited" | "rising";
export type FeedMethodMode = "mustMatch" | "relatedOk" | "any";
export type FeedDiscoveryMode = "core" | "adjacent" | "surprise";
export type UserAiProvider = "default" | "openai" | "gemini" | "anthropic" | "qwen" | "deepseek";
export type ThemeMode = "system" | "light" | "dark";
export type ThemeAccent =
  | "ember"
  | "rose"
  | "marigold"
  | "sage"
  | "indigo"
  | "violet";
/** Stored as one composite string so the sync pipeline stays single-field. */
export type ColorTheme = `${ThemeMode}:${ThemeAccent}`;

export interface UserProfile {
  displayName: string;
  researchTopics: string[];
  eventRequiredTopics: string[];
  eventExploreTopics: string[];
  jobRequiredTopics: string[];
  jobExploreTopics: string[];
  activeSearchInputs?: ActiveSearchInputs;
  careerStage: CareerStage;
  industryVsAcademia: IndustryAcademiaPreference;
  locationPreferences: string[];
  /** Countries where the user can work without employer sponsorship. */
  authorisedCountries: string[];
  preferredMethods: string[];
  phdYear?: number;
  /** Affiliation — university or company. */
  school?: string;
  /**
   * Free-text description of the specific project the user is currently
   * working on. Fed verbatim into the scoring profile (TF-IDF) and into
   * source queries as additional signal, so the briefing biases toward
   * what the user is actively building, not just their generic field.
   */
  currentProject?: string;
  /**
   * The specific open problems / unknowns the user is hunting information
   * about. Highest-leverage signal — papers that mention these challenges
   * should rise to the top of the briefing.
   */
  currentChallenges?: string;
  /**
   * Keywords from papers the user has explicitly disliked. Fed into the
   * scoring pipeline as a legacy negative signal so matching papers rank lower.
   * New feedback uses `preferenceLedger`, which tracks positive and negative
   * evidence per concept instead of treating every disliked keyword as a hard
   * blacklist.
   */
  dislikedTopics?: string[];
  /**
   * Time-decayed, concept-keyed feedback ledger. Like and Save add equal
   * positive evidence; Not interested adds negative evidence after its undo
   * window commits.
   */
  preferenceLedger?: PreferenceLedger;
  /**
   * "Nice to have" topics — papers that match these get a score boost but
   * are not excluded when they don't match. Contrast with researchTopics
   * which act as a hard required-relevance filter.
   */
  softTopics?: string[];
  /**
   * Journals the user prefers (e.g. "Advanced Materials", "Nature Materials",
   * "Science", "JACS"). These are used as a primary paper source AND given a
   * scoring boost: a paper published in one of these journals has its relevance
   * score multiplied by 4/3 (+1/3 of its own score). A non-preferred paper that
   * is a much stronger match can still outrank a preferred-journal paper.
   */
  preferredJournals?: string[];
  feedFocus: FeedFocus;
  feedFreshness: FeedFreshness;
  paperCount: 5 | 10;
  feedSourceMix: FeedSourceMix;
  feedImportance: FeedImportance;
  feedMethodMode: FeedMethodMode;
  feedDiscoveryMode: FeedDiscoveryMode;
  feedAvoidReviews: boolean;
  feedAvoidOldPapers: boolean;
  feedAvoidBroadSurveys: boolean;
  /**
   * The user's advisor / principal investigator (a person's name). Anchors the
   * affiliation feature. Persisted in the legacy `lab` DB column (no migration).
   */
  advisorName?: string;
  /**
   * Resolved + user-confirmed OpenAlex author ID for the advisor (e.g.
   * "A5012345678"). Confirmed once, then permanent. Local-only. When set, the
   * feed seeds discovery from this author's work.
   */
  advisorAuthorId?: string;
  /** Confirmed human-readable identity, e.g. "Paul V. Braun · Materials Science, University of Illinois". Local-only. */
  advisorAuthorLabel?: string;
  /**
   * Cached discovery seeds derived from the advisor's recent, project-relevant
   * work. `advisorSeedTexts` (title + short abstract) bias TF-IDF scoring;
   * `advisorSeedWorkIds` (OpenAlex IDs) anchor the citation-neighborhood pull.
   * Recomputed monthly (see `advisorSeedsRefreshedAt`). Local-only.
   */
  advisorSeedWorkIds?: string[];
  advisorSeedTexts?: string[];
  /** ISO timestamp of the last monthly seed recompute. Local-only. */
  advisorSeedsRefreshedAt?: string | null;
  // Daily-digest preferences. `digestHourLocal` is interpreted in
  // `digestTimezone` (IANA name) by the scheduling cron.
  digestEnabled: boolean;
  digestHourLocal: number;
  digestTimezone: string;
  digestChannel: DigestChannel;
  digestFrequency: DigestFrequency;
  /**
   * Address the daily email digest is sent to. When blank, the cron falls back
   * to the user's account (OAuth) email. Synced to the `digest_email` DB column
   * so the server-side cron can read it.
   */
  digestEmail?: string;
  /**
   * Optional per-user data-source API keys for the jobs & events feeds. All
   * kept in local browser state (never synced to the shared profile row) so
   * users can bring their own keys without writing secrets server-side. Each
   * unlocks broader coverage:
   *   • Tavily   — web discovery of conferences + academic job boards (all fields)
   *   • Adzuna   — industry job aggregator across 19 countries (app_id + app_key)
   *   • USAJobs  — US federal / national-lab research posts (key + contact email)
   */
  tavilyEnabled: boolean;
  tavilyApiKey?: string;
  adzunaAppId?: string;
  adzunaAppKey?: string;
  usajobsApiKey?: string;
  usajobsUserAgent?: string;
  /**
   * Optional per-user AI override for Tier 2 reranking. Also local-only so
   * users can bring their own normal API key without syncing secrets to the
   * shared profile row.
   */
  feedAiProvider: UserAiProvider;
  feedAiApiKey?: string;
  /**
   * Per-user toggle for deep paper reports. When ON, opening a paper triggers
   * full HTML/PDF fetch + two-pass LLM analysis (classify -> extract) using
   * `feedAiProvider`/`feedAiApiKey`. When OFF, the legacy abstract-only report
   * path is used. Burns more tokens per paper but produces specific,
   * paper-grounded reports instead of summarizing the abstract.
   */
  deepReportEnabled: boolean;
  colorTheme: ColorTheme;
  /**
   * ISO timestamp of when the user completed (or skipped) the first-run
   * onboarding wizard. `null` means they have never been through it, which is
   * what gates the welcome flow. Local-only for now (persisted to localStorage
   * via the zustand store, NOT synced to the Supabase profile row), so a fresh
   * browser re-shows onboarding — and clearing localStorage fully resets it,
   * which keeps local dev testing simple. See `web/supabase/` for the optional
   * migration to make this cross-device later.
   */
  onboardedAt?: string | null;
}

export const defaultProfile: UserProfile = {
  displayName: "Peer Member",
  // Empty by design — first-run users see the profile-setup nudge in the
  // header rather than a feed pre-tuned for someone else's PhD.
  researchTopics: [],
  eventRequiredTopics: [],
  eventExploreTopics: [],
  jobRequiredTopics: [],
  jobExploreTopics: [],
  careerStage: "PhD Year 3",
  industryVsAcademia: "both",
  locationPreferences: [],
  authorisedCountries: [],
  preferredMethods: [],
  phdYear: 3,
  dislikedTopics: [],
  preferenceLedger: {},
  softTopics: [],
  preferredJournals: [],
  feedFocus: "balanced",
  feedFreshness: "week",
  paperCount: 10,
  feedSourceMix: "balanced",
  feedImportance: "new",
  feedMethodMode: "relatedOk",
  feedDiscoveryMode: "core",
  feedAvoidReviews: true,
  feedAvoidOldPapers: false,
  feedAvoidBroadSurveys: true,
  digestEnabled: true,
  digestHourLocal: 8,
  digestTimezone:
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      : "UTC",
  digestChannel: "inapp",
  digestFrequency: "daily",
  digestEmail: "",
  tavilyEnabled: false,
  tavilyApiKey: "",
  adzunaAppId: "",
  adzunaAppKey: "",
  usajobsApiKey: "",
  usajobsUserAgent: "",
  feedAiProvider: "default",
  feedAiApiKey: "",
  deepReportEnabled: false,
  colorTheme: "system:ember",
  onboardedAt: null,
};

export const themeModeOptions: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Accent presets. `seed` drives the light palette, `seedDark` the dark one —
 *  every other color (secondaries, tinted gray ramp) derives in CSS. */
export const themeAccentOptions: {
  value: ThemeAccent;
  label: string;
  seed: string;
  seedDark: string;
}[] = [
  { value: "ember", label: "Ember", seed: "#ff520d", seedDark: "#ff6a2b" },
  { value: "rose", label: "Rose", seed: "#e0347c", seedDark: "#f0559a" },
  { value: "marigold", label: "Marigold", seed: "#d98e04", seedDark: "#eaa61e" },
  { value: "sage", label: "Sage", seed: "#2e7d5b", seedDark: "#4aa87d" },
  { value: "indigo", label: "Indigo", seed: "#3f5bd9", seedDark: "#7a90f2" },
  { value: "violet", label: "Violet", seed: "#7a3fd9", seedDark: "#a078f0" },
];

export const careerStages: CareerStage[] = [
  "PhD Year 1",
  "PhD Year 2",
  "PhD Year 3",
  "PhD Year 4",
  "PhD Year 5",
  "PhD Year 6",
  "Postdoc",
  "Research Scientist",
];

export const industryPreferences: IndustryAcademiaPreference[] = [
  "academia",
  "industry",
  "both",
  "startups",
  "bigTech",
];

