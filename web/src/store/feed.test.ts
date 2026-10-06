import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const persistenceCapture = vi.hoisted(() => ({
  partialize: undefined as ((state: unknown) => unknown) | undefined,
  // P4-S5b — captured the same way partialize already is, so the
  // deliveredLocal-seeding migration step can be tested directly against
  // the real function the store configures, without a DOM or an actual
  // localStorage round trip (matching this file's existing partialize test
  // pattern below).
  migrate: undefined as
    | ((persistedState: unknown, version: number) => unknown)
    | undefined,
}));

vi.mock("zustand/middleware", () => ({
  persist: (
    initializer: unknown,
    options?: {
      partialize?: (state: unknown) => unknown;
      migrate?: (persistedState: unknown, version: number) => unknown;
    },
  ) => {
    persistenceCapture.partialize = options?.partialize;
    persistenceCapture.migrate = options?.migrate;
    return initializer;
  },
}));

import { defaultProfile, type Event, type Job, type Paper } from "@/types";
import { activePaperTopicsKey, useFeedStore } from "@/store/feed";
import { useProfileStore } from "@/store/profile";
import { useJevScreeningStore } from "@/store/jev-screening";
// P4-S5b-FIX2 (Round 3) — the same already-exported "has the initial auth
// check settled" signal feed.ts's resolveOwnerKeyForLoad() reads. Reading/
// setting it here, in a test, is the same read-only use feed.ts itself
// makes; profile-sync.tsx is not edited by this fix.
import { useSyncGate } from "@/components/profile-sync";
// FEED-SYNC-FLAG — the same shared flag store feed-sync.tsx's migration
// batch and this file's cloud* helpers both set/clear (see feed.ts's own
// import of this module and its updateFeedPushFailedFlag).
import { useFeedSyncStatus } from "@/lib/feed/sync-status";
import { selectedSenseConcept } from "@/lib/feed/senses";
import { localCalendarDate } from "@/lib/local-calendar-date";
import { STARTER_TOPICS, STARTER_TOPICS_KEY } from "@/lib/feed/starter-topics";

