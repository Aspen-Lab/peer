import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, Job } from "@/types";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/store/profile", () => ({
  useProfileStore: {
    getState: () => ({
      recordEventPreference: vi.fn(),
      recordJobPreference: vi.fn(),
    }),
  },
}));

import { useFeedStore } from "./feed";

function eventFixture(id: string, relevanceScore: number): Event {
  return {
    id,
    name: `Event ${id}`,
    type: "conference",
    date: "2026-09-10",
    location: "Chicago, IL",
    isOnline: false,
    shortDescription: "A focused battery research event.",
    relevanceReason: "Matches the user's battery research topics.",
    relevanceScore,
  };
}

function jobFixture(id: string, relevanceScore: number): Job {
  return {
    id,
    roleTitle: `Researcher ${id}`,
    companyOrLab: "Battery Lab",
    location: "Chicago, IL",
    isRemote: false,
    keyRequirements: ["Electrochemistry"],
    matchReason: "Matches the user's battery research topics.",
    relevanceScore,
  };
}

function resetOpportunityState() {
  useFeedStore.setState({
    events: [],
    eventPool: [],
    savedEvents: [],
    jobs: [],
    jobPool: [],
    savedJobs: [],
    eventFeedback: {},
    jobFeedback: {},
    pendingDismissal: null,
  });
}

