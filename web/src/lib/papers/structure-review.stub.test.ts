import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FIVE_PARTS, inventedPaper } from "@/test-support/structure-fixtures";
import { buildLookPrompt, buildReviewPrompt, buildSkeleton, draftOf, partsOf, reviewStructure } from "./structure-review";
import { parseModelJson } from "./explain";

// P12-53 (B P12-42 §6 "The stub (e2e, plumbing only)"; Appendix C): the e2e harness's model stub
// (`docs/reading-helper-abc/harness/model-stub.cjs`) answers the structure review's two prompts. It cannot judge
// whether a structure is right (ruling §1h.424 (c)); it answers a VALID answer of the kind `stub-control.json` names,
// so the route, the hook and the page can be walked end to end. The stub is run in a child process, as the harness
// runs it (it replaces `fetch` for the whole process), with the real prompts the real builders make from an invented
// paper; nothing leaves the machine and no key is read.

const STUB = resolve(process.cwd(), "../docs/reading-helper-abc/harness/model-stub.cjs");
const FIVE = inventedPaper(FIVE_PARTS);
const draft = draftOf(FIVE.input)!;
const review = buildReviewPrompt({ skeleton: buildSkeleton(FIVE.input, draft)!, draft });
const look = buildLookPrompt({ draft, answer: { corrections: [{ op: "set_role", part: 3, role: "evidence" }], unsure: [] }, target: { part: 3, why: "contradicts-high" }, texts: FIVE.input.texts });

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Step {
  user: string;
  /** What `stub-control.json` holds while this prompt is asked. */
  control?: Record<string, unknown>;
}

/** Runs the stub in ONE child process and sends each prompt through `fetch` as the OpenAI provider does. */
function ask(steps: Step[]): { contents: string[]; log: Array<Record<string, unknown>> } {
  const dir = mkdtempSync(join(tmpdir(), "peer-stub-"));
  dirs.push(dir);
  const script = `
    const fs = require("node:fs");
    require(${JSON.stringify(STUB)});
    const steps = JSON.parse(fs.readFileSync(0, "utf8"));
    (async () => {
      const out = [];
      for (const step of steps) {
        fs.writeFileSync(process.env.P602_DIR + "/stub-control.json", JSON.stringify(step.control || {}));
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: "Bearer NOT-A-KEY" },
          body: JSON.stringify({ messages: [{ role: "system", content: "system" }, { role: "user", content: step.user }] }),
        });
        out.push((await res.json()).choices[0].message.content);
      }
      process.stdout.write(JSON.stringify(out));
    })();
  `;
  const stdout = execFileSync(process.execPath, ["-e", script], { input: JSON.stringify(steps), env: { ...process.env, P602_DIR: dir }, encoding: "utf8" });
  const log = readFileSync(join(dir, "stub.log"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { contents: JSON.parse(stdout) as string[], log };
}

describe("the harness stub's `structure` kind — plumbing, valid answers", () => {
  it("tells the review and its look apart from every other kind, and logs lengths and the kind only", () => {
    const { log } = ask([{ user: review.userPrompt }, { user: look.userPrompt }]);
    const calls = log.filter((line) => "kind" in line);

    expect(calls.map((line) => line.kind)).toEqual(["structure", "structure_look"]);
    for (const line of calls) expect(Object.keys(line).sort()).toEqual(["authBearer", "authLen", "kind", "nQuestions", "sysLen", "t", "userLen"]);
    expect(JSON.stringify(log)).not.toMatch(/Invented|tide pools/);
  });

  it("answers a valid empty answer by default: the draft is right", () => {
    const parsed = parseModelJson(ask([{ user: review.userPrompt }]).contents[0]);

    expect(parsed).toEqual({ corrections: [], unsure: [] });
    expect(reviewStructure(parsed, draft.parts, draft.paragraphs)).toMatchObject({ fellBack: false, parts: partsOf(draft.parts) });
  });

  it("answers one correction of the kind the control names, each one the sanitizer keeps", () => {
    const expected: Record<string, unknown> = {
      move: { op: "move_start", part: 1, toParagraph: 7 },
      role: { op: "set_role", part: 1, role: "evidence" },
      split: { op: "split", part: 2, atParagraph: 14, role: "interpretation" },
    };
    const { contents } = ask(Object.keys(expected).map((structure) => ({ user: review.userPrompt, control: { structure } })));

    Object.entries(expected).forEach(([, correction], k) => {
      const parsed = parseModelJson(contents[k]);
      const result = reviewStructure(parsed, draft.parts, draft.paragraphs);

      expect(parsed).toEqual({ corrections: [correction], unsure: [] });
      expect(result.fellBack).toBe(false);
      expect(result.answer!.corrections).toEqual([correction]);
    });
  });

  it("answers what the sanitizer refuses for `invalid`, and what is not JSON for `garbage` and nothing for `empty`: the draft stands", () => {
    const kinds = ["invalid", "garbage", "empty"];
    const { contents } = ask(kinds.map((structure) => ({ user: review.userPrompt, control: { structure } })));

    contents.forEach((content) => {
      const result = reviewStructure(parseModelJson(content), draft.parts, draft.paragraphs);

      expect(result.fellBack).toBe(true);
      expect(result.parts).toEqual(partsOf(draft.parts));
    });
    expect(contents[1]).toBe("I cannot help with that.");
    expect(contents[2]).toBe("");
  });

  it("answers the look with the control's verdict, `draft` by default", () => {
    const { contents } = ask([{ user: look.userPrompt }, { user: look.userPrompt, control: { look: "review" } }]);

    expect(JSON.parse(contents[0])).toEqual({ verdict: "draft" });
    expect(JSON.parse(contents[1])).toEqual({ verdict: "review" });
  });

  it("leaves the other kinds as they were: a gist prompt is still a gist, and a prompt that carries both is the review", () => {
    const gistPrompt = JSON.stringify({ outputSchema: { gists: [] }, paragraphs: [{ sectionId: "s1", paragraphIndex: 0, topicSentence: "One two three four five six seven eight nine ten" }] });
    const both = JSON.stringify({ outputSchema: { gists: [], corrections: [] }, draft: { parts: ["0 0-4 setup high x"] } });
    const { contents, log } = ask([{ user: gistPrompt }, { user: both }]);

    expect(JSON.parse(contents[0])).toEqual({ gists: [{ sectionId: "s1", paragraphIndex: 0, gist: "One two three four five six seven eight" }] });
    expect(JSON.parse(contents[1])).toEqual({ corrections: [], unsure: [] });
    expect(log.filter((line) => "kind" in line).map((line) => line.kind)).toEqual(["gist", "structure"]);
  });
});
