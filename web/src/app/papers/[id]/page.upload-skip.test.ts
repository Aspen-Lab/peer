import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P2-08b (§1g.19 e, F9; P1-08, §1a.6): a standalone uploaded PDF's page keeps
// no "Not interested, then next" — no `skip` for the keyboard, no swipe-left,
// no Skip button. The three registrations are in `Reader`, which cannot be
// mounted in this Node-only suite, so a mutation that registered `skip` on an
// upload's page (A's M2) left every reader test green while Chromium showed the
// key still working. This reads the page's source — as `paper-notes.test.ts`
// and the P2-05 / P2-09 wiring tests do — and holds each registration to its
// `isUploadId` guard. A reformat of those lines turns it red on purpose, and the
// failure says which registration moved.
//
// The checker is also run on three mutated copies of the source, so the test
// proves it would notice what it guards: it is green on the page and red on each.

const GUARD = 'const isUploadId = originalPaper.id.startsWith("upload:");';
const KEYBOARD = "...(isUploadId ? {} : { skip }),";
const SWIPE = "{...(isUploadId ? {} : { onSwipeLeft: skip, leftLabel: SWIPE.notInterested })}";
const BUTTON = "onSkip={isUploadId ? undefined : skip}";

/** What is wrong with the upload-skip wiring of a page `source`; empty when it is right. */
function skipProblems(source: string): string[] {
  const text = source.replace(/\s+/g, " ");
  const problems: string[] = [];

  if (!text.includes(GUARD)) {
    problems.push(`the Reader's isUploadId is no longer \`${GUARD}\``);
  }

  // The keyboard: `skip` only inside the isUploadId guard, and nowhere else in `actions`.
  const start = text.indexOf("const actions: ReaderActions = {");
  const end = start < 0 ? -1 : text.indexOf("};", start);
  const actions = start < 0 || end < 0 ? "" : text.slice(start, end);
  if (!actions) problems.push("the keyboard `actions` block (`const actions: ReaderActions = {`) moved");
  else if (!actions.includes(KEYBOARD)) problems.push(`the keyboard registration of skip is no longer \`${KEYBOARD}\``);
  else if (/\bskip\b/.test(actions.replace(KEYBOARD, ""))) problems.push("skip is registered with the keyboard outside its isUploadId guard");

  // The swipe card: one `onSwipeLeft`, and it is the guarded one.
  const swipes = text.split("onSwipeLeft").length - 1;
  if (swipes !== 1) problems.push(`the swipe card has ${swipes} onSwipeLeft registrations, not 1`);
  else if (!text.includes(SWIPE)) problems.push(`the swipe-left registration is no longer \`${SWIPE}\``);

  // The Skip button: one `onSkip=`, and it is the guarded one.
  const buttons = text.split("onSkip=").length - 1;
  if (buttons !== 1) problems.push(`the page has ${buttons} onSkip props, not 1`);
  else if (!text.includes(BUTTON)) problems.push(`the Skip button's prop is no longer \`${BUTTON}\``);

  return problems;
}

const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");

describe("an upload's page registers no skip (P1-08, P2-08b F9)", () => {
  it("guards the keyboard action, the swipe-left and the Skip button with isUploadId", () => {
    expect(skipProblems(source)).toEqual([]);
  });

  it("would notice skip registered for the keyboard on an upload's page (A's M2)", () => {
    const mutated = source.replace(KEYBOARD, "...{ skip },");
    expect(mutated).not.toBe(source);
    expect(skipProblems(mutated)).toEqual([`the keyboard registration of skip is no longer \`${KEYBOARD}\``]);
  });

  it("would notice swipe-left registered on an upload's page", () => {
    const mutated = source.replace(SWIPE, "onSwipeLeft={skip}");
    expect(mutated).not.toBe(source);
    expect(skipProblems(mutated)).toEqual([`the swipe-left registration is no longer \`${SWIPE}\``]);
  });

  it("would notice the Skip button shown on an upload's page", () => {
    const mutated = source.replace(BUTTON, "onSkip={skip}");
    expect(mutated).not.toBe(source);
    expect(skipProblems(mutated)).toEqual([`the Skip button's prop is no longer \`${BUTTON}\``]);
  });

  it("would notice a second, unguarded skip in the keyboard actions", () => {
    const mutated = source.replace(KEYBOARD, `${KEYBOARD} skip,`);
    expect(mutated).not.toBe(source);
    expect(skipProblems(mutated)).toEqual(["skip is registered with the keyboard outside its isUploadId guard"]);
  });
});
