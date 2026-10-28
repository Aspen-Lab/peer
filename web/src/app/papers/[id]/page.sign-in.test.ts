import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The paper page's wiring for a reader with a key saved who is signed out: one
// value (`signInForKey`, from `keyNeedsSignIn`) reaches both the sentence
// (`describeAvailability`) and the link after it (the Decision block's details),
// so the sentence and the link cannot disagree. The page is not rendered
// headlessly in this repo, so the wiring is read from the source, as the
// page's other wiring tests read it. The sentence and the link themselves are
// tested in reading.sign-in.test.ts and decision-block.sign-in.test.tsx.

const source = readFileSync(join(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("paper page - a key saved, the reader signed out", () => {
  it("reads the state once, from the same profile and auth outcome as aiAvailability", () => {
    expect(source).toMatch(/import \{[^}]*\bkeyNeedsSignIn\b[^}]*\} from "@\/lib\/feed\/ai-tier"/);
    expect(source).toContain("const aiMode = aiAvailability(profile, authOutcome);");
    expect(source.split("const signInForKey = keyNeedsSignIn(profile, authOutcome);")).toHaveLength(2);
  });

  it("hands it to the sentence, and the sentence's memo is rebuilt when it changes", () => {
    const call = source.slice(source.indexOf("describeAvailability({"), source.indexOf("// The plate's own terms"));
    expect(call).toContain("keyNeedsSignIn: signInForKey,");
    expect(call).toMatch(/\[reading, availability, providerConfigured, profileHasProject, model\.failed, signInForKey\]/);
  });

  const details = source.slice(source.indexOf('<DecisionBlock\n            part="details"'), source.indexOf('<DecisionBlock part="progress"'));

  it("hands it to the details' link, beside showAddKey, and to nothing else", () => {
    expect(details).toContain("showAddKey={showAddKey}");
    expect(details).toContain("keyNeedsSignIn={signInForKey}");
    expect(source.split("keyNeedsSignIn={signInForKey}")).toHaveLength(2);
  });

  it("the link follows the sentence: drawn only when the sentence names a key or a sign-in, from the same inputs", () => {
    // `availabilityAsksForKey` reads the function that writes the sentence (reading.sign-in.test.ts), handed what
    // `describeAvailability` is handed here, so a sentence that asks for neither (a PDF with no text) gets no link.
    expect(source).toMatch(
      /const showAddKey = availabilityAsksForKey\(\{\n\s+reading,\n\s+report: availability,\n\s+providerConfigured,\n\s+keyNeedsSignIn: signInForKey,\n\s+\}\);/,
    );
    expect(source).not.toContain('reading.omitted.some((entry) => entry.reason === "needs_key")');
  });

  it("'Sign in' comes back to this paper: its own path, built by the shared helper", () => {
    expect(source).toMatch(/import \{[^}]*\bpaperReturnPath\b[^}]*\} from "@\/lib\/navigation\/add-key-destination"/);
    expect(details).toContain("signInReturnTo={paperReturnPath(paper.id)}");
  });
});
