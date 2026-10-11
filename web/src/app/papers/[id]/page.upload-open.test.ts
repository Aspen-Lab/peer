import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P7-12 (R4, the owner's review): an uploaded PDF's own page offers no "Open the
// PDF" command and no `o` key — the reader is already looking at the file's text,
// and the command only sent them to the raw file route. Page-level: `pickSource`
// still returns the file route (the shared reading is unchanged, so no version
// bump); the page just does not offer it. The registrations are in `Reader`,
// which cannot be mounted in this Node-only suite, so — as `page.upload-skip.test.ts`
// does for `skip` — this reads the page's source and holds the command and the key
// to their `isUploadId` guards. A reformat of those lines turns it red on purpose,
// and the failure says which one moved. The checker is also run on mutated copies
// of the source, so the test proves it would notice what it guards.

const GUARD = 'const isUploadId = originalPaper.id.startsWith("upload:");';
const KEYBOARD = "...(isUploadId ? {} : { open }),";
const COMMAND = "source={isUploadId ? null : reading.source}";
const RECORD = "primaryUrl={reading.source?.url ?? null}";

/** What is wrong with the upload-open wiring of a page `source`; empty when it is right. */
function openProblems(source: string): string[] {
  const text = source.replace(/\s+/g, " ");
  const problems: string[] = [];

  if (!text.includes(GUARD)) {
    problems.push(`the Reader's isUploadId is no longer \`${GUARD}\``);
  }

  // The keyboard: `open` only inside the isUploadId guard, and nowhere else in `actions`.
  const start = text.indexOf("const actions: ReaderActions = {");
  const end = start < 0 ? -1 : text.indexOf("};", start);
  const actions = start < 0 || end < 0 ? "" : text.slice(start, end);
  if (!actions) problems.push("the keyboard `actions` block (`const actions: ReaderActions = {`) moved");
  else if (!actions.includes(KEYBOARD)) problems.push(`the keyboard registration of open is no longer \`${KEYBOARD}\``);
  else if (/\bopen\b/.test(actions.replace(KEYBOARD, ""))) problems.push("open is registered with the keyboard outside its isUploadId guard");

  // The decision block's source command: one `source=` between `<DecisionBlock` and the next slot
  // (`additions={` — P7-14 (R5) deleted the `contents={` slot that used to follow it), and it is
  // the guarded one.
  const decision = text.indexOf("<DecisionBlock");
  const decisionEnd = decision < 0 ? -1 : text.indexOf(" additions={", decision);
  const block = decision < 0 || decisionEnd < 0 ? "" : text.slice(decision, decisionEnd);
  if (!block) problems.push("the `<DecisionBlock` element moved");
  else {
    const sources = block.split(" source=").length - 1;
    if (sources !== 1) problems.push(`the decision block has ${sources} source props, not 1`);
    else if (!block.includes(COMMAND)) problems.push(`the decision block's source is no longer \`${COMMAND}\``);
  }

  // The record's "Publisher" door still dedupes against the reading's own source, so the file route
  // is not listed a second time: the record keeps the unguarded value.
  if (!text.includes(RECORD)) problems.push(`the record block no longer reads \`${RECORD}\``);

  return problems;
}

const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");

describe("an upload's page offers no source command and no o key (P7-12, R4)", () => {
  it("guards the keyboard action and the decision block's source with isUploadId", () => {
    expect(openProblems(source)).toEqual([]);
  });

  it("would notice open registered for the keyboard on an upload's page", () => {
    const mutated = source.replace(KEYBOARD, "open,");
    expect(mutated).not.toBe(source);
    expect(openProblems(mutated)).toEqual([`the keyboard registration of open is no longer \`${KEYBOARD}\``]);
  });

  it("would notice a second, unguarded open in the keyboard actions", () => {
    const mutated = source.replace(KEYBOARD, `${KEYBOARD} open,`);
    expect(mutated).not.toBe(source);
    expect(openProblems(mutated)).toEqual(["open is registered with the keyboard outside its isUploadId guard"]);
  });

  it("would notice the source command handed to an upload's decision block", () => {
    const mutated = source.replace(COMMAND, "source={reading.source}");
    expect(mutated).not.toBe(source);
    expect(openProblems(mutated)).toEqual([`the decision block's source is no longer \`${COMMAND}\``]);
  });

  it("would notice the record losing the reading's source to dedupe against", () => {
    const mutated = source.replaceAll(RECORD, "primaryUrl={null}");
    expect(mutated).not.toBe(source);
    expect(openProblems(mutated)).toEqual([`the record block no longer reads \`${RECORD}\``]);
  });
});
