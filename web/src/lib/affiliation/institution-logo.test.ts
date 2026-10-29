import { describe, expect, it } from "vitest";
import { institutionLogo } from "./institution-logo";

describe("institution logo matching", () => {
  const record = {
    display_name: "University of Illinois Urbana-Champaign",
    image_thumbnail_url: "https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/Illinois.svg&width=300",
  };
  it("returns a Wikimedia logo for the same institution", () => {
    expect(institutionLogo(record, "University of Illinois Urbana Champaign")).toContain("commons.wikimedia.org");
  });
  it("does not attribute a different school's logo", () => {
    expect(institutionLogo(record, "University of Illinois Chicago")).toBeNull();
  });
  it("does not load arbitrary or malformed image URLs", () => {
    expect(institutionLogo({ ...record, image_thumbnail_url: "https://evil.example/logo.png" }, record.display_name)).toBeNull();
    expect(institutionLogo({ ...record, image_thumbnail_url: "https://commons.wikimedia.org/other" }, record.display_name)).toBeNull();
  });
});
