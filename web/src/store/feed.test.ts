import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const persistenceCapture = vi.hoisted(() => ({
  partialize: undefined as ((state: unknown) => unknown) | undefined,
}));

vi.mock("zustand/middleware", () => ({
  persist: (
    initializer: unknown,
    options?: { partialize?: (state: unknown) => unknown },
  ) => {
    persistenceCapture.partialize = options?.partialize;
    return initializer;
  },
}));

import { defaultProfile, type Event, type Job } from "@/types";
import { useFeedStore } from "@/store/feed";
import { useProfileStore } from "@/store/profile";

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
      feedTopicsKey: "materials",
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
    expect(
      JSON.parse(String((paperRequests[0]?.[1] as RequestInit).body)),
    ).toMatchObject({
      excludeIds: ["paper-already-seen"],
    });
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
});
