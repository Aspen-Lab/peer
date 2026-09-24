import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("keeps Peer's own type sizes beside a text colour", () => {
    // tailwind-merge reads an unknown `text-*` as a colour, so without the
    // registration in cn.ts the size is dropped when a colour follows it.
    expect(cn("text-caption font-medium text-accent", "text-text-muted")).toBe("text-caption font-medium text-text-muted");
    expect(cn("paper-line text-display-xs leading-[1.3] text-heading", "block")).toBe(
      "paper-line text-display-xs leading-[1.3] text-heading block",
    );
    expect(cn("text-display sm:text-display-lg text-heading")).toBe("text-display sm:text-display-lg text-heading");
  });

  it("still lets a later size win over an earlier one", () => {
    expect(cn("text-display-xs", "text-display-sm")).toBe("text-display-sm");
    expect(cn("text-body", "text-title")).toBe("text-title");
  });
});
