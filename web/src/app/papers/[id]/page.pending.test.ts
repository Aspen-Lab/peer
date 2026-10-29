import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P12-58 (rule 3): while the reading is pending the page shows its one pending line instead of the
// abstract-only notice. `Reader` cannot be mounted in this Node-only suite (no jsdom: see page.test.tsx), so
// what the line says and when it replaces the notice is tested over functions in
// `components/reader/use-reading.poll.test.ts` (`sentencesWhileWaiting`); this file holds the page's join to
// them, by reading the source, the way page.return.test.ts does.

const source = readFileSync(resolve(__dirname, "page.tsx"), "utf8");

describe("the page's join to the pending line", () => {
  it("takes `wait` from the reading hook and passes it, with whether a model's sentence answered, to the sentence choice", () => {
    expect(source).toContain("const { reading, fromServer, wait } = useReading(paper);");
    expect(source).toContain("return sentencesWhileWaiting(described, wait, availability !== null);");
    expect(source).toMatch(/import \{ sentencesWhileWaiting, useReading \} from "@\/components\/reader\/use-reading";/);
  });

  it("makes that choice on the sentences the Decision block is handed, and nowhere else", () => {
    expect(source.match(/sentencesWhileWaiting\(/g)).toHaveLength(1);
    const choice = source.indexOf("sentencesWhileWaiting(described");
    const described = source.indexOf("const described = describeAvailability({");
    expect(described).toBeGreaterThan(-1);
    expect(choice).toBeGreaterThan(described);
    expect(source).toContain("sentences={sentences}");
  });

  it("types no pending or end-of-wait wording of its own: the words are copy.ts's", () => {
    expect(source).not.toMatch(/still reading the full text/i);
    expect(source).not.toMatch(/could not read the full text/i);
  });

  it("leaves the place restore waiting on the reading itself: a pending reading is not ready (`fromServer` stays false)", () => {
    expect(source).toContain("useRestoreReaderPlace({ paperId: paper.id, ready: fromServer, hasBody, tab, select: selectTab });");
  });
});
