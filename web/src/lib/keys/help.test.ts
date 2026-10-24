import { describe, expect, it } from "vitest";
import { PAPER_KEYS } from "@/lib/reader/reader-keys";
import { helpGroups } from "./help";

describe("helpGroups", () => {
  const groups = helpGroups();
  const allItems = groups.flatMap((g) => g.items);

  it("has the four groups in the order the day is used", () => {
    expect(groups.map((g) => g.title)).toEqual(["Anywhere", "Navigate", "Briefing", "Reading"]);
  });

  it("writes every heading in sentence case", () => {
    for (const { title } of groups) {
      expect(title).toBe(title[0].toUpperCase() + title.slice(1).toLowerCase());
    }
  });

  it("has no sidebar to toggle and no View group", () => {
    expect(groups.some((g) => g.title === "View")).toBe(false);
    expect(allItems.some((i) => i.keys.includes("\\"))).toBe(false);
  });

  it("lists / as Search under Anywhere, which it now is", () => {
    const anywhere = groups.find((g) => g.title === "Anywhere");
    expect(anywhere?.items.find((i) => i.keys === "/")?.label).toBe("Search");
  });

  it("takes the Reading group from the reading page's own table", () => {
    const reading = groups.find((g) => g.title === "Reading");
    expect(reading?.items).toHaveLength(PAPER_KEYS.length);
    expect(reading?.items.map((i) => i.label)).toEqual(PAPER_KEYS.map((e) => e.label));
  });

  // P11-13 (rule 3): n and h are the selection's keys on the reading page.
  it("lists the selection's keys under Reading: n to take notes, h to highlight, e to explain", () => {
    const reading = groups.find((g) => g.title === "Reading")!;
    expect(reading.items).toContainEqual({ keys: "n", label: "Take notes on the selected passage" });
    expect(reading.items).toContainEqual({ keys: "h", label: "Highlight the selected passage" });
    expect(reading.items).toContainEqual({ keys: "e", label: "Explain the selected passage" });
  });

  it("names no key twice within a group", () => {
    for (const group of groups) {
      const keys = group.items.map((i) => i.keys);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
