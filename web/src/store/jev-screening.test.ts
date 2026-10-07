import { beforeEach, describe, expect, it } from "vitest";
import { defaultProfile } from "@/types";
import { useProfileStore } from "./profile";
import { useJevScreeningStore } from "./jev-screening";

// What Jev did the last time a briefing was built, kept in this browser so the
// Profile row can say so. Counts and one status word, nothing else. It describes
// ONE key: it is cleared when a key that was set is replaced or removed (or the
// reader signs out, which resets the profile), and it is not cleared when the
// profile merely rehydrates (the key appearing from empty).

const KEY = "jev-screening-store-test-not-a-key-0000";
const OTHER_KEY = "jev-screening-store-test-other-not-a-key-1111";

beforeEach(() => {
  useProfileStore.setState({ profile: { ...defaultProfile } });
  useJevScreeningStore.setState({ report: null });
});

describe("the last Jev screening report", () => {
  it("starts empty", () => {
    expect(useJevScreeningStore.getState().report).toBeNull();
  });

  it("records what a briefing reported, exactly", () => {
    useJevScreeningStore.getState().record({ status: "partial", screened: 31, of: 50 });
    expect(useJevScreeningStore.getState().report).toEqual({ status: "partial", screened: 31, of: 50 });
  });

  it("keeps only the three fields it was meant to: a response with extra fields cannot smuggle anything in", () => {
    useJevScreeningStore
      .getState()
      .record({ status: "applied", screened: 5, of: 5, apiKey: KEY, note: "x" } as never);
    expect(useJevScreeningStore.getState().report).toEqual({ status: "applied", screened: 5, of: 5 });
    expect(JSON.stringify(useJevScreeningStore.getState())).not.toContain(KEY);
  });

  it("ignores a malformed report rather than storing it", () => {
    useJevScreeningStore.getState().record({ status: "applied", screened: 5, of: 5 });
    useJevScreeningStore.getState().record({ status: "bogus", screened: 5, of: 5 } as never);
    useJevScreeningStore.getState().record({ status: "applied", screened: "5", of: 5 } as never);
    useJevScreeningStore.getState().record({ status: "applied", screened: -1, of: 5 } as never);
    useJevScreeningStore.getState().record(null as never);
    expect(useJevScreeningStore.getState().report).toEqual({ status: "applied", screened: 5, of: 5 });
  });

  it("clear() forgets it", () => {
    useJevScreeningStore.getState().record({ status: "rejected", screened: 0, of: 50 });
    useJevScreeningStore.getState().clear();
    expect(useJevScreeningStore.getState().report).toBeNull();
  });
});

describe("it describes one key", () => {
  it("is cleared when the key that was set is removed", () => {
    useProfileStore.getState().updateJevApiKey(KEY);
    useJevScreeningStore.getState().record({ status: "applied", screened: 50, of: 50 });

    useProfileStore.getState().updateJevApiKey("");

    expect(useJevScreeningStore.getState().report).toBeNull();
  });

  it("is cleared when the key that was set is replaced by another", () => {
    useProfileStore.getState().updateJevApiKey(KEY);
    useJevScreeningStore.getState().record({ status: "rejected", screened: 0, of: 50 });

    useProfileStore.getState().updateJevApiKey(OTHER_KEY);

    expect(useJevScreeningStore.getState().report).toBeNull();
  });

  it("is cleared by a confirmed sign-out, which resets the profile and its key", () => {
    useProfileStore.getState().updateJevApiKey(KEY);
    useJevScreeningStore.getState().record({ status: "applied", screened: 50, of: 50 });

    useProfileStore.getState().logOut();

    expect(useJevScreeningStore.getState().report).toBeNull();
  });

  it("is NOT cleared when the profile rehydrates and the key appears from nothing (a reload keeps the last report)", () => {
    useJevScreeningStore.getState().record({ status: "applied", screened: 50, of: 50 });

    useProfileStore.setState({ profile: { ...defaultProfile, jevApiKey: KEY } });

    expect(useJevScreeningStore.getState().report).toEqual({ status: "applied", screened: 50, of: 50 });
  });

  it("is NOT cleared by an edit of something else", () => {
    useProfileStore.getState().updateJevApiKey(KEY);
    useJevScreeningStore.getState().record({ status: "applied", screened: 50, of: 50 });

    useProfileStore.getState().updateCurrentProject("a new project");

    expect(useJevScreeningStore.getState().report).toEqual({ status: "applied", screened: 50, of: 50 });
  });
});
