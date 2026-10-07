import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "./version";

// The version the sidebar shows and every exported reading carries
// (`peer_version`) is `APP_VERSION`; the changelog's newest entry is the
// release it describes. They drifted once (the v0.45.0 entry shipped while the
// string still said 0.44.0), and `version.ts` asks for a bump "in the same
// commit as the CHANGELOG entry" in a comment nothing enforced. This does.

const VERSION_HEADING = /^## v(\d+\.\d+\.\d+)\b/m;

function changelog(): string {
  return readFileSync(path.join(process.cwd(), "public/CHANGELOG.md"), "utf8");
}

describe("APP_VERSION and the changelog", () => {
  it("APP_VERSION is a plain x.y.z version", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("the newest changelog heading is the version the app says it is", () => {
    const top = VERSION_HEADING.exec(changelog());
    expect(top, "public/CHANGELOG.md has no '## vX.Y.Z' heading").not.toBeNull();
    expect(top?.[1]).toBe(APP_VERSION);
  });

  it("the heading matcher reads the first version heading, not a later or a quoted one", () => {
    // The matcher is the test's whole eyes: pinned on planted text.
    const planted = "# Changelog\n\nintro mentions ## v9.9.9 inline\n\n## v1.2.3 — 2026-01-01\n\n## v1.2.2 — 2025-12-31\n";
    expect(VERSION_HEADING.exec(planted)?.[1]).toBe("1.2.3");
  });
});