// A signed-in fixture for tests that need a real owner id: the store picks the
// current deliveredLocalByOwner namespace from `useSyncGate`'s `authUserId`
// (see feed.ts's currentOwnerKey()), so signing in is publishing that id the
// way profile-sync.tsx does the moment the auth check resolves.
function signIn(userId: string) {
  useSyncGate.setState({
    settled: true,
    authUserId: userId,
    authOutcome: "signed-in",
  });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function paperFeedResponse(id: string) {
  return {
    items: [
      {
        id,
        source: "openalex",
        title: `Paper ${id}`,
        authors: ["Researcher"],
        abstract: "A concise abstract. A useful result.",
        url: `https://example.com/${id}`,
        publishedAt: "2026-07-24",
        venue: "Example Journal",
        metadata: {},
        score: 0.9,
        scoreBreakdown: {
          keyword: 0.9,
          tfidf: 0.9,
          recency: 0.9,
          source: 0.9,
          combined: 0.9,
        },
        matchedKeywords: ["materials"],
        relevanceReason: "Matches materials.",
      },
    ],
    meta: {},
  };
}

function eventsFeedResponse(id?: string) {
  return {
    items: id
      ? [
          {
            id,
            name: `Event ${id}`,
            type: "conference",
            date: "2026-08-01",
            location: "Chicago",
            isOnline: false,
            shortDescription: "An event.",
            relevanceReason: "Relevant event.",
          },
        ]
      : [],
    meta: {},
  };
}

function jobsFeedResponse(id?: string) {
  return {
    items: id
      ? [
          {
            id,
            roleTitle: `Role ${id}`,
            companyOrLab: "Example Lab",
            location: "Chicago",
            isRemote: false,
            keyRequirements: ["materials"],
            matchReason: "Relevant role.",
          },
        ]
      : [],
    meta: {},
  };
}

function requestPath(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.pathname;
  return new URL(input.url).pathname;
}

describe("feed lane loading", () => {
  let responseQueues: Map<string, Deferred<Response>[]>;
  let fetchMock: ReturnType<typeof vi.fn>;

  function enqueue(path: string): Deferred<Response> {
    const next = deferred<Response>();
    const queue = responseQueues.get(path) ?? [];
    queue.push(next);
    responseQueues.set(path, queue);
    return next;
  }

  function enqueueResolved(path: string, body: unknown): void {
    enqueue(path).resolve(jsonResponse(body));
  }

  beforeEach(() => {
    responseQueues = new Map();
    fetchMock = vi.fn((input: string | URL | Request) => {
      const path = requestPath(input);
      const next = responseQueues.get(path)?.shift();
      if (!next) {
        return Promise.reject(new Error(`Unexpected fetch: ${path}`));
      }
      return next.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    useProfileStore.setState({
      profile: {
        ...defaultProfile,
        researchTopics: ["materials"],
        // Lanes read their topics from the day-locked active inputs, not the
        // raw profile fields, so all three surfaces need one to fetch at all.
        activeSearchInputs: {
          papers: { required: ["materials"], explore: [] },
          events: { required: ["materials"], explore: [] },
          jobs: { required: ["materials"], explore: [] },
          locationPreferences: [],
          promotedOn: "2026-07-29",
        },
      },
    });
    // P4-S5b-FIX2 (Round 3) — ABC-JEV-INTEGRATION.md §1g/§1c, closing
    // docs/jev-abc/P4-S5b-FIX-A-20260924T103406Z.md NEW FINDINGS #1: every
    // test in this file that never explicitly signs a user in relies on
    // `authOutcome: "signed-out"` (below) meaning "confirmed signed out". Under
    // this fix, `loadFeed` also needs `useSyncGate`'s `settled` flag to
    // trust that reading — so default it to already-settled here (matching
    // what every pre-existing test in this file implicitly assumed).
    //
    // P4-S5b-FIX3 (Round 3) — resolveOwnerKeyForLoad (feed.ts) no longer
    // consults `settled` for its anonymous fallback at all; it consults
    // `authOutcome`/`authUserId` instead (see feed.ts's own doc comment).
    // Default `authOutcome` to `"signed-out"` here too, for the exact same
    // reason `settled` above defaults to `true` — every pre-existing test
    // that never explicitly signs a user in implicitly assumes "confirmed
    // signed out". `settled` is left in place (harmless, unread by the new
    // logic, and some tests/comments still narrate it). The new
    // "P4-S5b-FIX3" tests below override `authOutcome`/`authUserId` (and,
    // where relevant, `settled`) to exercise the window between the auth
    // check resolving and the (possibly failed/hanging) profile pull
    // finishing.
    useSyncGate.setState({ settled: true, authUserId: null, authOutcome: "signed-out" });
    useFeedStore.setState({
      papers: [],
      events: [],
      jobs: [],
      savedPapers: [],
      savedEvents: [],
      savedJobs: [],
      isLoading: false,
      papersLoading: false,
      eventsLoading: false,
      jobsLoading: false,
      lastRefresh: null,
      feedTopicsKey: null,
      aiPaperSearchEnabled: true,
      readItems: {},
      appliedAt: {},
      registeredAt: {},
      submittedAt: {},
      paperSummaries: {},
      recentlyShownIds: {},
      pendingDismissal: null,
      paperFeedback: {},
      eventFeedback: {},
      jobFeedback: {},
      // P4-S5a — reset every test to a clean slate; unlike the fields above,
      // these three are new and every existing test predates them, so an
      // explicit reset here (matching this block's own established pattern)
      // keeps one test's batch state from leaking into the next.
      batchId: null,
      batchStatus: null,
      pendingBatchAck: null,
      // P4-S5a-FIX (Round 3) — F-A-P4S5-01: same reasoning as the three
      // fields above, for the new field this fix adds.
      renderedBatchId: null,
      // P4-S5b — same reasoning again: new fields, every existing test
      // predates them, explicit reset keeps one test's device-local
      // delivery state from leaking into the next.
      // P4-S5b-FIX (Round 3): deliveredLocal (flat) replaced by the
      // namespaced deliveredLocalByOwner + deliveredLocalOwnerOrder pair;
      // pendingLocalDelivery's shape changed but still resets to null.
      deliveredLocalByOwner: {},
      deliveredLocalOwnerOrder: [],
      pendingLocalDelivery: null,
      // FEED-SYNC-FLAG round 2 (§1aq) — same reasoning as the other P4-S5
      // resets above: a new persisted field, every pre-existing test
      // predates it, explicit reset keeps one test's pending-push record
      // from leaking into the next.
      pendingPushByOwner: {},
      // OUTBOX-RETRY — same reasoning: a new persisted field, reset here so
      // one test's captured feedback payloads can't leak into the next.
      pendingFeedbackPayloadByOwner: {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("publishes papers before events and jobs settle", async () => {
    const papersResponse = enqueue("/api/feed");
    const eventsResponse = enqueue("/api/events/feed");
    const jobsResponse = enqueue("/api/jobs/feed");

    // The daily surface asks for papers alone now, so the three-lane
    // coordination this test covers has to be requested explicitly.
    const load = useFeedStore.getState().loadFeed({ lanes: ["papers", "events", "jobs"] });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    expect(useFeedStore.getState()).toMatchObject({
      isLoading: true,
      papersLoading: true,
      eventsLoading: true,
      jobsLoading: true,
    });

    // Simulate hydration/user interaction after the request starts. The lane
    // must decorate from current state when it commits.
    useFeedStore.setState({
      savedPapers: [
        {
          id: "paper-fast",
          title: "Saved paper",
          authors: ["Researcher"],
          relevanceReason: "Saved.",
          venue: "Example Journal",
          source: "other",
          summaryIntro: "Saved intro.",
          summaryExperimentKeywords: [],
          summaryResultDiscussion: "Saved result.",
          isSaved: true,
          feedback: "liked",
        },
      ],
      paperFeedback: { "paper-fast": "liked" },
    });
    papersResponse.resolve(jsonResponse(paperFeedResponse("paper-fast")));
    await vi.waitFor(() => {
      expect(useFeedStore.getState().papers).toHaveLength(1);
    });

    expect(useFeedStore.getState()).toMatchObject({
      isLoading: true,
      papersLoading: false,
      eventsLoading: true,
      jobsLoading: true,
      feedTopicsKey: activePaperTopicsKey(useProfileStore.getState().profile),
    });
    expect(useFeedStore.getState().papers[0]?.id).toBe("paper-fast");
    expect(useFeedStore.getState().papers[0]).toMatchObject({
      isSaved: true,
      feedback: "liked",
    });
    expect(useFeedStore.getState().events).toEqual([]);
    expect(useFeedStore.getState().jobs).toEqual([]);
    const committedPapers = useFeedStore.getState().papers;

    eventsResponse.resolve(jsonResponse(eventsFeedResponse("event-slower")));
    await vi.waitFor(() => {
      expect(useFeedStore.getState().eventsLoading).toBe(false);
    });
    expect(useFeedStore.getState()).toMatchObject({
      isLoading: true,
      jobsLoading: true,
    });
    expect(useFeedStore.getState().papers).toBe(committedPapers);

    jobsResponse.resolve(jsonResponse(jobsFeedResponse("job-slowest")));
    await load;

    expect(useFeedStore.getState()).toMatchObject({
      isLoading: false,
      papersLoading: false,
      eventsLoading: false,
      jobsLoading: false,
    });
    expect(useFeedStore.getState().papers).toBe(committedPapers);
    expect(useFeedStore.getState().events[0]?.id).toBe("event-slower");
    expect(useFeedStore.getState().jobs[0]?.id).toBe("job-slowest");
  });

  it.each([
    {
      kind: "project",
      focus: { currentProject: "Reduce sulfide interface resistance" },
      value: "Reduce sulfide interface resistance",
    },
    {
      kind: "challenge",
      focus: { currentChallenges: "Avoid dendrite formation" },
      value: "Avoid dendrite formation",
    },
  ])("posts a $kind-only browser intent with no active topics", async ({ kind, focus, value }) => {
    const profile = {
      ...defaultProfile,
      ...focus,
      activeSearchInputs: {
        papers: { required: [], explore: [] },
        events: { required: [], explore: [] },
        jobs: { required: [], explore: [] },
        locationPreferences: [],
        promotedOn: "2026-07-29",
      },
    };
    useProfileStore.setState({ profile });
    enqueueResolved("/api/feed", { items: [], meta: {} });

    await useFeedStore.getState().loadFeed({ lanes: ["papers"] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestPath(fetchMock.mock.calls[0]![0] as string | URL | Request)).toBe("/api/feed");
    const request = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    // CHANGED (FIRST-VISIT RULING, ABC-JEV-INTEGRATION.md §4 Round 3
    // "MERGE-B-FEED complete"): the literal `topics` field is a separate,
    // supplementary signal from `intent` -- with no literal topics declared it
    // now fills from the same starter list a genuinely-empty reader gets
    // (`topicsOrStarter`), never a gate. The request is still driven primarily
    // by `intent` below (acceptance 1 -- no dummy-keyword requirement).
    expect(request).toMatchObject({ topics: [...STARTER_TOPICS] });
    expect(request.intent).toMatchObject({ version: "feed-intent-v1" });
    expect(request.intent[kind]).toMatchObject({ presence: "value", value });
    expect(useFeedStore.getState().feedTopicsKey).toBe(activePaperTopicsKey(profile));
  });

  it("sends the starter sample for a genuinely empty browser research focus, never a blocked/silent load", async () => {
    // CHANGED (ABC-JEV-INTEGRATION.md §4 Round 3 "MERGE-B-FEED complete" FIRST-VISIT
    // RULING (a)): this used to assert NO fetch at all for a reader with
    // nothing declared ("ask first"). The merge adopts main's zero-setup
    // first-run design instead: a reader with no project, challenge, topic or
    // sense declared gets main's curated starter sample -- a real request with
    // `STARTER_TOPICS_KEY` and the starter topic list, never silence and never
    // a blocking message. A reader who HAS declared something still gets their
    // own intent-driven request (see the `it.each` case above).
    const profile = {
      ...defaultProfile,
      currentProject: "",
      currentChallenges: "",
      activeSearchInputs: {
        papers: { required: [], explore: [] },
        events: { required: [], explore: [] },
        jobs: { required: [], explore: [] },
        locationPreferences: [],
        promotedOn: "2026-07-29",
      },
    };
    useProfileStore.setState({ profile });
    enqueueResolved("/api/feed", { items: [], meta: {} });

    await useFeedStore.getState().loadFeed({ lanes: ["papers"] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(request).toMatchObject({ topics: [...STARTER_TOPICS] });
    expect(useFeedStore.getState()).toMatchObject({
      feedError: null,
      feedTopicsKey: STARTER_TOPICS_KEY,
      papersLoading: false,
    });
  });

  it("posts once for a selected v1 sense-only browser research focus", async () => {
    const profile = {
      ...defaultProfile,
      currentProject: "",
      currentChallenges: "",
      selectedSenseConcepts: [selectedSenseConcept("materials.scanning_electron_microscopy")],
      activeSearchInputs: {
        papers: { required: [], explore: [] },
        events: { required: [], explore: [] },
        jobs: { required: [], explore: [] },
        locationPreferences: [],
        promotedOn: "2026-07-29",
      },
    };
    useProfileStore.setState({ profile });
    enqueueResolved("/api/feed", { items: [], meta: {} });

    await useFeedStore.getState().loadFeed({ lanes: ["papers"] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    // `topics` (CHANGED, see the empty-focus test above for the full FIRST-VISIT
    // RULING citation): a real declared sense is a real intent -- this request
    // is intent-driven, not the starter sample -- but the LITERAL `topics`
    // field still falls back to the starter list because no literal topic was
    // declared either. `intent`/`feedTopicsKey` below (the real signal here)
    // are unaffected.
    expect(request).toMatchObject({
      topics: [...STARTER_TOPICS],
      intent: {
        version: "feed-intent-v1",
        selectedSenseConcepts: [expect.objectContaining({ senseId: "materials.scanning_electron_microscopy" })],
      },
    });
    expect(useFeedStore.getState().feedTopicsKey).toBe(activePaperTopicsKey(profile));
  });

  it("advances recently-shown only when explicitly requested", async () => {
    const alreadyShownAt = Date.now() - 1_000;
    useFeedStore.setState({
      recentlyShownIds: { "paper-already-seen": alreadyShownAt },
    });

    enqueueResolved("/api/feed", paperFeedResponse("paper-plain-open"));
    enqueueResolved("/api/events/feed", eventsFeedResponse());
    enqueueResolved("/api/jobs/feed", jobsFeedResponse());
    await useFeedStore.getState().loadFeed();

    expect(useFeedStore.getState().recentlyShownIds).toEqual({
      "paper-already-seen": alreadyShownAt,
    });

    const refreshedPapers = enqueue("/api/feed");
    enqueueResolved("/api/events/feed", eventsFeedResponse());
    enqueueResolved("/api/jobs/feed", jobsFeedResponse());
    const explicitRefresh = useFeedStore
      .getState()
      .loadFeed({ advanceHistory: true });
    // P4-S5a (Round 3): loadFeed now reconciles a pending batch
    // acknowledgment before it builds the request (a real `await`, even
    // when — as here — there is nothing pending and it no-ops), so the
    // exclude-set snapshot below is no longer necessarily captured before
    // this call's own synchronous continuation resumes. What this test
    // actually proves is unchanged — a mutation to recentlyShownIds cannot
    // retroactively change a request already handed to fetch — so instead
    // of relying on exact microtask timing, wait for the SECOND /api/feed
    // call (this refresh's own) to have actually been issued before
    // mutating state concurrently with it still in flight.
    await vi.waitFor(() => {
      const paperCalls = fetchMock.mock.calls.filter(
        ([input]) => requestPath(input as string | URL | Request) === "/api/feed",
      );
      expect(paperCalls).toHaveLength(2);
    });
    const concurrentHistoryAt = Date.now() - 500;
    useFeedStore.setState((state) => ({
      recentlyShownIds: {
        ...state.recentlyShownIds,
        "paper-concurrent-history": concurrentHistoryAt,
      },
    }));
    refreshedPapers.resolve(jsonResponse(paperFeedResponse("paper-refreshed")));
    await explicitRefresh;

    expect(useFeedStore.getState().recentlyShownIds).toMatchObject({
      "paper-already-seen": alreadyShownAt,
      "paper-concurrent-history": concurrentHistoryAt,
      "paper-plain-open": expect.any(Number),
      "paper-refreshed": expect.any(Number),
    });

    const paperRequests = fetchMock.mock.calls.filter(
      ([input]) => requestPath(input as string | URL | Request) === "/api/feed",
    );
    expect(paperRequests).toHaveLength(2);
    // A PLAIN OPEN SENDS NO EXCLUSIONS AT ALL, and that is the point of the
    // daily paper pool. The server builds one pool per local day; if the
    // client kept subtracting everything it had already seen, that pool would
    // be stable server-side and shredded client-side, and re-opening the app
    // would still show a different — eventually empty — reading list.
    // P4-S5b (Round 3): still true here because this test's deliveredLocal
    // stays empty throughout — a plain load now DOES also send any
    // delivered-before-today ids (unconditionally, not gated on
    // advanceHistory like recentlyShownIds is), see the dedicated
    // "P4-S5b: device-local delivered memory" describe block below for that
    // new contract. This assertion's own meaning (recentlyShownIds/
    // displayedPapers/dismissed alone do not leak into a plain load) is
    // unchanged.
    expect(
      JSON.parse(String((paperRequests[0]?.[1] as RequestInit).body)),
    ).not.toHaveProperty("excludeIds");
    // A deliberate refresh is the one path that asks for something new, so it
    // alone carries the consume-once set.
    expect(
      JSON.parse(String((paperRequests[1]?.[1] as RequestInit).body)),
    ).toMatchObject({
      excludeIds: ["paper-already-seen", "paper-plain-open"],
    });
  });

  it("does not let stale lanes clear a newer load's flags", async () => {
    const firstPapers = enqueue("/api/feed");
    const secondPapers = enqueue("/api/feed");
    const firstEvents = enqueue("/api/events/feed");
    const secondEvents = enqueue("/api/events/feed");
    const firstJobs = enqueue("/api/jobs/feed");
    const secondJobs = enqueue("/api/jobs/feed");

    const firstLoad = useFeedStore.getState().loadFeed({ lanes: ["papers", "events", "jobs"] });
    const secondLoad = useFeedStore.getState().loadFeed({ lanes: ["papers", "events", "jobs"] });

    firstPapers.resolve(jsonResponse(paperFeedResponse("paper-stale")));
    firstEvents.resolve(jsonResponse(eventsFeedResponse("event-stale")));
    firstJobs.resolve(jsonResponse(jobsFeedResponse("job-stale")));
    await firstLoad;

    expect(useFeedStore.getState()).toMatchObject({
      papers: [],
      events: [],
      jobs: [],
      isLoading: true,
      papersLoading: true,
      eventsLoading: true,
      jobsLoading: true,
    });

    secondPapers.resolve(jsonResponse(paperFeedResponse("paper-current")));
    await vi.waitFor(() => {
      expect(useFeedStore.getState().papers[0]?.id).toBe("paper-current");
    });
    expect(useFeedStore.getState()).toMatchObject({
      isLoading: true,
      papersLoading: false,
      eventsLoading: true,
      jobsLoading: true,
    });

    secondEvents.resolve(jsonResponse(eventsFeedResponse("event-current")));
    secondJobs.resolve(jsonResponse(jobsFeedResponse("job-current")));
    await secondLoad;

    expect(useFeedStore.getState()).toMatchObject({
      isLoading: false,
      papersLoading: false,
      eventsLoading: false,
      jobsLoading: false,
    });
    expect(useFeedStore.getState().events[0]?.id).toBe("event-current");
    expect(useFeedStore.getState().jobs[0]?.id).toBe("job-current");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("stores digest bullets as paper summaries keyed by paper id", () => {
    useFeedStore.getState().setPaperSummaries([
      { paperId: "paper-a", text: "Sentence for paper A." },
      { paperId: "paper-b", text: "Sentence for paper B." },
    ]);

    expect(useFeedStore.getState().paperSummaries).toEqual({
      "paper-a": "Sentence for paper A.",
      "paper-b": "Sentence for paper B.",
    });
  });

  it("sets and unsets job and event completion timestamps", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
    const job = jobsFeedResponse("job-progress").items[0] as Job;
    const event = eventsFeedResponse("event-progress").items[0] as Event;
    useFeedStore.setState({
      savedJobs: [job],
      savedEvents: [event],
    });

    useFeedStore
      .getState()
      .setJobApplied(job, true, "2026-07-30T15:00:00.000Z");
    useFeedStore
      .getState()
      .setEventRegistered(event, true, "2026-07-30T16:00:00.000Z");
    useFeedStore
      .getState()
      .setEventSubmitted(event, true, "2026-07-30T17:00:00.000Z");

    let state = useFeedStore.getState();
    expect(state.appliedAt).toEqual({
      [job.id]: "2026-07-30T15:00:00.000Z",
    });
    expect(state.registeredAt).toEqual({
      [event.id]: "2026-07-30T16:00:00.000Z",
    });
    expect(state.submittedAt).toEqual({
      [event.id]: "2026-07-30T17:00:00.000Z",
    });
    expect(state.savedJobs[0]).toMatchObject({
      appliedAt: "2026-07-30T15:00:00.000Z",
    });
    expect(state.savedEvents[0]).toMatchObject({
      registeredAt: "2026-07-30T16:00:00.000Z",
      submittedAt: "2026-07-30T17:00:00.000Z",
    });

    useFeedStore.getState().setJobApplied(job, false);
    useFeedStore.getState().setEventRegistered(event, false);
    useFeedStore.getState().setEventSubmitted(event, false);

    state = useFeedStore.getState();
    expect(state.appliedAt[job.id]).toBeUndefined();
    expect(state.registeredAt[event.id]).toBeUndefined();
    expect(state.submittedAt[event.id]).toBeUndefined();
    expect(state.savedJobs[0]).not.toHaveProperty("appliedAt");
    expect(state.savedEvents[0]).not.toHaveProperty("registeredAt");
    expect(state.savedEvents[0]).not.toHaveProperty("submittedAt");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));

    const replacementPayloads = fetchMock.mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { payload: unknown };
      return body.payload;
    });
    expect(replacementPayloads[3]).not.toHaveProperty("appliedAt");
    expect(replacementPayloads[4]).toMatchObject({
      submittedAt: "2026-07-30T17:00:00.000Z",
    });
    expect(replacementPayloads[4]).not.toHaveProperty("registeredAt");
    expect(replacementPayloads[5]).not.toHaveProperty("registeredAt");
    expect(replacementPayloads[5]).not.toHaveProperty("submittedAt");
  });

  it("5-04: persists today's briefing papers, not just saved ones", () => {
    useFeedStore.setState({
      papers: [
        {
          id: "paper-today",
          title: "Today's briefing paper",
          authors: ["Researcher"],
          relevanceReason: "Matches materials.",
          venue: "Example Journal",
          source: "other",
          summaryIntro: "Intro.",
          summaryExperimentKeywords: [],
          summaryResultDiscussion: "Result.",
          isSaved: false,
        },
      ],
    });

    expect(persistenceCapture.partialize).toBeTypeOf("function");
    const persisted = persistenceCapture.partialize?.(useFeedStore.getState());
    expect(persisted).toMatchObject({
      papers: [expect.objectContaining({ id: "paper-today" })],
    });
  });

  it("persists all three completion maps", () => {
    useFeedStore.setState({
      appliedAt: { "job-persisted": "2026-07-30T15:00:00.000Z" },
      registeredAt: { "event-persisted": "2026-07-30T16:00:00.000Z" },
      submittedAt: { "event-persisted": "2026-07-30T17:00:00.000Z" },
    });

    expect(persistenceCapture.partialize).toBeTypeOf("function");
    const persisted = persistenceCapture.partialize?.(
      useFeedStore.getState(),
    );
    expect(persisted).toMatchObject({
      appliedAt: { "job-persisted": "2026-07-30T15:00:00.000Z" },
      registeredAt: { "event-persisted": "2026-07-30T16:00:00.000Z" },
      submittedAt: { "event-persisted": "2026-07-30T17:00:00.000Z" },
    });
  });

  it("round-trips completion timestamps inside saved payloads", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
    const job = jobsFeedResponse("job-round-trip").items[0] as Job;
    const event = eventsFeedResponse("event-round-trip").items[0] as Event;

    useFeedStore
      .getState()
      .setJobApplied(job, true, "2026-07-30T15:00:00.000Z");
    useFeedStore
      .getState()
      .setEventRegistered(event, true, "2026-07-30T16:00:00.000Z");
    useFeedStore
      .getState()
      .setEventSubmitted(event, true, "2026-07-30T17:00:00.000Z");

    await vi.waitFor(() => {
      const savedCalls = fetchMock.mock.calls.filter(
        ([input]) => requestPath(input) === "/api/saved",
      );
      expect(savedCalls).toHaveLength(3);
    });

    const savedBodies = fetchMock.mock.calls
      .filter(([input]) => requestPath(input) === "/api/saved")
      .map(([, init]) => JSON.parse(String(init?.body))) as {
      itemId: string;
      payload: unknown;
    }[];
    const jobPayload = savedBodies.find(
      ({ itemId }) => itemId === job.id,
    )?.payload as Job;
    const eventBodies = savedBodies.filter(
      ({ itemId }) => itemId === event.id,
    );
    const eventPayload = eventBodies[eventBodies.length - 1]?.payload as Event;

    expect(jobPayload).toMatchObject({
      id: job.id,
      appliedAt: "2026-07-30T15:00:00.000Z",
    });
    expect(eventPayload).toMatchObject({
      id: event.id,
      registeredAt: "2026-07-30T16:00:00.000Z",
      submittedAt: "2026-07-30T17:00:00.000Z",
    });

    useFeedStore.setState({
      savedJobs: [],
      savedEvents: [],
      appliedAt: {},
      registeredAt: {},
      submittedAt: {},
    });
    useFeedStore.getState().hydrateFromRemote({
      savedJobs: [jobPayload],
      savedEvents: [eventPayload],
    });

    const restored = useFeedStore.getState();
    expect(restored.savedJobs).toHaveLength(1);
    expect(restored.savedEvents).toHaveLength(1);
    expect(restored.appliedAt[job.id]).toBe("2026-07-30T15:00:00.000Z");
    expect(restored.registeredAt[event.id]).toBe(
      "2026-07-30T16:00:00.000Z",
    );
    expect(restored.submittedAt[event.id]).toBe(
      "2026-07-30T17:00:00.000Z",
    );
  });

  // FEED-SYNC-FLAG (ABC-JEV-INTEGRATION.md §5 row FEED-SYNC-FLAG, following
  // POLISH-1-SYNC-A's MEDIUM finding,
  // docs/jev-abc/POLISH-1-SYNC-A-20260928T163023Z.md) — the P6 sign-out
  // warning (account-section.tsx) reads useFeedSyncStatus().pushFailed, but
  // that flag used to be set/cleared ONLY by feed-sync.tsx's one-time
  // sign-in migration batch; an ordinary mid-session cloudSave/cloudUnsave/
  // cloudMarkRead/cloudMarkUnread failure (this file's own helpers) was
  // swallowed by `console.warn` alone and never reached it. These tests
  // prove the fix directly against the store, the same boundary the
  // hydrateFromRemote tests below use for SIGNIN-MERGE.
  //
  // `cloudFeedback` (exercised here via `moreLikePaper`, which calls only
  // `submitFeedback` → `cloudFeedback`, never `cloudSave`) is included as a
  // sibling on the exact same try/apiFetch/catch(console.warn) pattern,
  // beyond the reviewer's literal 4-function list — `resetLocal()` (sign-out)
  // wipes `paperFeedback`/`eventFeedback`/`jobFeedback` alongside saved/read
  // state, so an unsynced feedback push is the same P6 data-loss risk.
  //
  // ROUND 2 (ABC-JEV-INTEGRATION.md §1aq, ruling on
  // docs/jev-abc/FEED-SYNC-FLAG-A-20260928T180309Z.md's FAILED_REVIEW) —
  // round 1's own tests above this comment proved the WRONG contract: they
  // pre-set the shared boolean directly (`useFeedSyncStatus.setState({
  // pushFailed: true })`, with no notion of which item/dimension it was
  // "for") and then accepted ANY helper's success clearing it. That is
  // exactly S1/S2. Per this task's brief ("existing round-1 tests... must be
  // REWRITTEN to the new contract... never deleted"), the "success clears a
  // previously-set flag" tests below are rewritten to pre-set the SPECIFIC
  // dimension key that helper's own success is supposed to clear, alongside
  // an UNRELATED key that must survive — the direct, minimal reproduction of
  // what round 1 got wrong. The "failure sets the flag" tests keep their
  // original shape (a failure setting `pushFailed` true is unchanged
  // behaviour) but now also assert the exact key, since "true" alone no
  // longer proves WHICH write the flag is about.
  describe("feed push-failed flag (FEED-SYNC-FLAG)", () => {
    const flagPaper: Paper = {
      id: "paper-flag",
      title: "Flag paper",
      authors: ["Researcher"],
      relevanceReason: "Matches materials.",
      venue: "Example Journal",
      source: "other",
      summaryIntro: "Intro.",
      summaryExperimentKeywords: [],
      summaryResultDiscussion: "Result.",
      isSaved: false,
    };

    beforeEach(() => {
      // The outer beforeEach (this describe's parent) already resets
      // useFeedStore (incl. pendingPushByOwner) / useProfileStore and
      // defaults useSyncGate to signed-out — this only resets the flag
      // store, which lives outside both. Round 2: resets BOTH fields —
      // `pendingKeys` is now the primary state, `pushFailed` derived.
      useFeedSyncStatus.setState({ pendingKeys: {}, pushFailed: false });
    });

    function signIn() {
      useSyncGate.setState({
        settled: true,
        authUserId: "user-flag",
        authOutcome: "signed-in",
      });
    }

    it("a failed cloudSave (savePaper) sets the flag when signed in, keyed by item+kind", async () => {
      signIn();
      // savePaper also fires cloudFeedback (POST /api/feedback) via
      // submitFeedback — cloudFeedback's OWN success/failure handling is
      // covered in isolation below (via moreLikePaper, which triggers only
      // cloudFeedback). To make THIS test sensitive to cloudSave's own
      // try/catch alone (not a race between the two helpers' resolution
      // order), /api/saved is the only path that ever resolves; every other
      // path (i.e. /api/feedback) hangs for the life of the test.
      fetchMock.mockImplementation((input: string | URL | Request) => {
        const path = requestPath(input);
        if (path === "/api/saved") {
          return Promise.resolve(jsonResponse({ error: "boom" }, 500));
        }
        return new Promise<Response>(() => {});
      });
      useFeedStore.getState().savePaper(flagPaper);
      await vi.waitFor(() => {
        expect(
          useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-flag"],
        ).toBe(true);
      });
      expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
    });

    it("a failed cloudUnsave (unsavePaper) sets the flag when signed in, keyed by item+kind", async () => {
      signIn();
      fetchMock.mockImplementation(async () => jsonResponse({ error: "boom" }, 500));
      useFeedStore.getState().unsavePaper(flagPaper.id);
      await vi.waitFor(() => {
        expect(
          useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-flag"],
        ).toBe(true);
      });
      expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
    });

    it("a failed cloudMarkRead (markRead) sets the flag when signed in, keyed by item", async () => {
      signIn();
      fetchMock.mockImplementation(async () => jsonResponse({ error: "boom" }, 500));
      useFeedStore.getState().markRead("paper-mark-read-fail");
      await vi.waitFor(() => {
        expect(
          useFeedSyncStatus.getState().pendingKeys["read:paper-mark-read-fail"],
        ).toBe(true);
      });
      expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
    });

    it("a failed cloudMarkUnread (markUnread) sets the flag when signed in, keyed by item", async () => {
      signIn();
      fetchMock.mockImplementation(async () => jsonResponse({ error: "boom" }, 500));
      useFeedStore.getState().markUnread("paper-mark-unread-fail");
      await vi.waitFor(() => {
        expect(
          useFeedSyncStatus.getState().pendingKeys["read:paper-mark-unread-fail"],
        ).toBe(true);
      });
      expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
    });

    it("a failed cloudFeedback (moreLikePaper, the sibling write) sets the flag when signed in, keyed by item+kind", async () => {
      signIn();
      fetchMock.mockImplementation(async () => jsonResponse({ error: "boom" }, 500));
      useFeedStore.getState().moreLikePaper(flagPaper);
      await vi.waitFor(() => {
        expect(
          useFeedSyncStatus.getState().pendingKeys["feedback:paper:paper-flag"],
        ).toBe(true);
      });
      expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
    });

    // Per-helper success-path coverage, ROUND 2 CONTRACT (§1aq). Each test
    // pre-sets the EXACT dimension key that helper's own success is
    // supposed to clear, PLUS an unrelated key from a different
    // item/dimension that must survive untouched — the direct reproduction
    // of what round 1's version of these tests got wrong (pre-setting the
    // bare shared boolean, with no notion of "whose" failure it was, so ANY
    // success cleared it — exactly S1/S2). A mutant that goes back to
    // clearing the WHOLE flag/set on any success — not just this helper's
    // own key — turns the "unrelated key survives" assertion red.
    it("a successful cloudSave clears ONLY saved:paper:<id> — an unrelated pending key survives", async () => {
      signIn();
      useFeedSyncStatus.setState({
        pendingKeys: {
          "saved:paper:paper-flag": true,
          "read:paper-unrelated": true,
        },
        pushFailed: true,
      });
      fetchMock.mockImplementation((input: string | URL | Request) => {
        const path = requestPath(input);
        if (path === "/api/saved") return Promise.resolve(jsonResponse({ ok: true }));
        return new Promise<Response>(() => {});
      });
      useFeedStore.getState().savePaper(flagPaper);
      await vi.waitFor(() => {
        expect(
          useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-flag"],
        ).toBeUndefined();
      });
      expect(useFeedSyncStatus.getState().pendingKeys["read:paper-unrelated"]).toBe(
        true,
      );
      expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
    });

    it("a successful cloudUnsave clears ONLY saved:paper:<id> — an unrelated pending key survives", async () => {
      signIn();
      useFeedSyncStatus.setState({
        pendingKeys: {
          "saved:paper:paper-flag": true,
          "feedback:paper:paper-unrelated": true,
        },
        pushFailed: true,
      });
      fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
      useFeedStore.getState().unsavePaper(flagPaper.id);
      await vi.waitFor(() => {
        expect(
          useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-flag"],
        ).toBeUndefined();
      });
      expect(
        useFeedSyncStatus.getState().pendingKeys["feedback:paper:paper-unrelated"],
      ).toBe(true);
      expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
    });

    it("a successful cloudMarkRead clears ONLY read:<id> — an unrelated pending key survives", async () => {
      signIn();
      useFeedSyncStatus.setState({
        pendingKeys: {
          "read:paper-mark-read-ok": true,
          "saved:paper:paper-unrelated": true,
        },
        pushFailed: true,
      });
      fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
      useFeedStore.getState().markRead("paper-mark-read-ok");
      await vi.waitFor(() => {
        expect(
          useFeedSyncStatus.getState().pendingKeys["read:paper-mark-read-ok"],
        ).toBeUndefined();
      });
      expect(
        useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-unrelated"],
      ).toBe(true);
      expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
    });

    it("a successful cloudMarkUnread clears ONLY read:<id> — an unrelated pending key survives", async () => {
      signIn();
      useFeedSyncStatus.setState({
        pendingKeys: {
          "read:paper-mark-unread-ok": true,
          "saved:paper:paper-unrelated": true,
        },
        pushFailed: true,
      });
      fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
      useFeedStore.getState().markUnread("paper-mark-unread-ok");
      await vi.waitFor(() => {
        expect(
          useFeedSyncStatus.getState().pendingKeys["read:paper-mark-unread-ok"],
        ).toBeUndefined();
      });
      expect(
        useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-unrelated"],
      ).toBe(true);
      expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
    });

    it("a successful cloudFeedback (moreLikePaper) clears ONLY feedback:paper:<id> — an unrelated pending key survives", async () => {
      signIn();
      useFeedSyncStatus.setState({
        pendingKeys: {
          "feedback:paper:paper-flag": true,
          "saved:paper:paper-unrelated": true,
        },
        pushFailed: true,
      });
      fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
      useFeedStore.getState().moreLikePaper(flagPaper);
      await vi.waitFor(() => {
        expect(
          useFeedSyncStatus.getState().pendingKeys["feedback:paper:paper-flag"],
        ).toBeUndefined();
      });
      expect(
        useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-unrelated"],
      ).toBe(true);
      expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
    });

    // Separate from the five above: proves a successful write never sets a
    // flag that started false to true either (the "wrong direction" bug the
    // five tests above cannot see, since they all start from true).
    // `unsavePaper` fires exactly one cloud call (cloudUnsave alone, no
    // cloudFeedback) — nothing else in flight to race against. `vi.waitFor`
    // only proves the request was made — its promise chain (apiFetch's own
    // awaits, then updateFeedPushFailedFlag) still needs a real macrotask
    // tick to finish running, hence the explicit flush before the final
    // assertion (a bare `toHaveBeenCalled` check can pass on the very
    // first, synchronous poll, before that chain settles).
    it("a successful write does not set the flag", async () => {
      signIn();
      fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
      useFeedStore.getState().unsavePaper(flagPaper.id);
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(useFeedSyncStatus.getState().pendingKeys).toEqual({});
      expect(useFeedSyncStatus.getState().pushFailed).toBe(false);
    });

    it("a signed-out write's failure never sets the flag (no cloud to speak of)", async () => {
      // useSyncGate is signed-out by default (this file's outer beforeEach);
      // signIn() is deliberately not called. Signed-out short-circuits
      // BEFORE the ok/fail branch (see updateFeedPushFailedFlag), so
      // cloudSave and cloudFeedback racing each other here is harmless —
      // both are no-ops on the flag either way; only the timing flush (see
      // the test above) matters.
      fetchMock.mockImplementation(async () => jsonResponse({ error: "unauthenticated" }, 401));
      useFeedStore.getState().savePaper(flagPaper);
      await vi.waitFor(() => {
        expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(useFeedSyncStatus.getState().pendingKeys).toEqual({});
      expect(useFeedSyncStatus.getState().pushFailed).toBe(false);
      // Round 2: a signed-out write must never even create an owner
      // namespace in the persisted record (there is no owner to key it by).
      expect(useFeedStore.getState().pendingPushByOwner).toEqual({});
    });

    it("a signed-out write's success never clears a previously-set flag either", async () => {
      useFeedSyncStatus.setState({
        pendingKeys: { "saved:paper:paper-flag": true },
        pushFailed: true,
      });
      fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
      useFeedStore.getState().savePaper(flagPaper);
      await vi.waitFor(() => {
        expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Unchanged — a signed-out write must never touch this flag either way.
      expect(useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-flag"]).toBe(
        true,
      );
      expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
    });

    // ROUND 2 (§1aq) — the two scenarios the FAILED_REVIEW reproduced BY
    // EXECUTION against the round-1 code
    // (docs/jev-abc/FEED-SYNC-FLAG-A-20260928T180309Z.md). Kept as permanent
    // regression tests, in the same shape A's temporary scenario file used.
    describe("S1/S2 regressions (§1aq) — an unrelated success must never erase a real, still-unsynced failure", () => {
      it("S1 — a DIFFERENT item's successful markRead never clears THIS item's still-unsynced failed save", async () => {
        signIn();
        fetchMock.mockImplementation((input: string | URL | Request) => {
          const path = requestPath(input);
          if (path === "/api/saved") {
            return Promise.resolve(jsonResponse({ error: "boom" }, 500));
          }
          if (path === "/api/read") return Promise.resolve(jsonResponse({ ok: true }));
          return new Promise<Response>(() => {}); // hang /api/feedback — isolates cloudSave
        });

        useFeedStore.getState().savePaper(flagPaper); // X's cloudSave fails
        await vi.waitFor(() => {
          expect(
            useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-flag"],
          ).toBe(true);
        });
        expect(useFeedSyncStatus.getState().pushFailed).toBe(true);

        useFeedStore.getState().markRead("paper-flag-other"); // Y — unrelated, succeeds
        await vi.waitFor(() => {
          expect(
            fetchMock.mock.calls.some((c) => requestPath(c[0] as string) === "/api/read"),
          ).toBe(true);
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        // The core S1 claim: X's real, still-unsynced failure is still visible.
        expect(
          useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-flag"],
        ).toBe(true);
        expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
        // And Y's own successful read was never pending in the first place.
        expect(
          useFeedSyncStatus.getState().pendingKeys["read:paper-flag-other"],
        ).toBeUndefined();
      });

      it("S2 — the SAME savePaper call's own concurrent cloudFeedback success never clears its own cloudSave failure", async () => {
        signIn();
        fetchMock.mockImplementation((input: string | URL | Request) => {
          const path = requestPath(input);
          if (path === "/api/saved") {
            return Promise.resolve(jsonResponse({ error: "boom" }, 500));
          }
          if (path === "/api/feedback") return Promise.resolve(jsonResponse({ ok: true }));
          return new Promise<Response>(() => {});
        });

        useFeedStore.getState().savePaper(flagPaper); // fires cloudSave (fails) + cloudFeedback (succeeds)
        await vi.waitFor(() => {
          expect(
            fetchMock.mock.calls.some((c) => requestPath(c[0] as string) === "/api/feedback"),
          ).toBe(true);
        });
        await vi.waitFor(() => {
          expect(
            fetchMock.mock.calls.some((c) => requestPath(c[0] as string) === "/api/saved"),
          ).toBe(true);
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Exactly the save's own key remains — the feedback key, having
        // succeeded, was never added (or was added and cleared) either way.
        expect(useFeedSyncStatus.getState().pendingKeys).toEqual({
          "saved:paper:paper-flag": true,
        });
        expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
      });
    });

    describe("same-item / per-dimension isolation (§1aq point 1)", () => {
      it("a failed save followed by a successful unsave of the SAME item is consistent — the account's last-known state is honestly reflected", async () => {
        signIn();
        fetchMock.mockImplementation((input: string | URL | Request) => {
          const path = requestPath(input);
          if (path === "/api/saved") {
            return Promise.resolve(jsonResponse({ error: "boom" }, 500));
          }
          return new Promise<Response>(() => {}); // hang feedback
        });
        useFeedStore.getState().savePaper(flagPaper);
        await vi.waitFor(() => {
          expect(
            useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-flag"],
          ).toBe(true);
        });

        fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
        useFeedStore.getState().unsavePaper(flagPaper.id);
        await vi.waitFor(() => {
          expect(useFeedSyncStatus.getState().pushFailed).toBe(false);
        });
        expect(useFeedSyncStatus.getState().pendingKeys).toEqual({});
      });

      it("the SAME item's failed save and failed read are tracked, and cleared, independently", async () => {
        signIn();
        fetchMock.mockImplementation((input: string | URL | Request) => {
          const path = requestPath(input);
          if (path === "/api/saved" || path === "/api/read") {
            return Promise.resolve(jsonResponse({ error: "boom" }, 500));
          }
          return new Promise<Response>(() => {}); // hang feedback
        });
        useFeedStore.getState().savePaper(flagPaper);
        useFeedStore.getState().markRead(flagPaper.id);
        await vi.waitFor(() => {
          expect(useFeedSyncStatus.getState().pendingKeys).toMatchObject({
            "saved:paper:paper-flag": true,
            "read:paper-flag": true,
          });
        });

        // Only the read now succeeds.
        fetchMock.mockImplementation((input: string | URL | Request) => {
          const path = requestPath(input);
          if (path === "/api/read") return Promise.resolve(jsonResponse({ ok: true }));
          return new Promise<Response>(() => {});
        });
        useFeedStore.getState().markRead(flagPaper.id);
        await vi.waitFor(() => {
          expect(
            useFeedSyncStatus.getState().pendingKeys["read:paper-flag"],
          ).toBeUndefined();
        });
        // The save's own failure, on the SAME item, is untouched.
        expect(
          useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-flag"],
        ).toBe(true);
        expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
      });
    });

    // ROUND 2 (§1aq point 2, "reload honesty") — pendingPushByOwner is this
    // device's persisted mirror of the in-memory set above (see its doc
    // comment on FeedState for the file:line evidence that a reload does
    // NOT always retry a failed write). Tested directly against the store,
    // the same boundary feed-sync.tsx's own SSR-only test file already
    // documents as this repo's limit for anything living inside a
    // useEffect (web/src/components/feed-sync.test.tsx's header note: no
    // @testing-library/react, no test mounts a live effect) — the seeding
    // call itself (`onSession` → `replaceFeedPendingKeys`) is a 3-line thin
    // wrapper around the same store state proven here, exactly like
    // hydrateFromRemote's own wiring into onSession is untested at that
    // layer for the identical, pre-existing reason.
    describe("pendingPushByOwner — persisted, per owner (§1aq point 2)", () => {
      it("mirrors a failed write into pendingPushByOwner, keyed by the signed-in owner, and a matching success clears it there too", async () => {
        signIn(); // authUserId: "user-flag"
        fetchMock.mockImplementation((input: string | URL | Request) => {
          const path = requestPath(input);
          if (path === "/api/saved") {
            return Promise.resolve(jsonResponse({ error: "boom" }, 500));
          }
          return new Promise<Response>(() => {});
        });
        useFeedStore.getState().savePaper(flagPaper);
        await vi.waitFor(() => {
          expect(useFeedStore.getState().pendingPushByOwner["user-flag"]).toEqual({
            "saved:paper:paper-flag": true,
          });
        });

        fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
        useFeedStore.getState().unsavePaper(flagPaper.id);
        await vi.waitFor(() => {
          expect(useFeedStore.getState().pendingPushByOwner["user-flag"]).toEqual({});
        });
      });

      it("never leaks one owner's pending record into a different owner's", async () => {
        useSyncGate.setState({
          settled: true,
          authUserId: "user-a",
          authOutcome: "signed-in",
        });
        fetchMock.mockImplementation((input: string | URL | Request) => {
          const path = requestPath(input);
          if (path === "/api/saved") {
            return Promise.resolve(jsonResponse({ error: "boom" }, 500));
          }
          return new Promise<Response>(() => {});
        });
        useFeedStore.getState().savePaper(flagPaper);
        await vi.waitFor(() => {
          expect(useFeedStore.getState().pendingPushByOwner["user-a"]).toEqual({
            "saved:paper:paper-flag": true,
          });
        });

        // A different owner is now current on this device. Their own record
        // — which does not exist yet — must read as empty, never user-a's.
        useSyncGate.setState({
          settled: true,
          authUserId: "user-b",
          authOutcome: "signed-in",
        });
        expect(useFeedStore.getState().pendingPushByOwner["user-b"]).toBeUndefined();

        // And user-b's own failed write must never touch user-a's record.
        fetchMock.mockImplementation(async () => jsonResponse({ error: "boom" }, 500));
        useFeedStore.getState().markRead("paper-owner-b");
        await vi.waitFor(() => {
          expect(useFeedStore.getState().pendingPushByOwner["user-b"]).toEqual({
            "read:paper-owner-b": true,
          });
        });
        expect(useFeedStore.getState().pendingPushByOwner["user-a"]).toEqual({
          "saved:paper:paper-flag": true,
        });
      });

      it("is included in the persisted (partialize) snapshot", () => {
        useFeedStore.setState({
          pendingPushByOwner: {
            "user-flag": { "saved:paper:paper-flag": true },
          },
        });
        expect(persistenceCapture.partialize).toBeTypeOf("function");
        const persisted = persistenceCapture.partialize?.(useFeedStore.getState());
        expect(persisted).toMatchObject({
          pendingPushByOwner: { "user-flag": { "saved:paper:paper-flag": true } },
        });
      });

      it("resetLocal clears the LEAVING owner's own entry and the in-memory flag, but never a different owner's", () => {
        useFeedStore.setState({
          syncedUserId: "user-a",
          pendingPushByOwner: {
            "user-a": { "saved:paper:paper-flag": true },
            "user-b": { "read:paper-b": true },
          },
        });
        useFeedSyncStatus.setState({
          pendingKeys: { "saved:paper:paper-flag": true },
          pushFailed: true,
        });

        useFeedStore.getState().resetLocal();

        expect(useFeedStore.getState().pendingPushByOwner).toEqual({
          "user-a": {},
          "user-b": { "read:paper-b": true },
        });
        expect(useFeedSyncStatus.getState().pendingKeys).toEqual({});
        expect(useFeedSyncStatus.getState().pushFailed).toBe(false);
      });

      it("resetLocal is a no-op on pendingPushByOwner when nobody was synced (signed-out reload)", () => {
        useFeedStore.setState({
          syncedUserId: null,
          pendingPushByOwner: { "user-a": { "read:paper-b": true } },
        });

        useFeedStore.getState().resetLocal();

        // No owner WAS synced, so there is no "leaving owner" entry to
        // clear — a different owner's own record (from a previous session
        // on this device) is left exactly as is.
        expect(useFeedStore.getState().pendingPushByOwner).toEqual({
          "user-a": { "read:paper-b": true },
        });
      });
    });

    describe("applyMigrationPushResult (§1aq point 1, last sentence — CORRECTED, see §1aq CORRECTION)", () => {
      const nothingPushed = {
        savedPapers: [] as { id: string }[],
        savedEvents: [] as { id: string }[],
        savedJobs: [] as { id: string }[],
        readIds: [] as string[],
      };

      // §1aq CORRECTION (manager, after reviewing this file's own RELOAD
      // HONESTY finding) — round 1 of this ruling said a fully successful
      // batch clears the WHOLE pending record ("it pushed everything").
      // That premise was wrong: the batch only re-POSTs items CURRENTLY
      // PRESENT locally, never a delete, never feedback. This test —
      // REWRITTEN, not deleted, per the brief — now proves the corrected
      // behaviour directly: only the keys for items the batch actually
      // re-pushed (`pushed`, below) are cleared; a pending unsave (item
      // absent locally) and a feedback key (never pushed by this batch at
      // all) both survive.
      it("a fully successful batch clears ONLY the keys it actually re-pushed, plus the coarse key — an unsave-pending key and a feedback key both survive", () => {
        useFeedStore.setState({
          pendingPushByOwner: {
            "user-flag": {
              "saved:paper:paper-pushed": true, // still saved locally — this batch re-POSTed it
              "saved:paper:paper-unsaved": true, // absent locally (unsave-pending) — never re-pushed
              "feedback:paper:paper-flag": true, // batch never touches feedback at all
              migration: true,
            },
          },
        });
        useFeedSyncStatus.setState({
          pendingKeys: {
            "saved:paper:paper-pushed": true,
            "saved:paper:paper-unsaved": true,
            "feedback:paper:paper-flag": true,
            migration: true,
          },
          pushFailed: true,
        });

        useFeedStore.getState().applyMigrationPushResult(
          "user-flag",
          { ...nothingPushed, savedPapers: [{ id: "paper-pushed" }] },
          true,
        );

        const survivors = {
          "saved:paper:paper-unsaved": true,
          "feedback:paper:paper-flag": true,
        };
        expect(useFeedStore.getState().pendingPushByOwner["user-flag"]).toEqual(
          survivors,
        );
        expect(useFeedSyncStatus.getState().pendingKeys).toEqual(survivors);
        expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
      });

      it("a batch with any failure adds one coarse key, without touching an existing unrelated pending key", () => {
        useFeedStore.setState({
          pendingPushByOwner: {
            "user-flag": { "feedback:paper:paper-flag": true },
          },
        });
        useFeedSyncStatus.setState({
          pendingKeys: { "feedback:paper:paper-flag": true },
          pushFailed: true,
        });

        useFeedStore.getState().applyMigrationPushResult("user-flag", nothingPushed, false);

        expect(useFeedStore.getState().pendingPushByOwner["user-flag"]).toEqual({
          "feedback:paper:paper-flag": true,
          migration: true,
        });
        expect(useFeedSyncStatus.getState().pendingKeys).toEqual({
          "feedback:paper:paper-flag": true,
          migration: true,
        });
        expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
      });

      it("a fully successful batch for one owner never touches a different owner's record", () => {
        useFeedStore.setState({
          pendingPushByOwner: {
            "user-a": { "saved:paper:paper-a": true },
            "user-b": { "read:paper-b": true },
          },
        });

        useFeedStore.getState().applyMigrationPushResult(
          "user-a",
          { ...nothingPushed, savedPapers: [{ id: "paper-a" }] },
          true,
        );

        expect(useFeedStore.getState().pendingPushByOwner).toEqual({
          "user-a": {},
          "user-b": { "read:paper-b": true },
        });
      });
    });

    // §1aq CORRECTION — the manager's own three named scenarios, each
    // combining a REAL failure (mocked fetch, the actual store action) with
    // a direct call to `applyMigrationPushResult` to simulate "a fully
    // successful migration batch just ran" (FeedSync's own onSession is
    // untestable at this layer — see the pendingPushByOwner describe's own
    // header note).
    describe("S3/S4/S5 (§1aq CORRECTION) — a fully successful batch must not clear a key it never actually re-pushed", () => {
      it("S3 — a failed cloudFeedback for Z survives a fully successful batch (the batch never touches feedback)", async () => {
        signIn();
        fetchMock.mockImplementation(async () => jsonResponse({ error: "boom" }, 500));
        useFeedStore.getState().moreLikePaper(flagPaper); // Z = flagPaper; cloudFeedback fails
        await vi.waitFor(() => {
          expect(
            useFeedSyncStatus.getState().pendingKeys["feedback:paper:paper-flag"],
          ).toBe(true);
        });

        useFeedStore.getState().applyMigrationPushResult(
          "user-flag",
          { savedPapers: [], savedEvents: [], savedJobs: [], readIds: [] },
          true,
        );

        expect(
          useFeedSyncStatus.getState().pendingKeys["feedback:paper:paper-flag"],
        ).toBe(true);
        expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
      });

      it("S4 — a failed cloudUnsave for X survives a fully successful batch (X is absent locally, so the batch never re-pushes a delete for it)", async () => {
        signIn();
        fetchMock.mockImplementation(async () => jsonResponse({ error: "boom" }, 500));
        useFeedStore.getState().unsavePaper(flagPaper.id); // X — already removed locally; cloudUnsave fails
        await vi.waitFor(() => {
          expect(
            useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-flag"],
          ).toBe(true);
        });

        // X is NOT in savedPapers (it was unsaved locally already), so a
        // real batch could not possibly have re-pushed it either.
        useFeedStore.getState().applyMigrationPushResult(
          "user-flag",
          { savedPapers: [], savedEvents: [], savedJobs: [], readIds: [] },
          true,
        );

        expect(
          useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-flag"],
        ).toBe(true);
        expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
      });

      it("S5 — a failed cloudSave for X IS cleared by a fully successful batch that re-pushed X (X is still saved locally)", async () => {
        signIn();
        fetchMock.mockImplementation((input: string | URL | Request) => {
          const path = requestPath(input);
          if (path === "/api/saved") {
            return Promise.resolve(jsonResponse({ error: "boom" }, 500));
          }
          return new Promise<Response>(() => {}); // hang feedback — isolates cloudSave
        });
        useFeedStore.getState().savePaper(flagPaper); // X — still saved locally; cloudSave fails
        await vi.waitFor(() => {
          expect(
            useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-flag"],
          ).toBe(true);
        });

        // X IS in savedPapers, so the batch DID re-push it.
        useFeedStore.getState().applyMigrationPushResult(
          "user-flag",
          { savedPapers: [flagPaper], savedEvents: [], savedJobs: [], readIds: [] },
          true,
        );

        expect(
          useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-flag"],
        ).toBeUndefined();
        // Nothing else was ever added (cloudFeedback is still hung, never
        // settled) — pushFailed goes all the way back to false.
        expect(useFeedSyncStatus.getState().pendingKeys).toEqual({});
        expect(useFeedSyncStatus.getState().pushFailed).toBe(false);
      });
    });

    // OUTBOX-RETRY (ABC-JEV-INTEGRATION.md §1bc; guide
    // docs/jev-abc/OUTBOX-RETRY-B-20260929T125345Z.md) — closes the gap the
    // §1aq CORRECTION named: a reload's migration batch only ever re-POSTs
    // items CURRENTLY present locally, so a pending unsave/mark-unread/
    // feedback write is never retried by anything else. These tests call
    // `retryPendingPushes()` directly on the store, the same pattern this
    // file already uses for `applyMigrationPushResult` — `feed-sync.tsx`'s
    // own one-line wiring into `onSession` is untestable at this layer for
    // the pre-existing reason the `pendingPushByOwner` describe block above
    // already documents (no @testing-library/react, no test mounts a live
    // effect).
    describe("retryPendingPushes (OUTBOX-RETRY)", () => {
      it("a failed unsave retried clears its key (item absent locally → DELETE)", async () => {
        signIn();
        useFeedStore.setState({
          pendingPushByOwner: { "user-flag": { "saved:paper:paper-flag": true } },
        });
        useFeedSyncStatus.setState({
          pendingKeys: { "saved:paper:paper-flag": true },
          pushFailed: true,
        });
        fetchMock.mockImplementation((input: string | URL | Request) => {
          const path = requestPath(input);
          if (path.startsWith("/api/saved")) {
            return Promise.resolve(jsonResponse({ ok: true }));
          }
          return new Promise<Response>(() => {});
        });

        await useFeedStore.getState().retryPendingPushes();

        const call = fetchMock.mock.calls.find((c) =>
          requestPath(c[0] as string).startsWith("/api/saved"),
        );
        expect(call).toBeDefined();
        expect((call![1] as RequestInit | undefined)?.method).toBe("DELETE");
        expect(useFeedStore.getState().pendingPushByOwner["user-flag"]).toEqual({});
        expect(
          useFeedSyncStatus.getState().pendingKeys["saved:paper:paper-flag"],
        ).toBeUndefined();
        expect(useFeedSyncStatus.getState().pushFailed).toBe(false);
      });

      // Mirror of the test above: same pending key, but the item IS
      // currently saved (re-saved after the original unsave failed) — a
      // POST fires instead, never a DELETE. Direction comes from current
      // state alone, so these two tests together prove it is symmetric.
      it("a newer local save supersedes a pending unsave (item present locally → POST, not DELETE)", async () => {
        signIn();
        useFeedStore.setState({
          savedPapers: [flagPaper],
          pendingPushByOwner: { "user-flag": { "saved:paper:paper-flag": true } },
        });
        useFeedSyncStatus.setState({
          pendingKeys: { "saved:paper:paper-flag": true },
          pushFailed: true,
        });
        fetchMock.mockImplementation((input: string | URL | Request) => {
          const path = requestPath(input);
          if (path === "/api/saved") return Promise.resolve(jsonResponse({ ok: true }));
          return new Promise<Response>(() => {});
        });

        await useFeedStore.getState().retryPendingPushes();

        const call = fetchMock.mock.calls.find(
          (c) => requestPath(c[0] as string) === "/api/saved",
        );
        expect(call).toBeDefined();
        expect((call![1] as RequestInit | undefined)?.method).toBe("POST");
        expect(
          fetchMock.mock.calls.some(
            (c) => (c[1] as RequestInit | undefined)?.method === "DELETE",
          ),
        ).toBe(false);
        expect(useFeedStore.getState().pendingPushByOwner["user-flag"]).toEqual({});
      });

      it("feedback retry sends the CURRENT value, not whatever originally failed", async () => {
        signIn();
        useFeedStore.setState({
          paperFeedback: { "paper-flag": "moreLikeThis" },
          pendingPushByOwner: { "user-flag": { "feedback:paper:paper-flag": true } },
        });
        useFeedSyncStatus.setState({
          pendingKeys: { "feedback:paper:paper-flag": true },
          pushFailed: true,
        });
        fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));

        await useFeedStore.getState().retryPendingPushes();

        const call = fetchMock.mock.calls.find(
          (c) => requestPath(c[0] as string) === "/api/feedback",
        );
        expect(call).toBeDefined();
        const body = JSON.parse(String((call![1] as RequestInit).body));
        expect(body.feedback).toBe("moreLikeThis");
        expect(useFeedStore.getState().pendingPushByOwner["user-flag"]).toEqual({});
      });

      it("never touches a different owner's pending keys (owner isolation)", async () => {
        useSyncGate.setState({
          settled: true,
          authUserId: "user-a",
          authOutcome: "signed-in",
        });
        useFeedStore.setState({
          readItems: { "paper-a": true },
          pendingPushByOwner: {
            "user-a": { "read:paper-a": true },
            "user-b": { "read:paper-b": true },
          },
        });
        useFeedSyncStatus.setState({
          pendingKeys: { "read:paper-a": true },
          pushFailed: true,
        });
        const ownerBBefore = useFeedStore.getState().pendingPushByOwner["user-b"];
        fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));

        await useFeedStore.getState().retryPendingPushes();

        expect(useFeedStore.getState().pendingPushByOwner["user-a"]).toEqual({});
        // Reference equality, not just deep equality — proves owner b's
        // entry was never read into a new object, i.e. never touched.
        expect(useFeedStore.getState().pendingPushByOwner["user-b"]).toBe(ownerBBefore);
        expect(fetchMock.mock.calls.length).toBe(1);
      });

      it("does nothing when signed out", async () => {
        // authUserId defaults to null after the outer beforeEach.
        useFeedStore.setState({
          pendingPushByOwner: { "user-flag": { "read:paper-flag": true } },
        });
        useFeedSyncStatus.setState({
          pendingKeys: { "read:paper-flag": true },
          pushFailed: true,
        });
        fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));

        await useFeedStore.getState().retryPendingPushes();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(useFeedStore.getState().pendingPushByOwner["user-flag"]).toEqual({
          "read:paper-flag": true,
        });
        expect(useFeedSyncStatus.getState().pendingKeys).toEqual({
          "read:paper-flag": true,
        });
      });

      it("a moot feedback key (current value now undefined) is dropped, not resent", async () => {
        signIn();
        fetchMock.mockImplementation((input: string | URL | Request) => {
          const path = requestPath(input);
          if (path === "/api/saved") return Promise.resolve(jsonResponse({ ok: true }));
          if (path === "/api/feedback") {
            return Promise.resolve(jsonResponse({ error: "boom" }, 500));
          }
          return new Promise<Response>(() => {});
        });

        // Real actions, not a hand-set fixture — exercises unsavePaper's
        // actual paperFeedback[id] === "saved" deletion path (L2308-2310).
        useFeedStore.getState().savePaper(flagPaper);
        await vi.waitFor(() => {
          expect(
            useFeedSyncStatus.getState().pendingKeys["feedback:paper:paper-flag"],
          ).toBe(true);
        });
        expect(
          useFeedStore.getState().pendingFeedbackPayloadByOwner["user-flag"]?.[
            "feedback:paper:paper-flag"
          ],
        ).toBeDefined();

        useFeedStore.getState().unsavePaper(flagPaper.id);
        await vi.waitFor(() => {
          expect(
            fetchMock.mock.calls.some(
              (c) =>
                requestPath(c[0] as string).startsWith("/api/saved") &&
                (c[1] as RequestInit | undefined)?.method === "DELETE",
            ),
          ).toBe(true);
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(useFeedStore.getState().paperFeedback["paper-flag"]).toBeUndefined();

        const feedbackCallsBefore = fetchMock.mock.calls.filter(
          (c) => requestPath(c[0] as string) === "/api/feedback",
        ).length;

        await useFeedStore.getState().retryPendingPushes();

        const feedbackCallsAfter = fetchMock.mock.calls.filter(
          (c) => requestPath(c[0] as string) === "/api/feedback",
        ).length;
        expect(feedbackCallsAfter).toBe(feedbackCallsBefore);
        expect(
          useFeedStore.getState().pendingPushByOwner["user-flag"]?.[
            "feedback:paper:paper-flag"
          ],
        ).toBeUndefined();
        expect(
          useFeedSyncStatus.getState().pendingKeys["feedback:paper:paper-flag"],
        ).toBeUndefined();
        expect(
          useFeedStore.getState().pendingFeedbackPayloadByOwner["user-flag"]?.[
            "feedback:paper:paper-flag"
          ],
        ).toBeUndefined();
      });

      it("a colon-in-id key round-trips the FULL id, not a truncated substring", async () => {
        signIn();
        const idWithColon = "openalex:W2005027801";
        useFeedStore.setState({
          pendingPushByOwner: {
            "user-flag": { [`saved:paper:${idWithColon}`]: true },
          },
        });
        useFeedSyncStatus.setState({
          pendingKeys: { [`saved:paper:${idWithColon}`]: true },
          pushFailed: true,
        });
        fetchMock.mockImplementation((input: string | URL | Request) => {
          const path = requestPath(input);
          if (path.startsWith("/api/saved")) {
            return Promise.resolve(jsonResponse({ ok: true }));
          }
          return new Promise<Response>(() => {});
        });

        await useFeedStore.getState().retryPendingPushes();

        const call = fetchMock.mock.calls.find((c) =>
          requestPath(c[0] as string).startsWith("/api/saved"),
        );
        expect(call).toBeDefined();
        expect((call![1] as RequestInit | undefined)?.method).toBe("DELETE");
        const url = new URL(call![0] as string, "http://localhost");
        expect(url.searchParams.get("itemId")).toBe(idWithColon);
        expect(useFeedStore.getState().pendingPushByOwner["user-flag"]).toEqual({});
      });

      it("read direction flip: currently read → POST, not DELETE", async () => {
        signIn();
        useFeedStore.setState({
          readItems: { "paper-read-flip": true },
          pendingPushByOwner: { "user-flag": { "read:paper-read-flip": true } },
        });
        useFeedSyncStatus.setState({
          pendingKeys: { "read:paper-read-flip": true },
          pushFailed: true,
        });
        fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));

        await useFeedStore.getState().retryPendingPushes();

        const call = fetchMock.mock.calls.find(
          (c) => requestPath(c[0] as string) === "/api/read",
        );
        expect(call).toBeDefined();
        expect((call![1] as RequestInit | undefined)?.method).toBe("POST");
        expect(useFeedStore.getState().pendingPushByOwner["user-flag"]).toEqual({});
      });

      it("a captured feedback payload survives and is resent, even after the source item is gone from every pool", async () => {
        signIn();
        fetchMock.mockImplementation(async () => jsonResponse({ error: "boom" }, 500));

        // flagPaper is never added to `papers`/`savedPapers` — moreLikePaper
        // only needs the object passed in, so this already models "an item
        // that was never saved", exactly the case §2.3 says recomputation
        // cannot cover (its pool is not persisted).
        useFeedStore.getState().moreLikePaper(flagPaper);
        await vi.waitFor(() => {
          expect(
            useFeedSyncStatus.getState().pendingKeys["feedback:paper:paper-flag"],
          ).toBe(true);
        });
        const captured =
          useFeedStore.getState().pendingFeedbackPayloadByOwner["user-flag"]?.[
            "feedback:paper:paper-flag"
          ];
        expect(captured).toMatchObject({ title: flagPaper.title });
        expect(
          useFeedStore.getState().papers.some((p) => p.id === flagPaper.id),
        ).toBe(false);
        expect(
          useFeedStore.getState().savedPapers.some((p) => p.id === flagPaper.id),
        ).toBe(false);

        fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
        await useFeedStore.getState().retryPendingPushes();

        const retryCall = fetchMock.mock.calls
          .filter((c) => requestPath(c[0] as string) === "/api/feedback")
          .pop();
        expect(retryCall).toBeDefined();
        const body = JSON.parse(String((retryCall![1] as RequestInit).body));
        expect(body.payload).toEqual(captured);
        expect(body.payload.title).toBe(flagPaper.title);
      });

      it("the coarse migration key is left alone — never parsed, never retried", async () => {
        signIn();
        useFeedStore.setState({
          pendingPushByOwner: { "user-flag": { migration: true } },
        });
        useFeedSyncStatus.setState({ pendingKeys: { migration: true }, pushFailed: true });
        fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));

        await useFeedStore.getState().retryPendingPushes();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(useFeedStore.getState().pendingPushByOwner["user-flag"]).toEqual({
          migration: true,
        });
      });

      it("resetLocal clears the LEAVING owner's own pendingFeedbackPayloadByOwner entry, but never a different owner's", () => {
        useFeedStore.setState({
          syncedUserId: "user-a",
          pendingFeedbackPayloadByOwner: {
            "user-a": { "feedback:paper:paper-a": { title: "A", concepts: [] } },
            "user-b": { "feedback:paper:paper-b": { title: "B", concepts: [] } },
          },
        });

        useFeedStore.getState().resetLocal();

        expect(useFeedStore.getState().pendingFeedbackPayloadByOwner).toEqual({
          "user-a": {},
          "user-b": { "feedback:paper:paper-b": { title: "B", concepts: [] } },
        });
      });

      it("a PERMANENT 4xx (400, malformed body) on a feedback write drops the key and its payload — never resent (§1bc point 3)", async () => {
        signIn();
        useFeedStore.setState({
          paperFeedback: { "paper-flag": "moreLikeThis" },
          pendingPushByOwner: { "user-flag": { "feedback:paper:paper-flag": true } },
          pendingFeedbackPayloadByOwner: {
            "user-flag": {
              "feedback:paper:paper-flag": { title: "Flag paper", concepts: [] },
            },
          },
        });
        useFeedSyncStatus.setState({
          pendingKeys: { "feedback:paper:paper-flag": true },
          pushFailed: true,
        });
        fetchMock.mockImplementation(async () =>
          jsonResponse({ error: "invalid body" }, 400),
        );

        await useFeedStore.getState().retryPendingPushes();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(useFeedStore.getState().pendingPushByOwner["user-flag"]).toEqual({});
        expect(
          useFeedSyncStatus.getState().pendingKeys["feedback:paper:paper-flag"],
        ).toBeUndefined();
        expect(useFeedSyncStatus.getState().pushFailed).toBe(false);
        expect(
          useFeedStore.getState().pendingFeedbackPayloadByOwner["user-flag"],
        ).toEqual({});
      });

      // §1bc AMENDMENT (fresh A's HIGH finding) — a 401 is TRANSIENT (the
      // same file's acknowledgePendingBatch already treats it as "retry
      // once signed in"), unlike a genuinely malformed 400 body. It must
      // keep the key and its captured payload, not drop them.
      it("a TRANSIENT 401 on a feedback write keeps the key and its payload — retried later, never dropped", async () => {
        signIn();
        useFeedStore.setState({
          paperFeedback: { "paper-flag": "moreLikeThis" },
          pendingPushByOwner: { "user-flag": { "feedback:paper:paper-flag": true } },
          pendingFeedbackPayloadByOwner: {
            "user-flag": {
              "feedback:paper:paper-flag": { title: "Flag paper", concepts: [] },
            },
          },
        });
        useFeedSyncStatus.setState({
          pendingKeys: { "feedback:paper:paper-flag": true },
          pushFailed: true,
        });
        fetchMock.mockImplementation(async () =>
          jsonResponse({ error: "unauthenticated" }, 401),
        );

        await useFeedStore.getState().retryPendingPushes();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(useFeedStore.getState().pendingPushByOwner["user-flag"]).toEqual({
          "feedback:paper:paper-flag": true,
        });
        expect(
          useFeedSyncStatus.getState().pendingKeys["feedback:paper:paper-flag"],
        ).toBe(true);
        expect(useFeedSyncStatus.getState().pushFailed).toBe(true);
        expect(
          useFeedStore.getState().pendingFeedbackPayloadByOwner["user-flag"]?.[
            "feedback:paper:paper-flag"
          ],
        ).toEqual({ title: "Flag paper", concepts: [] });
      });

      it("a feedback retry with no captured payload sends without one — never reconstructed from current item data (§1bc AMENDMENT)", async () => {
        signIn();
        useFeedStore.setState({
          paperFeedback: { "paper-flag": "moreLikeThis" },
          // Deliberately present in savedPapers: if a recompute fallback
          // still existed, it would find this and build a real payload from
          // it. No pendingFeedbackPayloadByOwner entry is set for this key,
          // so a correct implementation must send `payload: undefined`
          // rather than reconstructing one from this item.
          savedPapers: [flagPaper],
          pendingPushByOwner: { "user-flag": { "feedback:paper:paper-flag": true } },
        });
        useFeedSyncStatus.setState({
          pendingKeys: { "feedback:paper:paper-flag": true },
          pushFailed: true,
        });
        fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));

        await useFeedStore.getState().retryPendingPushes();

        const call = fetchMock.mock.calls.find(
          (c) => requestPath(c[0] as string) === "/api/feedback",
        );
        expect(call).toBeDefined();
        const body = JSON.parse(String((call![1] as RequestInit).body));
        expect(body.payload).toBeUndefined();
        expect(useFeedStore.getState().pendingPushByOwner["user-flag"]).toEqual({});
      });

      // §1bc AMENDMENT (fresh A's HIGH finding) — resetLocal (fired by a
      // concurrent sign-out) is fully synchronous and can land BETWEEN two
      // keys in the same pass. The pass must stop immediately once it
      // detects this, never using the wiped state for a key it had not yet
      // started.
      it("a concurrent sign-out (resetLocal) mid-pass stops the pass immediately — no further cloud calls", async () => {
        signIn();
        useFeedStore.setState({
          syncedUserId: "user-flag",
          readItems: { "paper-1": true, "paper-2": true },
          pendingPushByOwner: {
            "user-flag": { "read:paper-1": true, "read:paper-2": true },
          },
        });
        useFeedSyncStatus.setState({
          pendingKeys: { "read:paper-1": true, "read:paper-2": true },
          pushFailed: true,
        });
        const firstResponse = deferred<Response>();
        fetchMock.mockImplementation((input: string | URL | Request) => {
          const path = requestPath(input);
          if (path === "/api/read") return firstResponse.promise;
          return new Promise<Response>(() => {});
        });

        const pass = useFeedStore.getState().retryPendingPushes();
        await vi.waitFor(() => {
          expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
        });

        // Simulate a concurrent SIGNED_OUT landing mid-pass: both stores
        // update, the same as the real onSession(null, true) path would
        // trigger (a separate ProfileSync-driven auth transition plus
        // FeedSync's own resetLocal, unrelated to this in-flight pass).
        useSyncGate.setState({
          settled: true,
          authUserId: null,
          authOutcome: "signed-out",
        });
        useFeedStore.getState().resetLocal();

        firstResponse.resolve(jsonResponse({ ok: true }));
        await pass;

        // Only the ALREADY-in-flight first call ever fired — the second
        // key's cloud call never happened.
        expect(fetchMock.mock.calls.length).toBe(1);
        const call = fetchMock.mock.calls[0]!;
        const body = JSON.parse(String((call[1] as RequestInit).body));
        expect(body.itemId).toBe("paper-1");
      });

      // POLICY 4 — required. Mirrors pendingAckInFlight's own existing
      // guard idiom (see acknowledgePendingBatch's tests elsewhere in this
      // file for the same deferred-response shape).
      it("two overlapping retryPendingPushes() calls fire exactly one request per pending key", async () => {
        signIn();
        useFeedStore.setState({
          readItems: { "paper-concurrent": true },
          pendingPushByOwner: { "user-flag": { "read:paper-concurrent": true } },
        });
        useFeedSyncStatus.setState({
          pendingKeys: { "read:paper-concurrent": true },
          pushFailed: true,
        });
        const readResponse = deferred<Response>();
        fetchMock.mockImplementation((input: string | URL | Request) => {
          const path = requestPath(input);
          if (path === "/api/read") return readResponse.promise;
          return new Promise<Response>(() => {});
        });

        const first = useFeedStore.getState().retryPendingPushes();
        const second = useFeedStore.getState().retryPendingPushes();
        await new Promise((resolve) => setTimeout(resolve, 0));
        readResponse.resolve(jsonResponse({ ok: true }));
        await Promise.all([first, second]);

        const readCalls = fetchMock.mock.calls.filter(
          (c) => requestPath(c[0] as string) === "/api/read",
        );
        expect(readCalls.length).toBe(1);
        expect(
          useFeedSyncStatus.getState().pendingKeys["read:paper-concurrent"],
        ).toBeUndefined();
      });
    });
  });

  // SIGNIN-MERGE (ABC-JEV-INTEGRATION.md §1af/§1aj, ruling P2/P3) — "saved
  // papers / reading history / feedback: always union, never replace —
  // mandatory" + "a failed or empty pull may never shrink local data."
  // Direct regression tests for §1.2/§1.3 of
  // docs/jev-abc/SIGNIN-MERGE-B-20260928T025444Z.md ("saved papers gone the
  // instant sign-in completes") — proven at the store boundary, where the
  // actual merge decision lives. `feed-sync.tsx` is a thin wrapper that now
  // passes a field through as `undefined` when ITS pull failed, rather than
  // coalescing to `[]` first (see that file's own comment) — these tests
  // exercise `hydrateFromRemote` directly with exactly the shapes it now
  // actually receives from both a failed and a successful-but-empty pull.
  describe("hydrateFromRemote — union, never replace (SIGNIN-MERGE §1aj P2/P3)", () => {
    const localOnlyPaper: Paper = {
      id: "paper-local-only",
      title: "A paper saved only on this device",
      authors: [],
      relevanceReason: "",
      venue: "Venue",
      source: "other",
      summaryIntro: "",
      summaryExperimentKeywords: [],
      summaryResultDiscussion: "",
      isSaved: true,
    };
    const accountPaper: Paper = {
      id: "paper-from-account",
      title: "A paper this account already had saved",
      authors: [],
      relevanceReason: "",
      venue: "Venue",
      source: "other",
      summaryIntro: "",
      summaryExperimentKeywords: [],
      summaryResultDiscussion: "",
      isSaved: true,
    };

    it("a locally-saved item survives a real pull that doesn't happen to include it (union, not replace)", () => {
      useFeedStore.setState({
        savedPapers: [localOnlyPaper],
        paperFeedback: { [localOnlyPaper.id]: "saved" },
      });
      useFeedStore.getState().hydrateFromRemote({ savedPapers: [accountPaper] });
      const ids = useFeedStore.getState().savedPapers.map((p) => p.id);
      expect(ids).toContain(localOnlyPaper.id);
      expect(ids).toContain(accountPaper.id);
      // The prune-on-unsave loop must not have deleted this local save's
      // feedback either — it is still genuinely saved on this device.
      expect(useFeedStore.getState().paperFeedback[localOnlyPaper.id]).toBe("saved");
    });

    it("saved papers survive sign-in when the pull fails (savedPapers left undefined, never coalesced to [])", () => {
      useFeedStore.setState({ savedPapers: [localOnlyPaper] });
      // A failed pull, exactly as feed-sync.tsx now passes it through: the
      // field is simply absent, never a bare `[]`.
      useFeedStore.getState().hydrateFromRemote({});
      // `syncSavedState` annotates every saved item with a computed
      // isSaved/feedback pair on the way out (existing, unrelated
      // behaviour) — what this test proves is survival, so it compares the
      // id and the source fields the fixture itself set, not the whole
      // object shape.
      expect(useFeedStore.getState().savedPapers).toMatchObject([
        { id: localOnlyPaper.id, title: localOnlyPaper.title },
      ]);
    });

    it("saved papers survive sign-in when the pull succeeds empty — a genuinely-empty account must not erase local either", () => {
      useFeedStore.setState({ savedPapers: [localOnlyPaper] });
      useFeedStore.getState().hydrateFromRemote({ savedPapers: [] });
      expect(useFeedStore.getState().savedPapers).toMatchObject([
        { id: localOnlyPaper.id, title: localOnlyPaper.title },
      ]);
    });

    it("readItems: a locally-read id survives when the pull fails (readItems left undefined)", () => {
      useFeedStore.setState({ readItems: { "paper-read-locally": true } });
      useFeedStore.getState().hydrateFromRemote({});
      expect(useFeedStore.getState().readItems).toEqual({ "paper-read-locally": true });
    });

    it("readItems: unions rather than replaces when the pull succeeds with a different set", () => {
      useFeedStore.setState({ readItems: { "paper-read-locally": true } });
      useFeedStore.getState().hydrateFromRemote({ readItems: { "paper-read-on-account": true } });
      expect(useFeedStore.getState().readItems).toEqual({
        "paper-read-locally": true,
        "paper-read-on-account": true,
      });
    });

    it("orders the account's own list first, then local-only additions", () => {
      useFeedStore.setState({ savedPapers: [localOnlyPaper] });
      useFeedStore.getState().hydrateFromRemote({ savedPapers: [accountPaper] });
      expect(useFeedStore.getState().savedPapers.map((p) => p.id)).toEqual([
        accountPaper.id,
        localOnlyPaper.id,
      ]);
    });

    it("keeps local's own copy of an item that exists on both sides, rather than the account's", () => {
      const localCopy: Paper = { ...accountPaper, title: "Locally edited title" };
      useFeedStore.setState({ savedPapers: [localCopy] });
      useFeedStore.getState().hydrateFromRemote({ savedPapers: [accountPaper] });
      expect(useFeedStore.getState().savedPapers).toMatchObject([
        { id: accountPaper.id, title: "Locally edited title" },
      ]);
    });
  });

  // P4-S5a (Round 3) — ABC-JEV-INTEGRATION.md §1p.C.7, F-A-P4-02/-05 client
  // half. The store's job here is narrow: notice a served/prepared batch and
  // remember (persistently) that this device owes it an acknowledgment. It
  // never POSTs /api/feed/ack itself from inside this commit — the binding
  // ruling requires the actual first-fire trigger to be a component effect
  // after mount, not a Zustand `set` updater (that's `useBatchAcknowledgement`,
  // tested separately in use-batch-acknowledgement.test.ts). What IS tested
  // headlessly here, exactly like every other loadFeed behavior in this file:
  // capturing batch meta, persisting/clearing pendingBatchAck correctly, and
  // loadFeed's own "retry a pending ack before starting a new load" step.
  describe("P4-S5a: batch meta capture and pendingBatchAck", () => {
    it("captures a served batch's id/status and sets a pending acknowledgment", async () => {
      enqueueResolved("/api/feed", {
        items: paperFeedResponse("paper-batched").items,
        meta: { batchId: "batch-1", batchStatus: "served" },
      });
      enqueueResolved("/api/events/feed", eventsFeedResponse());
      enqueueResolved("/api/jobs/feed", jobsFeedResponse());

      await useFeedStore.getState().loadFeed();

      const state = useFeedStore.getState();
      expect(state.batchId).toBe("batch-1");
      expect(state.batchStatus).toBe("served");
      expect(state.pendingBatchAck).toEqual({
        batchId: "batch-1",
        localDate: localCalendarDate(),
      });
      // P4-S5a-FIX (Round 3) — F-A-P4S5-01: renderedBatchId is set in the
      // SAME set() call as `papers`, atomically, every time.
      expect(state.renderedBatchId).toBe("batch-1");
    });

    it("also sets a pending acknowledgment for a 'prepared' batch (not yet observed as served)", async () => {
      enqueueResolved("/api/feed", {
        items: paperFeedResponse("paper-prepared").items,
        meta: { batchId: "batch-prepared", batchStatus: "prepared" },
      });
      enqueueResolved("/api/events/feed", eventsFeedResponse());
      enqueueResolved("/api/jobs/feed", jobsFeedResponse());

      await useFeedStore.getState().loadFeed();

      expect(useFeedStore.getState().pendingBatchAck).toEqual({
        batchId: "batch-prepared",
        localDate: localCalendarDate(),
      });
      // P4-S5a-FIX (Round 3) — F-A-P4S5-01.
      expect(useFeedStore.getState().renderedBatchId).toBe("batch-prepared");
    });

    it("reports batch meta but sets no pending acknowledgment for an already-acknowledged batch", async () => {
      enqueueResolved("/api/feed", {
        items: paperFeedResponse("paper-acked").items,
        meta: { batchId: "batch-2", batchStatus: "acknowledged" },
      });
      enqueueResolved("/api/events/feed", eventsFeedResponse());
      enqueueResolved("/api/jobs/feed", jobsFeedResponse());

      await useFeedStore.getState().loadFeed();

      const state = useFeedStore.getState();
      expect(state.batchId).toBe("batch-2");
      expect(state.batchStatus).toBe("acknowledged");
      expect(state.pendingBatchAck).toBeNull();
      // P4-S5a-FIX (Round 3) — F-A-P4S5-01: renderedBatchId tracks whatever
      // batch's papers are actually in `papers`, independent of ack status.
      expect(state.renderedBatchId).toBe("batch-2");
    });

    it("clears a stale pending acknowledgment once ITS OWN batch is reported acknowledged", async () => {
      useFeedStore.setState({
        pendingBatchAck: { batchId: "batch-3", localDate: "2026-09-01" },
        // P4-S5a-FIX (Round 3) — F-A-P4S5-01: batch-3 is genuinely the
        // batch this device last rendered (that's the whole scenario this
        // test means to describe — its ack merely failed before), so
        // renderedBatchId must say so too, or acknowledgePendingBatch's new
        // match gate would correctly refuse to even attempt the retry this
        // test's mocked /api/feed/ack response below is there to answer.
        renderedBatchId: "batch-3",
      });
      enqueueResolved("/api/feed/ack", { ok: true, alreadyAcknowledged: false });
      enqueueResolved("/api/feed", {
        items: paperFeedResponse("paper-now-acked").items,
        meta: { batchId: "batch-3", batchStatus: "acknowledged" },
      });
      enqueueResolved("/api/events/feed", eventsFeedResponse());
      enqueueResolved("/api/jobs/feed", jobsFeedResponse());

      await useFeedStore.getState().loadFeed();

      expect(useFeedStore.getState().pendingBatchAck).toBeNull();
    });

    it("leaves an unrelated pending acknowledgment alone when the response carries no batch at all", async () => {
      useFeedStore.setState({
        pendingBatchAck: { batchId: "still-pending", localDate: "2026-09-01" },
        // renderedBatchId starts null (see the shared beforeEach above) —
        // "still-pending" was never the batch behind whatever is currently
        // in `papers` at the start of this test, which is exactly the
        // F-A-P4S5-01 precondition below.
      });
      // Before P4-S5a-FIX, loadFeed's reconcile-before-load step called
      // acknowledgePendingBatch() unconditionally and WOULD have POSTed
      // "still-pending" here; this mock keeps that pre-fix path
      // deterministic (503 = kept pending) rather than depending on this
      // harness's "unmocked path rejects" fallback. After the fix, the new
      // match gate refuses to even attempt the call, so this response is
      // never consumed — see the explicit zero-calls assertion below, which
      // is what actually proves the fix (a same-shaped 503-driven "still
      // pending" outcome would look identical whether or not the POST was
      // ever attempted, unless something checks that directly).
      enqueue("/api/feed/ack").resolve(jsonResponse({ error: "ledger_unavailable" }, 503));
      enqueueResolved("/api/feed", paperFeedResponse("paper-no-batch")); // meta: {}
      enqueueResolved("/api/events/feed", eventsFeedResponse());
      enqueueResolved("/api/jobs/feed", jobsFeedResponse());

      await useFeedStore.getState().loadFeed();

      expect(useFeedStore.getState().batchId).toBeNull();
      expect(useFeedStore.getState().renderedBatchId).toBeNull();
      expect(useFeedStore.getState().pendingBatchAck).toEqual({
        batchId: "still-pending",
        localDate: "2026-09-01",
      });
      // P4-S5a-FIX (Round 3) — F-A-P4S5-01, the actual regression proof:
      // the unrelated batch's ack must never even be ATTEMPTED while its
      // cards are not what's rendered, not merely "still pending after a
      // failed attempt". RED before the fix (the reconcile step really did
      // POST "still-pending" and got the mocked 503 above); GREEN after
      // (the match gate refuses before any fetch happens at all).
      const ackCalls = fetchMock.mock.calls.filter(
        ([input]) => requestPath(input as string | URL | Request) === "/api/feed/ack",
      );
      expect(ackCalls).toHaveLength(0);

      // And the danger this whole slice exists to close: simulate the
      // hook's own mount-effect trigger firing right after this render
      // (what useBatchAcknowledgement does whenever cardsRendered/
      // pendingBatchAck change and the tab is visible) — it must ALSO
      // refuse, using the real store action, not a re-implementation.
      await useFeedStore.getState().acknowledgePendingBatch();
      const ackCallsAfterHookTrigger = fetchMock.mock.calls.filter(
        ([input]) => requestPath(input as string | URL | Request) === "/api/feed/ack",
      );
      expect(ackCallsAfterHookTrigger).toHaveLength(0);
      expect(useFeedStore.getState().pendingBatchAck).toEqual({
        batchId: "still-pending",
        localDate: "2026-09-01",
      });
    });

    it("retries a pending acknowledgment before issuing a new feed request", async () => {
      useFeedStore.setState({
        pendingBatchAck: { batchId: "retry-me", localDate: "2026-09-01" },
        // P4-S5a-FIX (Round 3) — F-A-P4S5-01: "retry-me" is genuinely the
        // batch this device last rendered (that is the premise of this
        // test — its ack merely failed before), so renderedBatchId must
        // agree, or acknowledgePendingBatch's new match gate would (rightly)
        // refuse to attempt the very retry this test exists to prove.
        renderedBatchId: "retry-me",
      });
      enqueueResolved("/api/feed/ack", { ok: true, alreadyAcknowledged: false });
      enqueueResolved("/api/feed", paperFeedResponse("paper-after-retry"));
      enqueueResolved("/api/events/feed", eventsFeedResponse());
      enqueueResolved("/api/jobs/feed", jobsFeedResponse());

      await useFeedStore.getState().loadFeed();

      const paths = fetchMock.mock.calls.map(([input]) =>
        requestPath(input as string | URL | Request),
      );
      const ackCallIndex = paths.indexOf("/api/feed/ack");
      const feedCallIndex = paths.indexOf("/api/feed");
      expect(ackCallIndex).toBeGreaterThanOrEqual(0);
      expect(feedCallIndex).toBeGreaterThan(ackCallIndex);
      expect(
        JSON.parse(String((fetchMock.mock.calls[ackCallIndex]?.[1] as RequestInit).body)),
      ).toEqual({ batchId: "retry-me" });
      expect(useFeedStore.getState().pendingBatchAck).toBeNull();
    });

    // P4-S5a-FIX (Round 3) — F-A-P4S5-01's positive counterpart: proves the
    // fix does not merely suppress every ack, only mismatched ones. Serves a
    // batch, lets it render (a real loadFeed), then simulates the hook's own
    // mount-effect trigger firing afterward (exactly what
    // useBatchAcknowledgement does once cardsRendered/pendingBatchAck are
    // set and the tab is visible) and checks exactly one POST goes out, for
    // the right batch.
    it("a matching batch rendered ⇒ exactly one acknowledgment POST, for that batch", async () => {
      enqueueResolved("/api/feed", {
        items: paperFeedResponse("paper-matching-batch").items,
        meta: { batchId: "batch-matching", batchStatus: "served" },
      });
      enqueueResolved("/api/events/feed", eventsFeedResponse());
      enqueueResolved("/api/jobs/feed", jobsFeedResponse());

      await useFeedStore.getState().loadFeed();

      expect(useFeedStore.getState().renderedBatchId).toBe("batch-matching");
      expect(useFeedStore.getState().pendingBatchAck).toEqual({
        batchId: "batch-matching",
        localDate: localCalendarDate(),
      });

      enqueueResolved("/api/feed/ack", { ok: true, alreadyAcknowledged: false });
      await useFeedStore.getState().acknowledgePendingBatch();

      const ackCalls = fetchMock.mock.calls.filter(
        ([input]) => requestPath(input as string | URL | Request) === "/api/feed/ack",
      );
      expect(ackCalls).toHaveLength(1);
      expect(JSON.parse(String((ackCalls[0]![1] as RequestInit).body))).toEqual({
        batchId: "batch-matching",
      });
      expect(useFeedStore.getState().pendingBatchAck).toBeNull();
    });

    // P4-S5a-FIX (Round 3) — F-A-P4S5-02 (LOW, availability-only, not a
    // false-delivery risk). DECISION: the smaller-safe-change branch offered
    // by this slice's brief — accept that an older still-outstanding pending
    // ack is replaced (not queued) when a new batch is served/prepared,
    // rather than widen pendingBatchAck into a bounded list. Justification:
    // server-side "served-but-unacknowledged" temporary exclusion
    // (ABC-JEV-INTEGRATION.md §1p.C.5) already prevents the only consequence
    // that would matter — the dropped batch's papers cannot be re-delivered
    // as if new, it just falls back from a permanent ledger delivery to a
    // temporary served-unacked one, an already-accepted cost. This test
    // documents that accepted, intentional behavior; the general "no POST on
    // a mismatch" tests elsewhere in this file already prove the dropped
    // record cannot cause a FALSE acknowledgment either.
    it("F-A-P4S5-02: a newer served batch's pending ack replaces an older still-outstanding one (accepted, documented gap)", async () => {
      useFeedStore.setState({
        pendingBatchAck: { batchId: "batch-A-older-still-pending", localDate: "2026-09-01" },
        renderedBatchId: "batch-A-older-still-pending",
      });
      // Batch A's own retry-before-load attempt keeps failing (e.g. an
      // outage spanning the day boundary) — it is genuinely STILL pending,
      // not resolved, when batch B's response arrives.
      enqueue("/api/feed/ack").resolve(jsonResponse({ error: "ledger_unavailable" }, 503));
      enqueueResolved("/api/feed", {
        items: paperFeedResponse("paper-batch-b").items,
        meta: { batchId: "batch-B-new", batchStatus: "served" },
      });
      enqueueResolved("/api/events/feed", eventsFeedResponse());
      enqueueResolved("/api/jobs/feed", jobsFeedResponse());

      await useFeedStore.getState().loadFeed();

      const state = useFeedStore.getState();
      // Batch A's record is gone — overwritten, not queued — even though
      // its own ack never actually succeeded. This is the accepted gap.
      expect(state.pendingBatchAck).toEqual({
        batchId: "batch-B-new",
        localDate: localCalendarDate(),
      });
      expect(state.renderedBatchId).toBe("batch-B-new");

      // Safety still holds despite the dropped record: if batch A's pending
      // entry HAD somehow survived, acknowledgePendingBatch's match gate
      // (proven generally elsewhere in this file) would still refuse to
      // send it now that batch B is what's rendered — the accepted cost is
      // purely "this device stops retrying A", never a false ack for A.
      useFeedStore.setState({
        pendingBatchAck: { batchId: "batch-A-older-still-pending", localDate: "2026-09-01" },
      });
      await useFeedStore.getState().acknowledgePendingBatch();
      const totalAckCalls = fetchMock.mock.calls.filter(
        ([input]) => requestPath(input as string | URL | Request) === "/api/feed/ack",
      );
      // Only the one earlier, failed retry-before-load attempt for A (503,
      // during loadFeed above) — this manual re-attempt for A, now that B
      // is what's rendered, must add no new call.
      expect(totalAckCalls).toHaveLength(1);
    });

    it("persists pendingBatchAck through the partialize whitelist", () => {
      useFeedStore.setState({
        pendingBatchAck: { batchId: "batch-persisted", localDate: "2026-09-01" },
      });

      expect(persistenceCapture.partialize).toBeTypeOf("function");
      const persisted = persistenceCapture.partialize?.(useFeedStore.getState());
      expect(persisted).toMatchObject({
        pendingBatchAck: { batchId: "batch-persisted", localDate: "2026-09-01" },
      });
    });

    // P4-S5a-FIX (Round 3) — F-A-P4S5-01: renderedBatchId, UNLIKE batchId/
    // batchStatus, is deliberately persisted (see feed.ts's partialize
    // comment for why) so it survives a reload alongside the `papers` it
    // describes.
    it("persists renderedBatchId through the partialize whitelist", () => {
      useFeedStore.setState({ renderedBatchId: "batch-persisted-render" });

      expect(persistenceCapture.partialize).toBeTypeOf("function");
      const persisted = persistenceCapture.partialize?.(useFeedStore.getState());
      expect(persisted).toMatchObject({
        renderedBatchId: "batch-persisted-render",
      });
    });
  });

  // EMPTY-STATE-REASON (ABC-JEV-INTEGRATION.md §1bb) — the server's own
  // honest reason for an empty paper response, forwarded from
  // `FeedMeta.emptyReasonCode` into the SAME store field the home page reads
  // (page.tsx). Same "capture alongside papers, in one set() call, never
  // read stale" discipline this file already proves for
  // batchId/batchStatus/renderedBatchId just above.
  describe("EMPTY-STATE-REASON: emptyReasonCode capture", () => {
    it("captures the server's emptyReasonCode in the same set() call as papers", async () => {
      enqueueResolved("/api/feed", {
        items: [],
        meta: { emptyReasonCode: "already-delivered" },
      });
      enqueueResolved("/api/events/feed", eventsFeedResponse());
      enqueueResolved("/api/jobs/feed", jobsFeedResponse());

      await useFeedStore.getState().loadFeed();

      expect(useFeedStore.getState().emptyReasonCode).toBe("already-delivered");
    });

    it("stays null, never crashes or invents a value, when the response carries no emptyReasonCode (a non-empty response, a frozen-batch replay, or an older server)", async () => {
      enqueueResolved("/api/feed", {
        items: paperFeedResponse("paper-1").items,
        meta: {},
      });
      enqueueResolved("/api/events/feed", eventsFeedResponse());
      enqueueResolved("/api/jobs/feed", jobsFeedResponse());

      await useFeedStore.getState().loadFeed();

      expect(useFeedStore.getState().emptyReasonCode).toBeNull();
    });

    it("clears a previous load's emptyReasonCode before a new load starts, so a failure never shows a stale reason from an earlier empty load", async () => {
      // First load: genuinely empty with a code.
      enqueueResolved("/api/feed", { items: [], meta: { emptyReasonCode: "no-results" } });
      enqueueResolved("/api/events/feed", eventsFeedResponse());
      enqueueResolved("/api/jobs/feed", jobsFeedResponse());
      await useFeedStore.getState().loadFeed();
      expect(useFeedStore.getState().emptyReasonCode).toBe("no-results");

      // Second load: the fetch itself throws (a dead connection) — feedError
      // takes over as the visible reason (empty-reason.ts's own precedence),
      // and the stale "no-results" from the first load must not linger.
      const failingFetch = enqueue("/api/feed");
      failingFetch.reject(new Error("network down"));
      enqueueResolved("/api/events/feed", eventsFeedResponse());
      enqueueResolved("/api/jobs/feed", jobsFeedResponse());
      await useFeedStore.getState().loadFeed();

      expect(useFeedStore.getState().feedError).toBeTruthy();
      expect(useFeedStore.getState().emptyReasonCode).toBeNull();
    });
  });

  // Jev on the reader's own key: the server reports what Jev did when today's
  // pool was built (`FeedMeta.jevScreening`, counts and a status word, present
  // only when a key was sent). The store keeps the last report it saw so the
  // Profile row can say so; a response with none (a reader with no key, or a
  // replay of a frozen batch) leaves the last report as it was.
  describe("Jev screening report capture", () => {
    beforeEach(() => {
      useJevScreeningStore.setState({ report: null });
    });

    it("keeps what the briefing reported", async () => {
      enqueueResolved("/api/feed", {
        items: paperFeedResponse("paper-1").items,
        meta: { jevScreening: { status: "applied", screened: 5, of: 5 } },
      });
      enqueueResolved("/api/events/feed", eventsFeedResponse());
      enqueueResolved("/api/jobs/feed", jobsFeedResponse());

      await useFeedStore.getState().loadFeed();

      expect(useJevScreeningStore.getState().report).toEqual({ status: "applied", screened: 5, of: 5 });
    });

    it("a response that reports nothing leaves the last report alone", async () => {
      useJevScreeningStore.setState({ report: { status: "partial", screened: 31, of: 50 } });
      enqueueResolved("/api/feed", { items: paperFeedResponse("paper-1").items, meta: {} });
      enqueueResolved("/api/events/feed", eventsFeedResponse());
      enqueueResolved("/api/jobs/feed", jobsFeedResponse());

      await useFeedStore.getState().loadFeed();

      expect(useJevScreeningStore.getState().report).toEqual({ status: "partial", screened: 31, of: 50 });
    });

    it("a failed load leaves the last report alone", async () => {
      useJevScreeningStore.setState({ report: { status: "applied", screened: 50, of: 50 } });
      const failingFetch = enqueue("/api/feed");
      failingFetch.reject(new Error("network down"));
      enqueueResolved("/api/events/feed", eventsFeedResponse());
      enqueueResolved("/api/jobs/feed", jobsFeedResponse());

      await useFeedStore.getState().loadFeed();

      expect(useJevScreeningStore.getState().report).toEqual({ status: "applied", screened: 50, of: 50 });
    });

    it("the report is not part of the feed store's own persisted shape", () => {
      expect(persistenceCapture.partialize).toBeTypeOf("function");
      const persisted = persistenceCapture.partialize?.(useFeedStore.getState()) as Record<string, unknown>;
      expect(Object.keys(persisted)).not.toContain("jevScreening");
      expect(JSON.stringify(persisted)).not.toContain("screened");
    });
  });

  // P4-S5a — the store action `useBatchAcknowledgement` and loadFeed's own
  // retry step both call. Tested directly (no DOM/hook mount needed — this
  // repo has no @testing-library/react and no test anywhere mounts a live
  // React effect, see private-pdf-status.test.tsx's own note) against every
  // response this endpoint can give, per ABC-JEV-INTEGRATION.md §1p.C.7 and
  // docs/jev-abc/P4-B-20260924T0338Z.md DESIGN §4.
  describe("P4-S5a: acknowledgePendingBatch", () => {
    beforeEach(() => {
      useFeedStore.setState({
        pendingBatchAck: { batchId: "batch-x", localDate: "2026-09-01" },
        // P4-S5a-FIX (Round 3) — F-A-P4S5-01: every test below this point
        // means "batch-x's cards ARE what's currently rendered, and its ack
        // is outstanding" — that's the precondition acknowledgePendingBatch
        // now requires before it will even attempt the POST. The one test
        // that means something different (a genuine mismatch) overrides
        // this explicitly below.
        renderedBatchId: "batch-x",
      });
    });

    it("does nothing, and calls fetch zero times, when there is no pending acknowledgment", async () => {
      useFeedStore.setState({ pendingBatchAck: null });

      await useFeedStore.getState().acknowledgePendingBatch();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    // P4-S5a-FIX (Round 3) — F-A-P4S5-01, the headline finding this slice
    // closes, proven directly against the real store action in isolation
    // (complementing the full-loadFeed reproduction in the "batch meta
    // capture" describe block above, and the predicate-level reproduction
    // in use-batch-acknowledgement.test.ts).
    it("does nothing, and calls fetch zero times, when the pending batch is not the one currently rendered", async () => {
      useFeedStore.setState({ renderedBatchId: "some-other-batch-entirely" });

      await useFeedStore.getState().acknowledgePendingBatch();

      expect(fetchMock).not.toHaveBeenCalled();
      // Kept, not cleared — it can still be sent later if batch-x's cards
      // are ever rendered again (ABC-JEV-INTEGRATION.md §1p.C.5/C.7).
      expect(useFeedStore.getState().pendingBatchAck).toEqual({
        batchId: "batch-x",
        localDate: "2026-09-01",
      });
    });

    it("does nothing, and calls fetch zero times, when nothing has ever been rendered (renderedBatchId still null)", async () => {
      useFeedStore.setState({ renderedBatchId: null });

      await useFeedStore.getState().acknowledgePendingBatch();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(useFeedStore.getState().pendingBatchAck).toEqual({
        batchId: "batch-x",
        localDate: "2026-09-01",
      });
    });

    it("POSTs exactly the batchId, nothing else", async () => {
      enqueueResolved("/api/feed/ack", { ok: true, alreadyAcknowledged: false });

      await useFeedStore.getState().acknowledgePendingBatch();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [input, init] = fetchMock.mock.calls[0]!;
      expect(requestPath(input as string | URL | Request)).toBe("/api/feed/ack");
      expect(JSON.parse(String((init as RequestInit).body))).toEqual({ batchId: "batch-x" });
    });

    it("200 (fresh acknowledgment) clears pending", async () => {
      enqueueResolved("/api/feed/ack", { ok: true, alreadyAcknowledged: false });
      await useFeedStore.getState().acknowledgePendingBatch();
      expect(useFeedStore.getState().pendingBatchAck).toBeNull();
    });

    it("200 (already acknowledged, e.g. by another device) clears pending", async () => {
      enqueueResolved("/api/feed/ack", { ok: true, alreadyAcknowledged: true });
      await useFeedStore.getState().acknowledgePendingBatch();
      expect(useFeedStore.getState().pendingBatchAck).toBeNull();
    });

    it("404 not_enabled clears pending — retrying cannot help", async () => {
      enqueue("/api/feed/ack").resolve(jsonResponse({ error: "not_enabled" }, 404));
      await useFeedStore.getState().acknowledgePendingBatch();
      expect(useFeedStore.getState().pendingBatchAck).toBeNull();
    });

    it("404 batch_not_found clears pending — retrying cannot help", async () => {
      enqueue("/api/feed/ack").resolve(jsonResponse({ error: "batch_not_found" }, 404));
      await useFeedStore.getState().acknowledgePendingBatch();
      expect(useFeedStore.getState().pendingBatchAck).toBeNull();
    });

    it("400 clears pending and logs", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      enqueue("/api/feed/ack").resolve(jsonResponse({ error: "invalid_batch_id" }, 400));

      await useFeedStore.getState().acknowledgePendingBatch();

      expect(useFeedStore.getState().pendingBatchAck).toBeNull();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("401 keeps pending — retry once signed in", async () => {
      enqueue("/api/feed/ack").resolve(jsonResponse({ error: "unauthenticated" }, 401));
      await useFeedStore.getState().acknowledgePendingBatch();
      expect(useFeedStore.getState().pendingBatchAck).toEqual({
        batchId: "batch-x",
        localDate: "2026-09-01",
      });
    });

    it("503 keeps pending — retry on the next load or visibilitychange", async () => {
      enqueue("/api/feed/ack").resolve(jsonResponse({ error: "ledger_unavailable" }, 503));
      await useFeedStore.getState().acknowledgePendingBatch();
      expect(useFeedStore.getState().pendingBatchAck).toEqual({
        batchId: "batch-x",
        localDate: "2026-09-01",
      });
    });

    it("a network error keeps pending — retry on the next load or visibilitychange", async () => {
      enqueue("/api/feed/ack").reject(new TypeError("network down"));
      await useFeedStore.getState().acknowledgePendingBatch();
      expect(useFeedStore.getState().pendingBatchAck).toEqual({
        batchId: "batch-x",
        localDate: "2026-09-01",
      });
    });

    it("dedupes two concurrent calls into a single fetch (acknowledges once)", async () => {
      const ack = enqueue("/api/feed/ack");

      const first = useFeedStore.getState().acknowledgePendingBatch();
      const second = useFeedStore.getState().acknowledgePendingBatch();
      ack.resolve(jsonResponse({ ok: true, alreadyAcknowledged: false }));
      await Promise.all([first, second]);

      const ackCalls = fetchMock.mock.calls.filter(
        ([input]) => requestPath(input as string | URL | Request) === "/api/feed/ack",
      );
      expect(ackCalls).toHaveLength(1);
    });
  });

  // P4-S5b — ABC-JEV-INTEGRATION.md §1p.C.1 (signed-out users) + this
  // slice's manager refinement (2026-09-24: also signed-in users while
  // PEER_DASHBOARD_LEDGER is off — both share the "batchless response"
  // signal `renderedBatchId === null`). Device-local "delivered" memory:
  // written when a batchless batch of cards has rendered, excluding those
  // papers from the NEXT local day onward — never from today's own
  // reloads. Weaker than the signed-in permanent server ledger (single
  // device, cleared with browser storage, identity is just the item id the
  // client already has — a cross-source duplicate can slip through, an
  // accepted, honestly-described limitation).
  //
  // P4-S5b-FIX (Round 3) — ABC-JEV-INTEGRATION.md §1c/§1g, closing
  // docs/jev-abc/P4-S5b-A-20260924T095305Z.md findings (a) and (b): every
  // test below that references `deliveredLocal`/bare-array
  // `pendingLocalDelivery` is rewritten for the namespaced
  // `deliveredLocalByOwner`/`deliveredLocalOwnerOrder` shape and the
  // `{ ownerKey, ids }` pendingLocalDelivery shape (see feed.ts's FeedState
  // doc comments). The default `authUserId: null` (set by this file's
  // `beforeEach`) resolves `currentOwnerKey()` to `"anonymous"`, so any test
  // below that does not explicitly sign in a user is exercising the
  // anonymous namespace.
  describe("P4-S5b: device-local delivered memory", () => {
    describe("papersLane arms pendingLocalDelivery", () => {
      it("arms pendingLocalDelivery with the rendered ids and the current (anonymous) owner key for a batchless response", async () => {
        enqueueResolved("/api/feed", paperFeedResponse("paper-batchless")); // meta: {}
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed();

        expect(useFeedStore.getState().renderedBatchId).toBeNull();
        // P4-S5b-FIX (Round 3): pendingLocalDelivery now carries the owner
        // this render belongs to (captured at arm time), not just a bare
        // id array.
        expect(useFeedStore.getState().pendingLocalDelivery).toEqual({
          ownerKey: "anonymous",
          ids: ["paper-batchless"],
        });
        // Arming is not recording — the actual write is a separate step
        // (recordPendingLocalDelivery, gated on render + visibility).
        // loadFeed still touches (creates, if absent) the current owner's
        // namespace as an empty map purely by reading it.
        expect(useFeedStore.getState().deliveredLocalByOwner).toEqual({
          anonymous: {},
        });
      });

      it("arms pendingLocalDelivery with the signed-in owner's id, not \"anonymous\", when a real user is signed in", async () => {
        signIn("user-a");
        enqueueResolved("/api/feed", paperFeedResponse("paper-for-a"));
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed();

        expect(useFeedStore.getState().pendingLocalDelivery).toEqual({
          ownerKey: "user-a",
          ids: ["paper-for-a"],
        });
        expect(useFeedStore.getState().deliveredLocalByOwner).toEqual({
          "user-a": {},
        });
      });

      it("arms nothing for a batched response — the server ledger owns delivery", async () => {
        enqueueResolved("/api/feed", {
          items: paperFeedResponse("paper-batched").items,
          meta: { batchId: "batch-1", batchStatus: "served" },
        });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed();

        expect(useFeedStore.getState().renderedBatchId).toBe("batch-1");
        expect(useFeedStore.getState().pendingLocalDelivery).toBeNull();
      });

      it("arms nothing for a batchless response with zero papers", async () => {
        enqueueResolved("/api/feed", { items: [], meta: {} });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed();

        expect(useFeedStore.getState().renderedBatchId).toBeNull();
        expect(useFeedStore.getState().pendingLocalDelivery).toBeNull();
      });

      it("clears a stale pendingLocalDelivery once a batched response supersedes it", async () => {
        useFeedStore.setState({
          // P4-S5b-FIX (Round 3): pendingLocalDelivery is now { ownerKey, ids }.
          pendingLocalDelivery: {
            ownerKey: "anonymous",
            ids: ["paper-stale-batchless"],
          },
        });
        enqueueResolved("/api/feed", {
          items: paperFeedResponse("paper-new-batched").items,
          meta: { batchId: "batch-2", batchStatus: "served" },
        });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed();

        expect(useFeedStore.getState().pendingLocalDelivery).toBeNull();
      });
    });

    describe("recordPendingLocalDelivery", () => {
      it("does nothing when there is nothing pending", () => {
        useFeedStore.setState({ pendingLocalDelivery: null });

        useFeedStore.getState().recordPendingLocalDelivery();

        expect(useFeedStore.getState().deliveredLocalByOwner).toEqual({});
      });

      it("does nothing when pendingLocalDelivery has an empty ids array", () => {
        useFeedStore.setState({
          pendingLocalDelivery: { ownerKey: "anonymous", ids: [] },
        });

        useFeedStore.getState().recordPendingLocalDelivery();

        expect(useFeedStore.getState().deliveredLocalByOwner).toEqual({});
      });

      it("stamps every pending id with today's local date into the pending owner's namespace, then clears pendingLocalDelivery", () => {
        useFeedStore.setState({
          pendingLocalDelivery: {
            ownerKey: "anonymous",
            ids: ["paper-a", "paper-b"],
          },
        });

        useFeedStore.getState().recordPendingLocalDelivery();

        const today = localCalendarDate();
        expect(useFeedStore.getState().deliveredLocalByOwner).toEqual({
          anonymous: { "paper-a": today, "paper-b": today },
        });
        expect(useFeedStore.getState().pendingLocalDelivery).toBeNull();

        // A second fire (simulating a repeat hook trigger, e.g. a second
        // visibilitychange while still on the same render) is a genuine
        // no-op: nothing is pending anymore.
        useFeedStore.getState().recordPendingLocalDelivery();
        expect(useFeedStore.getState().deliveredLocalByOwner).toEqual({
          anonymous: { "paper-a": today, "paper-b": today },
        });
      });

      it("keeps existing deliveredLocalByOwner entries untouched for ids outside the current pending set", () => {
        useFeedStore.setState({
          deliveredLocalByOwner: {
            anonymous: { "paper-earlier": "2020-01-01" },
          },
          deliveredLocalOwnerOrder: ["anonymous"],
          pendingLocalDelivery: { ownerKey: "anonymous", ids: ["paper-new"] },
        });

        useFeedStore.getState().recordPendingLocalDelivery();

        expect(useFeedStore.getState().deliveredLocalByOwner).toEqual({
          anonymous: {
            "paper-earlier": "2020-01-01",
            "paper-new": localCalendarDate(),
          },
        });
      });

      // P4-S5b-FIX (Round 3): the cap is now PER OWNER, not device-wide —
      // closes docs/jev-abc/P4-S5b-A-20260924T095305Z.md finding (b)'s "the
      // 5,000 cap applies per owner" requirement.
      it("caps deliveredLocalByOwner at 5,000 entries PER OWNER, dropping the oldest first, leaving other owners untouched", () => {
        const bulk: Record<string, string> = {};
        for (let i = 0; i < 5000; i++) {
          // Strictly increasing calendar dates: entry 0 is the oldest.
          bulk[`paper-old-${i}`] = localCalendarDate(new Date(2000, 0, 1 + i));
        }
        useFeedStore.setState({
          deliveredLocalByOwner: {
            anonymous: bulk,
            "user-b": { "paper-b-only": "2021-01-01" },
          },
          deliveredLocalOwnerOrder: ["user-b", "anonymous"],
          pendingLocalDelivery: {
            ownerKey: "anonymous",
            ids: ["paper-newest"],
          },
        });

        useFeedStore.getState().recordPendingLocalDelivery();

        const byOwner = useFeedStore.getState().deliveredLocalByOwner;
        const anonymousResult = byOwner.anonymous ?? {};
        expect(Object.keys(anonymousResult)).toHaveLength(5000);
        // Today's fresh entry always survives.
        expect(anonymousResult["paper-newest"]).toBe(localCalendarDate());
        // Exactly one entry had to go to stay at the cap — the single
        // globally oldest one, WITHIN the anonymous namespace only.
        expect(anonymousResult["paper-old-0"]).toBeUndefined();
        expect(anonymousResult["paper-old-1"]).toBe(
          localCalendarDate(new Date(2000, 0, 2)),
        );
        // user-b's own namespace is completely unaffected by anonymous's cap.
        expect(byOwner["user-b"]).toEqual({ "paper-b-only": "2021-01-01" });
      });

      // Proves the DESIGN CHOICE (checkpoint DESIGN CHOICES §2): the owner
      // captured AT ARM TIME on pendingLocalDelivery, not whoever is
      // current when this actually fires, decides which namespace is
      // written — closing the narrow arm-vs-record race the checkpoint
      // documents.
      it("writes into the owner captured on pendingLocalDelivery, even if a DIFFERENT owner is current by the time it fires", () => {
        useFeedStore.setState({
          pendingLocalDelivery: { ownerKey: "user-a", ids: ["paper-for-a"] },
        });
        // Simulate a sign-out/sign-in race: a different owner is now current.
        signIn("user-b");

        useFeedStore.getState().recordPendingLocalDelivery();

        const byOwner = useFeedStore.getState().deliveredLocalByOwner;
        expect(byOwner["user-a"]).toEqual({
          "paper-for-a": localCalendarDate(),
        });
        expect(byOwner["user-b"] ?? {}).toEqual({});
      });
    });

    describe("loadFeed excludeIds: delivered-before-today only, never today's own renders", () => {
      it("does NOT exclude a paper delivered earlier TODAY — a same-day reload does not rotate the cards", async () => {
        useFeedStore.setState({
          deliveredLocalByOwner: {
            anonymous: { "paper-today": localCalendarDate() },
          },
          deliveredLocalOwnerOrder: ["anonymous"],
        });
        enqueueResolved("/api/feed", { items: [], meta: {} });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed();

        expect(fetchMock).toHaveBeenCalled();
        const request = JSON.parse(
          String((fetchMock.mock.calls[0]![1] as RequestInit).body),
        );
        expect(request.excludeIds ?? []).not.toContain("paper-today");
      });

      it("excludes a paper delivered on an earlier local day, even on a plain (non-refresh) load", async () => {
        useFeedStore.setState({
          deliveredLocalByOwner: {
            anonymous: { "paper-yesterday": "2020-01-01" },
          },
          deliveredLocalOwnerOrder: ["anonymous"],
        });
        enqueueResolved("/api/feed", { items: [], meta: {} });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed();

        const request = JSON.parse(
          String((fetchMock.mock.calls[0]![1] as RequestInit).body),
        );
        expect(request.excludeIds).toContain("paper-yesterday");
      });

      it("orders excludeIds dismissed first, then delivered-before-today (most recent first), then recently-shown when advanceHistory", async () => {
        useFeedStore.setState({
          paperFeedback: { "paper-dismissed": "notInterested" },
          deliveredLocalByOwner: {
            anonymous: {
              "paper-older-delivery": "2019-01-01",
              "paper-newer-delivery": "2020-06-15",
            },
          },
          deliveredLocalOwnerOrder: ["anonymous"],
          recentlyShownIds: { "paper-recent": Date.now() },
        });
        enqueueResolved("/api/feed", { items: [], meta: {} });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed({ advanceHistory: true });

        const request = JSON.parse(
          String((fetchMock.mock.calls[0]![1] as RequestInit).body),
        );
        expect(request.excludeIds).toEqual([
          "paper-dismissed",
          "paper-newer-delivery",
          "paper-older-delivery",
          "paper-recent",
        ]);
      });

      it("caps the combined excludeIds at 800, keeping dismissed then newest-delivered priority", async () => {
        const dismissed = Object.fromEntries(
          Array.from({ length: 10 }, (_, i) => [
            `dismissed-${i}`,
            "notInterested" as const,
          ]),
        );
        const delivered: Record<string, string> = {};
        for (let i = 0; i < 900; i++) {
          delivered[`delivered-${i}`] = localCalendarDate(
            new Date(2020, 0, 1 + i),
          );
        }
        useFeedStore.setState({
          paperFeedback: dismissed,
          deliveredLocalByOwner: { anonymous: delivered },
          deliveredLocalOwnerOrder: ["anonymous"],
        });
        enqueueResolved("/api/feed", { items: [], meta: {} });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed();

        const request = JSON.parse(
          String((fetchMock.mock.calls[0]![1] as RequestInit).body),
        );
        expect(request.excludeIds).toHaveLength(800);
        // All 10 dismissed ids survive the cap — highest priority.
        for (let i = 0; i < 10; i++) {
          expect(request.excludeIds).toContain(`dismissed-${i}`);
        }
        // Only 790 of the 900 delivered ids fit after the 10 dismissed
        // ones; the most recently delivered must be the ones that survive.
        expect(request.excludeIds).toContain("delivered-899");
        expect(request.excludeIds).not.toContain("delivered-0");
      });
    });

    // P4-S5b-FIX (Round 3) — closes docs/jev-abc/P4-S5b-A-20260924T095305Z.md
    // finding (a): the savedIds carve-out used to apply to the WHOLE
    // excludeIds union, so saving a paper AFTER it had already been
    // delivered quietly let it back into tomorrow's candidate pool —
    // contradicting ABC-JEV-INTEGRATION.md §1g, which lists "no delivered
    // item re-enters future batches" and "saved history preserved" as two
    // SEPARATE clauses, not one exempting the other, and disagreeing with
    // the signed-in server ledger path (delivery-ledger.ts), which has no
    // saved-id exception at all. METHODOLOGY NOTE: the first two tests
    // below were originally written and run against TODAY's real,
    // unmodified flat `deliveredLocal`/dismissed-filter logic (before
    // finding (b)'s owner-namespacing reshape existed at all) and both
    // genuinely failed (RED) there — see the checkpoint's EVIDENCE for the
    // exact run. Implementation then proceeded directly into finding (b)'s
    // reshape in the same pass, so their field references below now target
    // the final `deliveredLocalByOwner` shape; the underlying assertions
    // (what must be excluded) are unchanged from the genuinely-red version.
    describe("finding (a): saved status never exempts an explicit negative or a permanent delivery", () => {
      it("keeps a delivered-then-saved paper in excludeIds the next day — saved does not undo a permanent delivery record", async () => {
        useFeedStore.setState({
          deliveredLocalByOwner: {
            anonymous: { "paper-delivered-then-saved": "2020-01-01" },
          },
          deliveredLocalOwnerOrder: ["anonymous"],
          savedPapers: [
            {
              id: "paper-delivered-then-saved",
              title: "Saved after delivery",
              authors: ["Researcher"],
              relevanceReason: "Saved.",
              venue: "Example Journal",
              source: "other",
              summaryIntro: "Saved intro.",
              summaryExperimentKeywords: [],
              summaryResultDiscussion: "Saved result.",
              isSaved: true,
              feedback: "saved",
            },
          ],
        });
        enqueueResolved("/api/feed", { items: [], meta: {} });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed();

        const request = JSON.parse(
          String((fetchMock.mock.calls[0]![1] as RequestInit).body),
        );
        expect(request.excludeIds).toContain("paper-delivered-then-saved");
      });

      it("keeps a dismissed-then-saved paper in excludeIds — an explicit negative signal always wins over saved status", async () => {
        useFeedStore.setState({
          paperFeedback: { "paper-dismissed-then-saved": "notInterested" },
          savedPapers: [
            {
              id: "paper-dismissed-then-saved",
              title: "Saved after dismissal",
              authors: ["Researcher"],
              relevanceReason: "Saved.",
              venue: "Example Journal",
              source: "other",
              summaryIntro: "Saved intro.",
              summaryExperimentKeywords: [],
              summaryResultDiscussion: "Saved result.",
              isSaved: true,
              feedback: "saved",
            },
          ],
        });
        enqueueResolved("/api/feed", { items: [], meta: {} });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed();

        const request = JSON.parse(
          String((fetchMock.mock.calls[0]![1] as RequestInit).body),
        );
        expect(request.excludeIds).toContain("paper-dismissed-then-saved");
      });

      it("still lets a saved paper cycle back through the recently-shown/refresh-guard source specifically", async () => {
        // The savedIds carve-out is not deleted outright — it survives on
        // the one source it originally meant to cover (ABC-JEV-
        // INTEGRATION.md's own pre-existing comment: "Saved papers are
        // allowed back either way — the user bookmarked them"), scoped now
        // to recentlyShownAndDisplayed only.
        useFeedStore.setState({
          recentlyShownIds: { "paper-recent-and-saved": Date.now() },
          savedPapers: [
            {
              id: "paper-recent-and-saved",
              title: "Saved and recently shown",
              authors: ["Researcher"],
              relevanceReason: "Saved.",
              venue: "Example Journal",
              source: "other",
              summaryIntro: "Saved intro.",
              summaryExperimentKeywords: [],
              summaryResultDiscussion: "Saved result.",
              isSaved: true,
              feedback: "saved",
            },
          ],
        });
        enqueueResolved("/api/feed", { items: [], meta: {} });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed({ advanceHistory: true });

        const request = JSON.parse(
          String((fetchMock.mock.calls[0]![1] as RequestInit).body),
        );
        expect(request.excludeIds ?? []).not.toContain(
          "paper-recent-and-saved",
        );
      });
    });

    // P4-S5b-FIX (Round 3) — closes docs/jev-abc/P4-S5b-A-20260924T095305Z.md
    // finding (b): "deliveredLocal is one unnamespaced, account-agnostic map
    // that survives sign-out, so a shared device leaks and misapplies
    // delivery history across accounts." HONEST METHODOLOGY NOTE (unlike
    // finding (a) above): these tests were written directly against the
    // FINAL `deliveredLocalByOwner` shape, after the reshape was already
    // implemented — not run against the literally-original flat-shape code
    // first, because the reshape (new field names, new `currentOwnerKey()`
    // resolution) had to exist before these tests could even type-check.
    // Their red-before-green evidence is instead the checkpoint's Round 1
    // mutation proof: forcing `currentOwnerKey()` to always return
    // "anonymous" (ignoring authUserId) makes exactly this block's
    // owner-isolation tests fail, restoring them to green on revert — see
    // the checkpoint's EVIDENCE for the exact run. This is the same
    // mutation-based load-bearing standard this campaign's own A review
    // used and endorsed for the original P4-S5b slice, applied here because
    // finding (a) had a code path amenable to a true pre-edit run and
    // finding (b) did not (the shape did not exist yet to run against).
    describe("finding (b): deliveredLocalByOwner is namespaced per owner, never leaks across accounts", () => {
      it("never sends user A's delivered ids when a different signed-in user B is active on the same device", async () => {
        useFeedStore.setState({
          deliveredLocalByOwner: {
            "user-a": { "paper-seen-by-a": "2020-01-01" },
          },
          deliveredLocalOwnerOrder: ["user-a"],
        });
        signIn("user-b");
        enqueueResolved("/api/feed", { items: [], meta: {} });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed();

        const request = JSON.parse(
          String((fetchMock.mock.calls[0]![1] as RequestInit).body),
        );
        expect(request.excludeIds ?? []).not.toContain("paper-seen-by-a");
        // A's own namespace survives, byte-for-byte; B gets its own, empty.
        expect(useFeedStore.getState().deliveredLocalByOwner["user-a"]).toEqual(
          { "paper-seen-by-a": "2020-01-01" },
        );
        expect(useFeedStore.getState().deliveredLocalByOwner["user-b"]).toEqual(
          {},
        );
      });

      it("never sends user A's delivered ids when the device is signed out (anonymous) afterward", async () => {
        useFeedStore.setState({
          deliveredLocalByOwner: {
            "user-a": { "paper-seen-by-a": "2020-01-01" },
          },
          deliveredLocalOwnerOrder: ["user-a"],
        });
        // authUserId defaults to null via this file's beforeEach, so
        // currentOwnerKey() resolves to "anonymous" here without any
        // further setup — the signed-out case.

        enqueueResolved("/api/feed", { items: [], meta: {} });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed();

        const request = JSON.parse(
          String((fetchMock.mock.calls[0]![1] as RequestInit).body),
        );
        expect(request.excludeIds ?? []).not.toContain("paper-seen-by-a");
      });

      it("switching back to user A restores A's own delivered memory untouched", async () => {
        useFeedStore.setState({
          deliveredLocalByOwner: {
            "user-a": { "paper-seen-by-a": "2020-01-01" },
          },
          deliveredLocalOwnerOrder: ["user-a"],
        });

        // B uses the device first.
        signIn("user-b");
        enqueueResolved("/api/feed", { items: [], meta: {} });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());
        await useFeedStore.getState().loadFeed();

        // Now switch back to A.
        signIn("user-a");
        enqueueResolved("/api/feed", { items: [], meta: {} });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());
        await useFeedStore.getState().loadFeed();

        const paperRequests = fetchMock.mock.calls.filter(
          ([input]) => requestPath(input as string | URL | Request) === "/api/feed",
        );
        expect(paperRequests).toHaveLength(2);
        const secondRequest = JSON.parse(
          String((paperRequests[1]?.[1] as RequestInit).body),
        );
        expect(secondRequest.excludeIds).toContain("paper-seen-by-a");
      });

      it("bounds the number of owner namespaces kept to the 5 most recently active, evicting the least recently active", async () => {
        for (const owner of ["user-1", "user-2", "user-3", "user-4", "user-5"]) {
          signIn(owner);
          enqueueResolved("/api/feed", { items: [], meta: {} });
          enqueueResolved("/api/events/feed", eventsFeedResponse());
          enqueueResolved("/api/jobs/feed", jobsFeedResponse());
          await useFeedStore.getState().loadFeed();
        }
        expect(
          Object.keys(useFeedStore.getState().deliveredLocalByOwner).sort(),
        ).toEqual(["user-1", "user-2", "user-3", "user-4", "user-5"]);

        // A 6th distinct owner becomes active — user-1 (touched least
        // recently: nothing has re-touched it since the very first load)
        // is evicted to keep the bound at 5.
        signIn("user-6");
        enqueueResolved("/api/feed", { items: [], meta: {} });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());
        await useFeedStore.getState().loadFeed();

        const byOwner = useFeedStore.getState().deliveredLocalByOwner;
        expect(Object.keys(byOwner).sort()).toEqual([
          "user-2",
          "user-3",
          "user-4",
          "user-5",
          "user-6",
        ]);
        expect(byOwner["user-1"]).toBeUndefined();
        expect(useFeedStore.getState().deliveredLocalOwnerOrder).toEqual([
          "user-6",
          "user-5",
          "user-4",
          "user-3",
          "user-2",
        ]);
      });

      it("re-activating an existing owner moves it back to the front of the MRU order, protecting it from eviction", async () => {
        for (const owner of ["user-1", "user-2", "user-3", "user-4", "user-5"]) {
          signIn(owner);
          enqueueResolved("/api/feed", { items: [], meta: {} });
          enqueueResolved("/api/events/feed", eventsFeedResponse());
          enqueueResolved("/api/jobs/feed", jobsFeedResponse());
          await useFeedStore.getState().loadFeed();
        }
        // Re-touch user-1 (otherwise the least recently active) before a
        // 6th owner ever shows up.
        signIn("user-1");
        enqueueResolved("/api/feed", { items: [], meta: {} });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());
        await useFeedStore.getState().loadFeed();

        signIn("user-6");
        enqueueResolved("/api/feed", { items: [], meta: {} });
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());
        await useFeedStore.getState().loadFeed();

        const byOwner = useFeedStore.getState().deliveredLocalByOwner;
        // user-2 is now the least recently active and is the one evicted —
        // NOT user-1, which was re-touched in between.
        expect(byOwner["user-1"]).toBeDefined();
        expect(byOwner["user-2"]).toBeUndefined();
      });
    });

    describe("persistence and migration", () => {
      // P4-S5b-FIX (Round 3): deliveredLocal (flat) replaced by
      // deliveredLocalByOwner + deliveredLocalOwnerOrder; both must persist
      // together (the order decides what an eviction touches next).
      it("persists deliveredLocalByOwner and deliveredLocalOwnerOrder through the partialize whitelist", () => {
        useFeedStore.setState({
          deliveredLocalByOwner: {
            anonymous: { "paper-persisted": "2026-09-01" },
          },
          deliveredLocalOwnerOrder: ["anonymous"],
        });

        expect(persistenceCapture.partialize).toBeTypeOf("function");
        const persisted = persistenceCapture.partialize?.(
          useFeedStore.getState(),
        );
        expect(persisted).toMatchObject({
          deliveredLocalByOwner: {
            anonymous: { "paper-persisted": "2026-09-01" },
          },
          deliveredLocalOwnerOrder: ["anonymous"],
        });
      });

      it("does NOT persist pendingLocalDelivery — transient, re-armed by the next load", () => {
        useFeedStore.setState({
          pendingLocalDelivery: {
            ownerKey: "anonymous",
            ids: ["paper-transient"],
          },
        });

        const persisted = persistenceCapture.partialize?.(
          useFeedStore.getState(),
        ) as Record<string, unknown>;
        expect(persisted).not.toHaveProperty("pendingLocalDelivery");
      });

      // P4-S5b-FIX (Round 3): version bumped 2 -> 3 (was 1 -> 2). A
      // version-0/1 blob has no `deliveredLocal` at all, so this is the
      // SAME real-evidence-only seed the old version 1 -> 2 step performed
      // — now landing in the anonymous namespace instead of a flat map.
      it("seeds the anonymous namespace from recentlyShownIds' real evidence on a pre-P4-S5b (version 1) blob with no deliveredLocal at all", () => {
        const ts = Date.parse("2026-09-01T12:00:00.000Z");
        expect(persistenceCapture.migrate).toBeTypeOf("function");
        const migrated = persistenceCapture.migrate?.(
          { recentlyShownIds: { "paper-legacy-shown": ts } },
          1,
        ) as {
          deliveredLocalByOwner?: Record<string, Record<string, string>>;
          deliveredLocalOwnerOrder?: string[];
        };

        expect(migrated.deliveredLocalByOwner).toEqual({
          anonymous: { "paper-legacy-shown": localCalendarDate(new Date(ts)) },
        });
        expect(migrated.deliveredLocalOwnerOrder).toEqual(["anonymous"]);
      });

      it("never fabricates a seed for a blob with no recentlyShownIds history", () => {
        const migrated = persistenceCapture.migrate?.({}, 1) as {
          deliveredLocalByOwner?: Record<string, Record<string, string>>;
        };
        expect(migrated.deliveredLocalByOwner).toEqual({ anonymous: {} });
      });

      // P4-S5b-FIX (Round 3) NEW: a genuine version-2 blob — P4-S5b's own
      // shipped shape, a flat top-level `deliveredLocal` map with real
      // entries from actual prior usage — migrates wholesale into the
      // anonymous namespace (never a real signed-in user's own, since this
      // device's storage never recorded WHICH account was signed in when
      // each entry was written; see migrate's own comment in feed.ts).
      it("migrates a legacy FLAT v2 deliveredLocal map into the anonymous namespace only, byte-for-byte", () => {
        const migrated = persistenceCapture.migrate?.(
          {
            deliveredLocal: {
              "paper-v2-a": "2026-01-01",
              "paper-v2-b": "2026-02-02",
            },
          },
          2,
        ) as {
          deliveredLocalByOwner?: Record<string, Record<string, string>>;
          deliveredLocalOwnerOrder?: string[];
          deliveredLocal?: unknown;
        };

        expect(migrated.deliveredLocalByOwner).toEqual({
          anonymous: {
            "paper-v2-a": "2026-01-01",
            "paper-v2-b": "2026-02-02",
          },
        });
        expect(migrated.deliveredLocalOwnerOrder).toEqual(["anonymous"]);
        // The old flat key is not left dangling on the migrated object.
        expect(migrated).not.toHaveProperty("deliveredLocal");
      });

      it("does not overwrite an already-present deliveredLocalByOwner (already migrated to v3, or a genuinely fresh version-3 blob)", () => {
        const migrated = persistenceCapture.migrate?.(
          {
            recentlyShownIds: { "paper-legacy-shown": Date.now() },
            deliveredLocal: { "paper-ignored": "2020-01-01" },
            deliveredLocalByOwner: {
              "user-a": { "paper-existing": "2026-01-01" },
            },
            deliveredLocalOwnerOrder: ["user-a"],
          },
          2,
        ) as {
          deliveredLocalByOwner?: Record<string, Record<string, string>>;
        };

        expect(migrated.deliveredLocalByOwner).toEqual({
          "user-a": { "paper-existing": "2026-01-01" },
        });
      });

      it("still performs the pre-existing oppFeedback split for a true legacy (version 0) blob, alongside the new anonymous seed step", () => {
        const ts = Date.parse("2026-01-01T00:00:00.000Z");
        const migrated = persistenceCapture.migrate?.(
          {
            oppFeedback: { "evt-1": "notInterested" },
            recentlyShownIds: { "paper-legacy": ts },
          },
          0,
        ) as {
          eventFeedback?: unknown;
          jobFeedback?: unknown;
          oppFeedback?: unknown;
          deliveredLocalByOwner?: Record<string, Record<string, string>>;
        };

        expect(migrated.eventFeedback).toEqual({ "evt-1": "notInterested" });
        expect(migrated.jobFeedback).toEqual({ "evt-1": "notInterested" });
        expect(migrated).not.toHaveProperty("oppFeedback");
        expect(migrated.deliveredLocalByOwner).toEqual({
          anonymous: { "paper-legacy": localCalendarDate(new Date(ts)) },
        });
      });
    });

    // P4-S5b-FIX2 (Round 3) — ABC-JEV-INTEGRATION.md §1g/§1c, closing the
    // auth-loading-window re-delivery risk found by
    // docs/jev-abc/P4-S5b-FIX-A-20260924T103406Z.md NEW FINDINGS #1:
    // `currentOwnerKey()` cannot tell "signed in, the auth check not resolved
    // yet" apart from "confirmed signed out" — both read as the "anonymous"
    // owner key, because `authUserId` is `null` in both cases until the auth
    // check settles.
    //
    // P4-S5b-FIX3 (Round 3) — ABC-JEV-INTEGRATION.md §4 "P4-S5b-FIX3 ruled
    // and assigned", closing two findings from fresh A's review of FIX2
    // (docs/jev-abc/P4-S5b-FIX2-A-20260924T111516Z.md): FIX2's `settled`-
    // only gate (a) had no bounded fallback and (b) could not tell a FAILED
    // profile pull apart from confirmed-signed-out either (`settled`
    // becomes `true` either way). FIX3 replaces the signal:
    // `authUserId`/`authOutcome` (this file's shared `beforeEach` above now
    // defaults `authOutcome` to `"signed-out"`, matching what every
    // pre-existing test in this file always implicitly assumed) are
    // published the moment the auth check ITSELF resolves — before the
    // profile pull even starts — so a real signed-in user's own bucket is
    // used correctly even while `settled` is still `false`, or ends up
    // `true` with a failed pull. The tests below that exercised FIX2's old
    // "unresolved" window are REWRITTEN (not deleted — each carries its own
    // P4-S5b-FIX3 comment) to the new contract; new tests cover cases
    // FIX2's simpler signal could not distinguish at all.
    describe("P4-S5b-FIX3: owner is known from the auth check itself, independent of the (possibly failed/hanging) profile pull", () => {
      it("P4-S5b-FIX3: profile pull FAILS after the auth check found user X — the load uses X's own bucket (not anonymous) for both read and arm, on the FIRST load (turns fresh A's PROBE-A around)", async () => {
        useFeedStore.setState({
          deliveredLocalByOwner: {
            "user-a": { "paper-already-seen": "2020-01-01" },
          },
          deliveredLocalOwnerOrder: ["user-a"],
        });
        // The auth check (getUser()) already confirmed user-a's id — FIX3
        // publishes this BEFORE the profile pull starts. The pull itself
        // then FAILS: `settled` becomes `true` (profile-sync.tsx's
        // `finally` always runs) and nothing is ever read back from it —
        // exactly fresh A's PROBE-A / NEW FINDING #2 scenario.
        useSyncGate.setState({
          settled: true,
          authUserId: "user-a",
          authOutcome: "signed-in",
        });

        enqueueResolved("/api/feed", paperFeedResponse("paper-new-for-a"));
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());
        await useFeedStore.getState().loadFeed();

        // READ: excluded on the very first load — no second load needed,
        // unlike FIX2's old behavior for this exact scenario.
        const request = JSON.parse(
          String((fetchMock.mock.calls[0]![1] as RequestInit).body),
        );
        expect(request.excludeIds).toContain("paper-already-seen");
        // ARM: the new paper is armed against user-a's own namespace, not
        // "anonymous" and not left un-armed.
        expect(useFeedStore.getState().pendingLocalDelivery).toEqual({
          ownerKey: "user-a",
          ids: ["paper-new-for-a"],
        });
        // Touch: user-a's namespace only — no "anonymous" entry appears
        // alongside it.
        expect(useFeedStore.getState().deliveredLocalByOwner).toEqual({
          "user-a": { "paper-already-seen": "2020-01-01" },
        });
        expect(useFeedStore.getState().deliveredLocalOwnerOrder).toEqual([
          "user-a",
        ]);
      });

      it("P4-S5b-FIX3: profile pull HANGS (settled never becomes true) — the load still uses X's own bucket, because resolveOwnerKeyForLoad no longer waits on settled once the auth id itself is known", async () => {
        useFeedStore.setState({
          deliveredLocalByOwner: {
            "user-a": { "paper-already-seen": "2020-01-01" },
          },
          deliveredLocalOwnerOrder: ["user-a"],
        });
        // Unlike the FAILS test above, `settled` stays false here — the
        // pull never finishes at all (a genuine hang, not a fast failure).
        // Same auth-check outcome either way: resolveOwnerKeyForLoad's
        // "authUserId known" branch never reads `settled`.
        useSyncGate.setState({
          settled: false,
          authUserId: "user-a",
          authOutcome: "signed-in",
        });

        enqueueResolved("/api/feed", paperFeedResponse("paper-new-for-a"));
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());
        await useFeedStore.getState().loadFeed();

        const request = JSON.parse(
          String((fetchMock.mock.calls[0]![1] as RequestInit).body),
        );
        expect(request.excludeIds).toContain("paper-already-seen");
        // Also arms correctly, same as the FAILS test above — settled's
        // value (false here, true there) makes no difference once
        // authUserId is known.
        expect(useFeedStore.getState().pendingLocalDelivery).toEqual({
          ownerKey: "user-a",
          ids: ["paper-new-for-a"],
        });
        expect(useFeedStore.getState().deliveredLocalByOwner).toEqual({
          "user-a": { "paper-already-seen": "2020-01-01" },
        });
      });

      it("P4-S5b-FIX3: getUser() REJECTS — unknown (union read, arms nothing), never anonymous (mutation-sensitive: a settled-only rule would stop at the anonymous bucket alone and would arm the response)", async () => {
        useFeedStore.setState({
          deliveredLocalByOwner: {
            anonymous: { "paper-old-anon": "2019-01-01" },
            "user-b": { "paper-b-seen": "2019-06-01" },
          },
          deliveredLocalOwnerOrder: ["anonymous", "user-b"],
        });
        // A rejected getUser() still settles (profile-sync.tsx's .catch()
        // calls markSyncSettled() unchanged), but authOutcome is never set
        // — it stays at its "unknown" default, overriding the shared
        // beforeEach's "signed-out" default (the point of this test).
        useSyncGate.setState({
          settled: true,
          authUserId: null,
          authOutcome: "unknown",
        });

        enqueueResolved("/api/feed", paperFeedResponse("paper-new"));
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());
        await useFeedStore.getState().loadFeed();

        const request = JSON.parse(
          String((fetchMock.mock.calls[0]![1] as RequestInit).body),
        );
        // UNION read: BOTH owners' history excluded, not just "anonymous"
        // (a settled-only rule would stop at "anonymous" alone and miss
        // user-b's).
        expect(request.excludeIds).toEqual(
          expect.arrayContaining(["paper-old-anon", "paper-b-seen"]),
        );
        // Arms NOTHING despite a paper being returned (a settled-only rule
        // would arm it into "anonymous").
        expect(useFeedStore.getState().pendingLocalDelivery).toBeNull();
        // Neither bucket is touched/written.
        expect(useFeedStore.getState().deliveredLocalByOwner).toEqual({
          anonymous: { "paper-old-anon": "2019-01-01" },
          "user-b": { "paper-b-seen": "2019-06-01" },
        });
        expect(useFeedStore.getState().deliveredLocalOwnerOrder).toEqual([
          "anonymous",
          "user-b",
        ]);
      });

      it("P4-S5b-FIX3: confirmed signed out — anonymous used normally, no added delay (this fix does not block genuine anonymous use)", async () => {
        useSyncGate.setState({
          settled: true,
          authUserId: null,
          authOutcome: "signed-out",
        });
        // authUserId: null (this file's beforeEach) + authOutcome:
        // "signed-out" is confirmed signed out, not "still loading".
        enqueueResolved("/api/feed", paperFeedResponse("paper-anon"));
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed();

        expect(useFeedStore.getState().pendingLocalDelivery).toEqual({
          ownerKey: "anonymous",
          ids: ["paper-anon"],
        });
        expect(useFeedStore.getState().deliveredLocalByOwner).toEqual({
          anonymous: {},
        });
      });

      // R3-CLEANUP-1 / F-A-P4S5bFIX3-2: the "Supabase auth not configured"
      // branch of resolveOwnerKeyForLoad (authOutcome "unconfigured" —
      // profile-sync.tsx's `!supabase` branch, feed.ts:329's
      // `|| auth.authOutcome === "unconfigured"`) had no dedicated test.
      // Modelled directly on the "confirmed signed out" test above, since
      // resolveOwnerKeyForLoad treats the two outcomes identically (one
      // `||`): the anonymous namespace is used normally, same as signed-out.
      it("P4-S5b-FIX3: Supabase auth not configured — anonymous used normally, same as confirmed signed out (R3-CLEANUP-1 / F-A-P4S5bFIX3-2)", async () => {
        useSyncGate.setState({
          settled: true,
          authUserId: null,
          authOutcome: "unconfigured",
        });
        // authUserId: null (this file's beforeEach) + authOutcome:
        // "unconfigured" means Supabase auth isn't configured at all in
        // this environment — resolveOwnerKeyForLoad treats this the same as
        // confirmed signed out, not "still loading".
        enqueueResolved("/api/feed", paperFeedResponse("paper-anon-unconfigured"));
        enqueueResolved("/api/events/feed", eventsFeedResponse());
        enqueueResolved("/api/jobs/feed", jobsFeedResponse());

        await useFeedStore.getState().loadFeed();

        expect(useFeedStore.getState().pendingLocalDelivery).toEqual({
          ownerKey: "anonymous",
          ids: ["paper-anon-unconfigured"],
        });
        expect(useFeedStore.getState().deliveredLocalByOwner).toEqual({
          anonymous: {},
        });
      });

      describe('unknown-owner union read (authOutcome genuinely "unknown" — the auth check itself has not resolved yet)', () => {
        it("P4-S5b-FIX3: ids from two different owners' buckets are BOTH excluded; nothing is armed or written", async () => {
          useFeedStore.setState({
            deliveredLocalByOwner: {
              "user-a": { "paper-a-seen": "2020-01-01" },
              anonymous: { "paper-anon-seen": "2019-06-01" },
            },
            deliveredLocalOwnerOrder: ["user-a", "anonymous"],
          });
          useSyncGate.setState({
            settled: false,
            authUserId: null,
            authOutcome: "unknown",
          });

          enqueueResolved("/api/feed", { items: [], meta: {} });
          enqueueResolved("/api/events/feed", eventsFeedResponse());
          enqueueResolved("/api/jobs/feed", jobsFeedResponse());
          await useFeedStore.getState().loadFeed();

          const request = JSON.parse(
            String((fetchMock.mock.calls[0]![1] as RequestInit).body),
          );
          expect(request.excludeIds).toEqual(
            expect.arrayContaining(["paper-a-seen", "paper-anon-seen"]),
          );
          // Nothing written: no MRU touch, no namespace created/reordered,
          // nothing armed.
          expect(useFeedStore.getState().deliveredLocalByOwner).toEqual({
            "user-a": { "paper-a-seen": "2020-01-01" },
            anonymous: { "paper-anon-seen": "2019-06-01" },
          });
          expect(useFeedStore.getState().deliveredLocalOwnerOrder).toEqual([
            "user-a",
            "anonymous",
          ]);
          expect(useFeedStore.getState().pendingLocalDelivery).toBeNull();
        });

        it("P4-S5b-FIX3: the union is capped at the existing 800-id send cap, most-recent-first, deterministic across owners", async () => {
          const dateDaysBefore = (n: number): string => {
            const d = new Date();
            d.setDate(d.getDate() - n);
            return localCalendarDate(d);
          };
          // 500 ids in owner A (the OLDER half of a 1000-day timeline: 1000
          // down to 501 days ago) and 500 in owner B (the NEWER half: 500
          // down to 1 day ago) — deliberately split across TWO owner
          // namespaces, all strictly before today, so the cap proves the
          // union is truncated AFTER merging every owner together, not
          // per-owner.
          const byOwnerA: Record<string, string> = {};
          const byOwnerB: Record<string, string> = {};
          for (let i = 0; i < 500; i++) {
            byOwnerA[`paper-old-${i}`] = dateDaysBefore(1000 - i);
          }
          for (let i = 0; i < 500; i++) {
            byOwnerB[`paper-new-${i}`] = dateDaysBefore(500 - i);
          }
          useFeedStore.setState({
            deliveredLocalByOwner: { "user-a": byOwnerA, "user-b": byOwnerB },
            deliveredLocalOwnerOrder: ["user-a", "user-b"],
          });
          useSyncGate.setState({
            settled: false,
            authUserId: null,
            authOutcome: "unknown",
          });

          enqueueResolved("/api/feed", { items: [], meta: {} });
          enqueueResolved("/api/events/feed", eventsFeedResponse());
          enqueueResolved("/api/jobs/feed", jobsFeedResponse());
          await useFeedStore.getState().loadFeed();

          const request = JSON.parse(
            String((fetchMock.mock.calls[0]![1] as RequestInit).body),
          );
          // Matches feed.ts's own DELIVERED_EXCLUDE_SEND_CAP (800) — kept
          // as a literal here, the same way the server's OWN independent
          // 800 in web/src/app/api/feed/route.ts's parseExcludeIds is (see
          // that function's own comment): the two are already kept in sync
          // by comment, not by a shared import, throughout this codebase.
          expect(request.excludeIds).toHaveLength(800);
          // Most-recent-first across the UNION: owner B's single most
          // recent id (1 day ago) must survive truncation...
          expect(request.excludeIds).toContain("paper-new-499");
          // ...while the globally-oldest id (owner A's earliest, 1000 days
          // ago) is unambiguously outside the most-recent 800 and is
          // dropped.
          expect(request.excludeIds).not.toContain("paper-old-0");
        });
      });

      describe("owner resolves after a premature (fallback-triggered) load", () => {
        it("P4-S5b-FIX3: a premature unknown-owner load followed by a corrective known-owner load ends in the correct state; the other owner's bucket is never written (reproduces page.tsx's PROBE-C mechanism at the store level — no component-test harness exists in this repo, see this slice's checkpoint)", async () => {
          useFeedStore.setState({
            deliveredLocalByOwner: {
              "user-other": { "paper-other-seen": "2020-01-01" },
            },
            deliveredLocalOwnerOrder: ["user-other"],
          });
          // Step 1 — mirrors page.tsx's bounded-fallback branch: the auth
          // outcome is still unknown when the auto-load effect's 4s
          // fallback fires, so it loads anyway with the unknown-owner rule.
          useSyncGate.setState({
            settled: false,
            authUserId: null,
            authOutcome: "unknown",
          });
          enqueueResolved("/api/feed", paperFeedResponse("paper-new"));
          enqueueResolved("/api/events/feed", eventsFeedResponse());
          enqueueResolved("/api/jobs/feed", jobsFeedResponse());
          await useFeedStore.getState().loadFeed({ lanes: ["papers"] });

          // The premature load used the unknown-owner union read
          // (user-other's history included) and armed nothing.
          const firstRequest = JSON.parse(
            String((fetchMock.mock.calls[0]![1] as RequestInit).body),
          );
          expect(firstRequest.excludeIds).toContain("paper-other-seen");
          expect(useFeedStore.getState().pendingLocalDelivery).toBeNull();
          expect(useFeedStore.getState().deliveredLocalByOwner).toEqual({
            "user-other": { "paper-other-seen": "2020-01-01" },
          });
          // This is the state fresh A's PROBE-C (docs/jev-abc/
          // P4-S5b-FIX2-A-20260924T111516Z.md) warned about: feedTopicsKey
          // now matches the active topics key, which would silently
          // suppress page.tsx's normal auto-load guard from ever re-firing.
          const profile = useProfileStore.getState().profile;
          expect(useFeedStore.getState().feedTopicsKey).toBe(
            activePaperTopicsKey(profile),
          );

          // Step 2 — auth resolves to a real, DIFFERENT owner. page.tsx's
          // corrective effect (the "trigger the correct-owner reload once
          // the owner becomes known" half of the P4-S5b-FIX3 ruling) calls
          // loadFeed again unconditionally on this transition, bypassing
          // the feedTopicsKey guard on purpose — reproduced directly here.
          signIn("user-me");
          enqueueResolved("/api/feed", { items: [], meta: {} });
          enqueueResolved("/api/events/feed", eventsFeedResponse());
          enqueueResolved("/api/jobs/feed", jobsFeedResponse());
          await useFeedStore.getState().loadFeed({ lanes: ["papers"] });

          const paperRequests = fetchMock.mock.calls.filter(
            ([input]) =>
              requestPath(input as string | URL | Request) === "/api/feed",
          );
          expect(paperRequests).toHaveLength(2);
          const secondRequest = JSON.parse(
            String((paperRequests[1]?.[1] as RequestInit).body),
          );
          // Now correctly scoped to user-me alone (empty — user-me has no
          // history yet), no longer carrying user-other's id via the union.
          expect(secondRequest.excludeIds ?? []).not.toContain(
            "paper-other-seen",
          );
          // user-other's own bucket was never written to by any of this.
          expect(
            useFeedStore.getState().deliveredLocalByOwner["user-other"],
          ).toEqual({ "paper-other-seen": "2020-01-01" });
          expect(useFeedStore.getState().deliveredLocalOwnerOrder).toEqual([
            "user-me",
            "user-other",
          ]);
        });
      });
    });
  });

  // DISLIKE-CHANNEL (ABC-JEV-INTEGRATION.md §1br,
  // docs/jev-abc/DISLIKE-CHANNEL-B-20260930T083933Z.md) — tripwire. The
  // investigation traced all 7 production "less of this" entry points
  // (Home grid button/swipe/key, Saved page dismiss, paper detail page
  // Skip/swipe/key) to this ONE store action — none of them has any
  // separate logic of its own, so pinning this action's write targets pins
  // every entry point at once. The point of this test: a reader's one-click
  // "less of this" must only ever teach the gradual, decaying preference
  // ledger — never the blunt, permanent `dislikedTopics`/exclusion-list
  // channel (see combine.ts's own doc comment on `exclusions` and
  // types/index.ts's on `dislikedTopics` for why: a plain substring hard
  // drop, with no decay and no concept scoping, would silently and
  // permanently remove unrelated on-topic papers sharing one common word —
  // measured by construction in the investigation's own Q3).
  describe("DISLIKE-CHANNEL (§1br) — notInterestedPaper writes only to the preference ledger", () => {
    const dismissedPaper: Paper = {
      id: "paper-dislike-tripwire",
      title: "Dismissal tripwire fixture paper",
      authors: ["Researcher"],
      relevanceReason: "Matches materials.",
      venue: "Example Journal",
      source: "other",
      summaryIntro: "Intro.",
      // Deliberately unrelated to the outer beforeEach's own
      // researchTopics (["materials"]) so the ledger's Required-topic
      // protection (applyPreferenceSignal, "dismissing your own declared
      // topic never teaches the ledger to avoid it") does not swallow this
      // signal and produce a false pass.
      summaryExperimentKeywords: ["tripwire probe concept"],
      summaryResultDiscussion: "Result.",
      isSaved: false,
    };

    it("commits the ledger's own gradual negative signal and never touches dislikedTopics or any exclusion list", () => {
      fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
      expect(useProfileStore.getState().profile.dislikedTopics).toEqual([]);

      // notInterestedPaper + commitDismiss reproduce the real trace exactly
      // (store/feed.ts:2327/2857): the 4-second undo window is a UI-layer
      // timer, not something the store itself waits on, so calling
      // commitDismiss directly is the same "the undo window closed" state
      // a real dismissal reaches, deterministically.
      useFeedStore.getState().notInterestedPaper(dismissedPaper);
      useFeedStore.getState().commitDismiss();

      // Never wired to the hard-exclusion channel.
      expect(useProfileStore.getState().profile.dislikedTopics).toEqual([]);

      // DID reach the preference ledger — so the assertion above is a real
      // "never", not merely "nothing happened at all".
      const ledger = useProfileStore.getState().profile.preferenceLedger ?? {};
      const entries = Object.values(ledger);
      expect(entries.length).toBeGreaterThan(0);
      expect(
        entries.some((entry) => entry.negative > 0 && Boolean(entry.lastNegativeAt)),
      ).toBe(true);
    });

    // MUTATION CHECK (DISLIKE-CHANNEL §1br): if notInterestedPaper (or
    // commitDismiss) is ever changed to also append the dismissed paper's
    // own concept to `dislikedTopics`, this test goes red. Verified by
    // temporarily making that exact change and re-running this file; not
    // committed here (see this item's checkpoint for the restore proof).
  });
});
