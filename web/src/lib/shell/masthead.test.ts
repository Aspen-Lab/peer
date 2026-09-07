import { describe, expect, it } from "vitest";
import { NONE } from "@/lib/navigation/card-focus";
import {
  SHELL_LINKS,
  THUMB_TABS,
  dayLine,
  isActiveLink,
  mastheadCentre,
  paperIdFromPathname,
  railHasPosition,
  searchKeyTarget,
  shellRoute,
  thumbBarMode,
} from "./masthead";

// 2026-09-06 is a Sunday; noon so no timezone lands it on another day.
const SUNDAY = new Date(2026, 8, 6, 12);
const papers = [{ id: "arxiv:1" }, { id: "arxiv:2" }, { id: "openalex:W3" }];

describe("shellRoute", () => {
  it("names every route the shell distinguishes", () => {
    expect(shellRoute("/")).toBe("briefing");
    expect(shellRoute("/welcome")).toBe("welcome");
    expect(shellRoute("/papers/arxiv:1")).toBe("paper");
    expect(shellRoute("/search")).toBe("search");
    expect(shellRoute("/search/")).toBe("search");
    expect(shellRoute("/saved")).toBe("saved");
    expect(shellRoute("/profile")).toBe("profile");
  });

  it("does not mistake a prefix for a route", () => {
    expect(shellRoute("/searching")).toBe("other");
    expect(shellRoute("/savedx")).toBe("other");
    expect(shellRoute("/changelog")).toBe("other");
    expect(shellRoute(null)).toBe("other");
  });
});

describe("paperIdFromPathname", () => {
  it("decodes the id the way the page does", () => {
    expect(paperIdFromPathname("/papers/openalex%3AW7208807247")).toBe(
      "openalex:W7208807247",
    );
    expect(paperIdFromPathname("/papers/arxiv:2401.1")).toBe("arxiv:2401.1");
  });

  it("is null off the reading route", () => {
    expect(paperIdFromPathname("/")).toBeNull();
    expect(paperIdFromPathname("/papers/")).toBeNull();
    expect(paperIdFromPathname(undefined)).toBeNull();
  });
});

describe("the centre cell", () => {
  it("states the day in a fixed locale", () => {
    expect(dayLine(SUNDAY)).toBe("Sunday, September 6");
  });

  it("is empty on the briefing — the page carries the day", () => {
    // The dateline and the deck are the page's own front (BriefingHead);
    // stating the day again in 13.5px above them was the small print the
    // founder objected to.
    expect(mastheadCentre("briefing", { pathname: "/", papers })).toEqual({ kind: "empty" });
  });

  it("is the rail on a paper, positioned by the briefing's order", () => {
    const centre = mastheadCentre("paper", { pathname: "/papers/arxiv%3A2", papers });
    expect(centre).toEqual({
      kind: "rail",
      nav: { index: 1, total: 3, prevId: "arxiv:1", nextId: "openalex:W3" },
    });
    if (centre.kind === "rail") expect(railHasPosition(centre.nav)).toBe(true);
  });

  it("is the way back alone on a deep link", () => {
    const centre = mastheadCentre("paper", { pathname: "/papers/arxiv:9", papers });
    expect(centre.kind).toBe("rail");
    if (centre.kind === "rail") {
      expect(centre.nav.index).toBe(NONE);
      expect(railHasPosition(centre.nav)).toBe(false);
    }
  });

  it("is empty on search, saved and profile", () => {
    for (const route of ["search", "saved", "profile", "other"] as const) {
      expect(mastheadCentre(route, { pathname: `/${route}`, papers })).toEqual({ kind: "empty" });
    }
  });
});

describe("the right cell", () => {
  it("lights the current page's word and no other", () => {
    expect(SHELL_LINKS.map((l) => l.label)).toEqual(["Search", "Saved", "Profile"]);
    expect(SHELL_LINKS.filter((l) => isActiveLink(l, "saved")).map((l) => l.label)).toEqual([
      "Saved",
    ]);
    expect(SHELL_LINKS.some((l) => isActiveLink(l, "briefing"))).toBe(false);
    expect(SHELL_LINKS.some((l) => isActiveLink(l, "paper"))).toBe(false);
  });
});

describe("the thumb bar", () => {
  it("has four cells, Today first", () => {
    expect(THUMB_TABS.map((t) => t.label)).toEqual(["Today", "Search", "Saved", "You"]);
    expect(THUMB_TABS.filter((t) => isActiveLink(t, "briefing")).map((t) => t.label)).toEqual([
      "Today",
    ]);
  });

  it("is the rail on a paper, the tabs elsewhere, nothing on /welcome", () => {
    expect(thumbBarMode("paper")).toBe("rail");
    expect(thumbBarMode("briefing")).toBe("tabs");
    expect(thumbBarMode("search")).toBe("tabs");
    expect(thumbBarMode("other")).toBe("tabs");
    expect(thumbBarMode("welcome")).toBe("none");
  });
});

describe("the / key", () => {
  it("focuses the box on Search and goes to Search from anywhere else", () => {
    expect(searchKeyTarget("/search", true)).toEqual({ action: "focus" });
    expect(searchKeyTarget("/", false)).toEqual({ action: "push", href: "/search" });
    expect(searchKeyTarget("/papers/arxiv:1", false)).toEqual({ action: "push", href: "/search" });
  });

  it("navigates rather than focusing a box that is not there", () => {
    expect(searchKeyTarget("/search", false)).toEqual({ action: "push", href: "/search" });
  });
});
