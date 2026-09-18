import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "@/types";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/store/profile", () => ({
  useProfileStore: { getState: () => ({}) },
}));

import { useFeedStore } from "./feed";

const paper: Paper = {
  id: "openalex:W1",
  title: "Diffusion models for protein folding",
  authors: [],
  relevanceReason: "",
  venue: "Venue",
  source: "other",
  summaryIntro: "We apply diffusion models to protein folding.",
  summaryExperimentKeywords: ["diffusion models"],
  summaryResultDiscussion: "",
  isSaved: false,
};

describe("the reading record", () => {
  beforeEach(() => {
    useFeedStore.getState().resetLocal();
  });

  it("is written as one record: the flag, the day and the library entry", () => {
    useFeedStore.getState().markRead(paper.id, paper);
    const s = useFeedStore.getState();
    expect(s.readItems[paper.id]).toBe(true);
    expect(s.readAt[paper.id]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.library[paper.id]?.title).toBe(paper.title);
  });

  it("is cleared whole by the reset, with the account mark", () => {
    // A real sign-out must leave nothing of the last account's reading
    // behind. `readAt` and `library` used to survive it.
    const store = useFeedStore.getState();
    store.markRead(paper.id, paper);
    store.setSyncedUserId("user-a");
    useFeedStore.getState().resetLocal();
    const s = useFeedStore.getState();
    expect(s.readItems).toEqual({});
    expect(s.readAt).toEqual({});
    expect(s.library).toEqual({});
    expect(s.syncedUserId).toBeNull();
  });
});
