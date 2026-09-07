import { describe, expect, it } from "vitest";
import { briefingDeck, joinTopics, numberWord } from "./deck";

const text = (segments: { text: string }[]) => segments.map((s) => s.text).join("");

describe("numberWord", () => {
  it("spells zero to ten and leaves the rest as digits", () => {
    expect(numberWord(0)).toBe("no");
    expect(numberWord(1)).toBe("one");
    expect(numberWord(10)).toBe("ten");
    expect(numberWord(11)).toBe("11");
  });
});

describe("joinTopics", () => {
  it("reads as prose for one, two and three topics", () => {
    expect(joinTopics(["diffusion models"])).toBe("diffusion models");
    expect(joinTopics(["diffusion models", "protein structure prediction"])).toBe(
      "diffusion models and protein structure prediction",
    );
    expect(joinTopics(["a", "b", "c"])).toBe("a, b and c");
    expect(joinTopics([" ", ""])).toBe("");
  });
});

describe("briefingDeck", () => {
  const topics = ["diffusion models", "protein structure prediction"];

  it("states the count, the topics and the unread phrase in ink", () => {
    const deck = briefingDeck({ total: 10, unread: 9, topics, loading: false });
    expect(text(deck)).toBe(
      "Ten papers on diffusion models and protein structure prediction — nine unread.",
    );
    expect(deck.find((s) => s.tone === "heading")?.text).toBe("nine unread");
  });

  it("closes the briefing when everything is read", () => {
    expect(text(briefingDeck({ total: 5, unread: 0, topics: [], loading: false }))).toBe(
      "Five papers — all read, back tomorrow.",
    );
  });

  it("handles one paper and no topics", () => {
    expect(text(briefingDeck({ total: 1, unread: 1, topics: [], loading: false }))).toBe(
      "One paper — one unread.",
    );
  });

  it("names what it is looking for while the day loads, and says nothing otherwise", () => {
    expect(text(briefingDeck({ total: 0, unread: 0, topics, loading: true }))).toBe(
      "Looking for today's papers on diffusion models and protein structure prediction.",
    );
    expect(briefingDeck({ total: 0, unread: 0, topics, loading: false })).toEqual([]);
  });
});
