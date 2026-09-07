import { describe, expect, it } from "vitest";
import { shortVenue } from "./feed-tile";

describe("shortVenue", () => {
  it("drops the host institution OpenAlex appends in brackets", () => {
    // The real string that broke the card: at column width it truncated to
    // "ZENODO (CERN EUROPEAN ORGANIZATION FOR NUC…" and pushed the published
    // date off the end of the line.
    expect(
      shortVenue("Zenodo (CERN European Organization for Nuclear Research)"),
    ).toBe("Zenodo");
    expect(
      shortVenue("HAL (Le Centre pour la Communication Scientifique Directe)"),
    ).toBe("HAL");
  });

  it("leaves a plain journal name alone", () => {
    expect(shortVenue("Scientific Reports")).toBe("Scientific Reports");
    expect(shortVenue("RNA")).toBe("RNA");
  });

  it("keeps brackets that are not a trailing host", () => {
    expect(shortVenue("Proceedings (Series B) of the Royal Society")).toBe(
      "Proceedings (Series B) of the Royal Society",
    );
  });

  it("keeps the original when the name is entirely bracketed", () => {
    expect(shortVenue("(Unknown repository)")).toBe("(Unknown repository)");
  });

  it("returns null for nothing", () => {
    expect(shortVenue("")).toBeNull();
    expect(shortVenue(undefined)).toBeNull();
    expect(shortVenue("   ")).toBeNull();
  });
});