describe("feed opportunity pools", () => {
  beforeEach(() => {
    resetOpportunityState();
  });

  it("restores a pool-only event without injecting it into the displayed events", () => {
    const displayed = eventFixture("event:displayed", 90);
    const poolOnly = eventFixture("event:pool-only", 70);
    useFeedStore.setState({
      events: [displayed],
      eventPool: [displayed, poolOnly],
    });

    useFeedStore.getState().notInterestedEvent(poolOnly);
    expect(useFeedStore.getState().events.map(({ id }) => id)).toEqual([
      displayed.id,
    ]);
    expect(useFeedStore.getState().eventPool.map(({ id }) => id)).toEqual([
      displayed.id,
    ]);

    useFeedStore.getState().undoDismiss();
    const restored = useFeedStore.getState();
    expect(restored.events.map(({ id }) => id)).toEqual([displayed.id]);
    expect(restored.eventPool.map(({ id }) => id)).toEqual([
      displayed.id,
      poolOnly.id,
    ]);
    expect(restored.eventFeedback[poolOnly.id]).toBeUndefined();
  });

  it("restores a pool-only job without injecting it into the displayed jobs", () => {
    const displayed = jobFixture("job:displayed", 90);
    const poolOnly = jobFixture("job:pool-only", 70);
    useFeedStore.setState({
      jobs: [displayed],
      jobPool: [displayed, poolOnly],
    });

    useFeedStore.getState().notInterestedJob(poolOnly);
    expect(useFeedStore.getState().jobs.map(({ id }) => id)).toEqual([
      displayed.id,
    ]);
    expect(useFeedStore.getState().jobPool.map(({ id }) => id)).toEqual([
      displayed.id,
    ]);

    useFeedStore.getState().undoDismiss();
    const restored = useFeedStore.getState();
    expect(restored.jobs.map(({ id }) => id)).toEqual([displayed.id]);
    expect(restored.jobPool.map(({ id }) => id)).toEqual([
      displayed.id,
      poolOnly.id,
    ]);
    expect(restored.jobFeedback[poolOnly.id]).toBeUndefined();
  });

  it("restores a dismissed saved event only to its original collections", () => {
    const saved = {
      ...eventFixture("event:saved", 80),
      isSaved: true,
      feedback: "saved" as const,
    };
    useFeedStore.setState({
      eventPool: [saved],
      savedEvents: [saved],
      eventFeedback: { [saved.id]: "saved" },
    });

    useFeedStore.getState().notInterestedEvent(saved);
    expect(useFeedStore.getState().eventPool).toEqual([]);
    expect(useFeedStore.getState().savedEvents).toEqual([]);

    useFeedStore.getState().undoDismiss();
    const restored = useFeedStore.getState();
    expect(restored.events).toEqual([]);
    expect(restored.eventPool.map(({ id }) => id)).toEqual([saved.id]);
    expect(restored.savedEvents.map(({ id }) => id)).toEqual([saved.id]);
    expect(restored.eventFeedback[saved.id]).toBe("saved");
  });

  it("restores a dismissed saved job only to its original collections", () => {
    const saved = {
      ...jobFixture("job:saved", 80),
      isSaved: true,
      feedback: "saved" as const,
    };
    useFeedStore.setState({
      jobPool: [saved],
      savedJobs: [saved],
      jobFeedback: { [saved.id]: "saved" },
    });

    useFeedStore.getState().notInterestedJob(saved);
    expect(useFeedStore.getState().jobPool).toEqual([]);
    expect(useFeedStore.getState().savedJobs).toEqual([]);

    useFeedStore.getState().undoDismiss();
    const restored = useFeedStore.getState();
    expect(restored.jobs).toEqual([]);
    expect(restored.jobPool.map(({ id }) => id)).toEqual([saved.id]);
    expect(restored.savedJobs.map(({ id }) => id)).toEqual([saved.id]);
    expect(restored.jobFeedback[saved.id]).toBe("saved");
  });

  it("keeps save, more-like, and unsave state aligned across event collections", () => {
    const event = eventFixture("event:actions", 85);
    useFeedStore.setState({
      events: [event],
      eventPool: [event],
    });

    useFeedStore.getState().saveEvent(event);
    let state = useFeedStore.getState();
    expect(state.events[0]).toMatchObject({
      isSaved: true,
      feedback: "saved",
    });
    expect(state.eventPool[0]).toMatchObject({
      isSaved: true,
      feedback: "saved",
    });
    expect(state.savedEvents).toHaveLength(1);
    expect(state.savedEvents[0]).toMatchObject({
      isSaved: true,
      feedback: "saved",
    });

    useFeedStore.getState().moreLikeEvent(event);
    state = useFeedStore.getState();
    expect(state.events[0].feedback).toBe("moreLikeThis");
    expect(state.eventPool[0].feedback).toBe("moreLikeThis");
    expect(state.savedEvents[0].feedback).toBe("moreLikeThis");

    useFeedStore.getState().unsaveEvent(event.id);
    state = useFeedStore.getState();
    expect(state.events[0]).toMatchObject({
      isSaved: false,
      feedback: "moreLikeThis",
    });
    expect(state.eventPool[0]).toMatchObject({
      isSaved: false,
      feedback: "moreLikeThis",
    });
    expect(state.savedEvents).toEqual([]);
    expect(state.eventFeedback[event.id]).toBe("moreLikeThis");
  });

  it("keeps save, more-like, and unsave state aligned across job collections", () => {
    const job = jobFixture("job:actions", 85);
    useFeedStore.setState({
      jobs: [job],
      jobPool: [job],
    });

    useFeedStore.getState().saveJob(job);
    let state = useFeedStore.getState();
    expect(state.jobs[0]).toMatchObject({
      isSaved: true,
      feedback: "saved",
    });
    expect(state.jobPool[0]).toMatchObject({
      isSaved: true,
      feedback: "saved",
    });
    expect(state.savedJobs).toHaveLength(1);
    expect(state.savedJobs[0]).toMatchObject({
      isSaved: true,
      feedback: "saved",
    });

    useFeedStore.getState().moreLikeJob(job);
    state = useFeedStore.getState();
    expect(state.jobs[0].feedback).toBe("moreLikeThis");
    expect(state.jobPool[0].feedback).toBe("moreLikeThis");
    expect(state.savedJobs[0].feedback).toBe("moreLikeThis");

    useFeedStore.getState().unsaveJob(job.id);
    state = useFeedStore.getState();
    expect(state.jobs[0]).toMatchObject({
      isSaved: false,
      feedback: "moreLikeThis",
    });
    expect(state.jobPool[0]).toMatchObject({
      isSaved: false,
      feedback: "moreLikeThis",
    });
    expect(state.savedJobs).toEqual([]);
    expect(state.jobFeedback[job.id]).toBe("moreLikeThis");
  });

  it("persists and clears independent interested states for events and jobs", () => {
    const event = eventFixture("event:feedback", 82);
    const job = jobFixture("job:feedback", 81);
    useFeedStore.setState({
      events: [event],
      eventPool: [event],
      jobs: [job],
      jobPool: [job],
    });

    useFeedStore.getState().moreLikeEvent(event);
    useFeedStore.getState().moreLikeJob(job);
    let state = useFeedStore.getState();
    expect(state.eventFeedback[event.id]).toBe("moreLikeThis");
    expect(state.jobFeedback[job.id]).toBe("moreLikeThis");

    useFeedStore.getState().notInterestedEvent(event);
    useFeedStore.getState().notInterestedJob(job);
    state = useFeedStore.getState();
    expect(state.eventFeedback[event.id]).toBe("notInterested");
    expect(state.jobFeedback[job.id]).toBe("notInterested");

    useFeedStore.getState().resetLocal();
    state = useFeedStore.getState();
    expect(state.eventFeedback).toEqual({});
    expect(state.jobFeedback).toEqual({});
  });

  it("hydrates remote save state into the displayed slice and full pool", () => {
    const event = eventFixture("event:remote-save", 84);
    const job = jobFixture("job:remote-save", 83);
    useFeedStore.setState({
      events: [event],
      eventPool: [event],
      jobs: [job],
      jobPool: [job],
    });

    useFeedStore.getState().hydrateFromRemote({
      savedEvents: [event],
      savedJobs: [job],
    });
    const state = useFeedStore.getState();
    expect(state.events[0].isSaved).toBe(true);
    expect(state.eventPool[0].isSaved).toBe(true);
    expect(state.jobs[0].isSaved).toBe(true);
    expect(state.jobPool[0].isSaved).toBe(true);
  });

  // SIGNIN-MERGE (ABC-JEV-INTEGRATION.md §1af/§1aj, ruling P2) — rewritten,
  // not deleted: this test used to hydrate save state in, then hydrate a
  // SECOND, empty remote snapshot in and assert the item went back to
  // isSaved: false. That was the old "replace" behaviour P2 overturns —
  // "saved papers / reading history / feedback: always union, never
  // replace — mandatory." A later pull reporting the account has zero
  // saved events/jobs is now treated the same as any other pull result:
  // it can only ADD to what is locally saved, never take away an item this
  // device already holds as saved (see store/feed.ts's `unionById` and
  // `hydrateFromRemote`'s own doc comment for the full reasoning and the
  // trade-off this accepts — an unsave made on a different device no
  // longer reaches this device via this path).
  it("a later pull reporting zero saved events/jobs does not un-save an item this device already holds as saved (SIGNIN-MERGE §1aj P2)", () => {
    const event = eventFixture("event:remote-save", 84);
    const job = jobFixture("job:remote-save", 83);
    useFeedStore.setState({
      events: [event],
      eventPool: [event],
      jobs: [job],
      jobPool: [job],
    });

    useFeedStore.getState().hydrateFromRemote({
      savedEvents: [event],
      savedJobs: [job],
    });
    useFeedStore.getState().hydrateFromRemote({
      savedEvents: [],
      savedJobs: [],
    });
    const state = useFeedStore.getState();
    expect(state.events[0].isSaved).toBe(true);
    expect(state.eventPool[0].isSaved).toBe(true);
    expect(state.jobs[0].isSaved).toBe(true);
    expect(state.jobPool[0].isSaved).toBe(true);
  });
});
