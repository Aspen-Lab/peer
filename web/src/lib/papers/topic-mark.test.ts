import { describe, expect, it } from "vitest";
import { topicMarkOf } from "./topic-mark";

const key = (title: string, rest: Partial<Parameters<typeof topicMarkOf>[0]> = {}) =>
  topicMarkOf({ title, ...rest }).key;

describe("the mark a paper gets", () => {
  // Every title here is from one real briefing — the ten cards of
  // 2026-09-21, all of them about machine learning. If the mark only ever
  // said "machine learning" the board would be ten identical stamps.
  it("sorts one day's briefing by what the papers are actually about", () => {
    expect(key("Machine Learning for Agricultural Application")).toBe("earth");
    expect(key("Plant Disease Detection Using Machine Learning, Deep Learning, and Metaheuristics")).toBe("earth");
    expect(key("Nuclear Transport With Machine Learning")).toBe("matter");
    expect(key("Machine Learning in Marketing and Consumer Behaviour")).toBe("market");
    expect(key("Topology-Driven Machine Learning")).toBe("geometry");
    expect(key("A First Course in Machine Learning")).toBe("primer");
    expect(key("Introduction to artificial intelligence and machine learning")).toBe("primer");
    expect(key("Machine Learning: Principles and Techniques")).toBe("primer");
    expect(key("4749 Machine Learning Tools")).toBe("tool");
    expect(key("Applications of Machine Learning")).toBe("model");
  });

  it("puts the subject before the method", () => {
    // Both of these are neural-network papers. Neither is *about* neural
    // networks, and the mark that says so is the one worth drawing.
    expect(key("A deep learning model for protein structure prediction")).toBe("life");
    expect(key("Neural networks for turbulent fluid simulation")).toBe("matter");
  });

  it("puts the subject before the genre", () => {
    // "Review" is true of it; "medical imaging" is what it is.
    expect(key("A review of deep learning in medical imaging")).toBe("life");
  });

  it("reads the record when the title says nothing", () => {
    expect(key("Attention Is All You Need")).toBe("language");
    expect(key("SUBnet-9: results", { terms: ["Adversarial attack"] })).toBe("shield");
    expect(key("An untitled record", { terms: ["Image segmentation"] })).toBe("vision");
  });

  it("never reads the publisher as the subject", () => {
    // Half of one real briefing came back "Physical sciences" because Zenodo
    // is run by CERN. A venue is not a subject, and is not read at all.
    expect(key("A First Course in Machine Learning")).toBe("primer");
    expect(key("Applications of Machine Learning")).toBe("model");
  });

  it("says nothing rather than guessing", () => {
    expect(key("")).toBe("paper");
    expect(key("On the matter of things")).toBe("paper");
  });

  it("is stable: the same paper always takes the same mark", () => {
    const paper = { title: "Machine Learning for Agricultural Application" };
    expect(topicMarkOf(paper)).toEqual(topicMarkOf(paper));
  });

  it("carries a label for every mark it returns", () => {
    for (const title of ["Crop yield", "protein folding", "quantum", "", "market prices"]) {
      expect(topicMarkOf({ title }).label.length).toBeGreaterThan(0);
    }
  });
});
