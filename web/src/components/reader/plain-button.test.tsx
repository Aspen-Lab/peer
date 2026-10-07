import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureConsole } from "@/test-support/console-capture";
import type { Paper } from "@/types";
import { PLAIN_LEVELS } from "@/lib/papers/plain-levels";
import { paragraphKey, usePlainRewritesStore } from "@/store/plain-rewrites";
import { PEERS_READING, PLAIN } from "./copy";
import type { SectionMark, TintTier } from "./paper-body";
import { PLAIN_CAPS } from "@/lib/papers/plain";
import { PlainControl, PlainRewrite, plainOffered, requestPlain, sayPlainly, type PlainRequestResult } from "./plain-button";

// P4-01 (blueprint §3.6 ⑥; rulings §1h.12 (h); §3d 15, 18): the control under a paragraph the
// route marks read — "Say it plainly" and the three levels — the rewrite that sits beside the
// paragraph, the one request a click makes, and what the click does with the answer. No DOM
// here (the suite runs in plain Node): markup is rendered to a string, handlers are called on
// the element tree, and the request is a stub. Everything below is invented text.

const KEY_SENTINEL = "USER-NOT-A-KEY-PLAIN-BUTTON";
const TEXT = "The rafting ratio rose from 0.2 to 0.7 at 1100 K [12].";
const PLAIN_TEXT = "The ratio of rafted material went from 0.2 to 0.7 at 1100 K [12].";
const paper = {
  id: "arxiv:2607.00002",
  title: "Rafting under creep in a nickel alloy",
  authors: ["A. Researcher"],
  relevanceReason: "Matches the declared topic.",
  venue: "Peer Review",
  source: "arxiv" as const,
  summaryIntro: "PRIVATE-ABSTRACT-SENTINEL",
  summaryExperimentKeywords: ["creep"],
  summaryResultDiscussion: "",
  isSaved: true,
  doi: "10.1000/example",
  linkArxiv: "https://arxiv.org/abs/2607.00002",
} as unknown as Paper;
const target = { sectionId: "s2", sectionIndex: 1, paragraphIndex: 1, text: TEXT };
const KEY = paragraphKey("s2", 1);

type Props = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}
const buttons = (tree: ReactNode) => elements(tree).filter((el) => el.type === "button");

const controlProps = (over: Partial<Parameters<typeof PlainControl>[0]> = {}): Parameters<typeof PlainControl>[0] => ({
  level: "undergrad",
  showing: false,
  busy: false,
  notice: null,
  onToggle: () => {},
  onLevel: () => {},
  ...over,
});

// ── The control ───────────────────────────────────────────────────────

describe("PlainControl", () => {
  it("is a small label-face button, 'Say it plainly', with the three levels beside it, the remembered one selected", () => {
    const html = renderToStaticMarkup(createElement(PlainControl, controlProps({ level: "graduate" })));

    expect(html).toContain(`>${PLAIN.button}<`);
    expect(html).toContain("font-mono");
    expect(html).toContain(`aria-label="${PLAIN.levelsLabel}"`);
    const order = [PLAIN.levels.highschool, PLAIN.levels.undergrad, PLAIN.levels.graduate].map((label) => html.indexOf(`>${label}<`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.indexOf(`>${PLAIN.button}<`)).toBeLessThan(order[0]);
    expect(html).toContain('data-plain-level="graduate" aria-pressed="true"');
    // One level is pressed, and the button itself is not (no rewrite shows).
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("selects the level it is given, whichever it is", () => {
    for (const level of PLAIN_LEVELS) {
      const levelButtons = buttons(PlainControl(controlProps({ level }))).filter((el) => el.props["data-plain-level"] !== undefined);

      expect(levelButtons.map((el) => el.props["data-plain-level"])).toEqual([...PLAIN_LEVELS]);
      expect(levelButtons.map((el) => el.props["aria-pressed"])).toEqual(PLAIN_LEVELS.map((one) => one === level));
    }
  });

  it("reads 'Saying it plainly…' and is disabled while the request runs, the levels with it", () => {
    const tree = PlainControl(controlProps({ busy: true }));
    const [say, ...levels] = buttons(tree);

    expect(say.props.children).toBe(PLAIN.busy);
    expect(say.props.disabled).toBe(true);
    expect(levels).toHaveLength(3);
    for (const level of levels) expect(level.props.disabled).toBe(true);
    // And only then.
    const idle = buttons(PlainControl(controlProps()));
    expect(idle[0].props.children).toBe(PLAIN.button);
    for (const one of idle) expect(one.props.disabled).toBeFalsy();
  });

  it("is a pressed toggle while a rewrite shows: the same words, `aria-pressed`, so a second press can hide it", () => {
    expect(buttons(PlainControl(controlProps({ showing: true })))[0].props["aria-pressed"]).toBe(true);
    expect(buttons(PlainControl(controlProps({ showing: false })))[0].props["aria-pressed"]).toBe(false);
    expect(buttons(PlainControl(controlProps({ showing: true })))[0].props.children).toBe(PLAIN.button);
  });

  it("calls `onToggle` for the button and `onLevel` with the level for each of the three", () => {
    const onToggle = vi.fn();
    const onLevel = vi.fn();
    const [say, high, under, grad] = buttons(PlainControl(controlProps({ onToggle, onLevel })));

    (say.props.onClick as () => void)();
    (high.props.onClick as () => void)();
    (under.props.onClick as () => void)();
    (grad.props.onClick as () => void)();

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onLevel.mock.calls).toEqual([["highschool"], ["undergrad"], ["graduate"]]);
  });

  it("says why there is no rewrite, in one line under the control, and says nothing otherwise", () => {
    const numbers = renderToStaticMarkup(createElement(PlainControl, controlProps({ notice: "numbers_changed" })));
    const unavailable = renderToStaticMarkup(createElement(PlainControl, controlProps({ notice: "unavailable" })));
    const none = renderToStaticMarkup(createElement(PlainControl, controlProps()));

    expect(numbers).toContain(PLAIN.couldNotKeepNumbers.replace(/'/g, "&#x27;"));
    expect(numbers).not.toContain(PLAIN.unavailable);
    expect(unavailable).toContain(PLAIN.unavailable);
    expect(unavailable).not.toContain("numbers exact");
    expect(numbers).toContain('role="status"');
    expect(none).not.toContain("role=\"status\"");
    expect(none).not.toContain("could not");
    // Peer's line, in the label face — and it speaks of no allowance and no plan.
    expect(numbers).toMatch(/class="[^"]*annotation[^"]*"[^>]*>Peer could not keep/);
    expect(`${numbers}${unavailable}`).not.toMatch(/allowance|quota|plan\b|upgrade/i);
  });

  it("spans the whole row beside a rewrite on the spread, and not otherwise", () => {
    expect(renderToStaticMarkup(createElement(PlainControl, controlProps({ wide: true })))).toContain("xl:col-span-2");
    expect(renderToStaticMarkup(createElement(PlainControl, controlProps()))).not.toContain("col-span");
  });
});

// ── The rewrite ───────────────────────────────────────────────────────

describe("PlainRewrite", () => {
  const html = renderToStaticMarkup(createElement(PlainRewrite, { text: PLAIN_TEXT }));

  it("is Peer's reading: one label-face line, then the words in the reading face — never quote-styled", () => {
    expect(html).toContain(PEERS_READING.replace(/'/g, "&#x27;"));
    expect(html.indexOf(PEERS_READING.replace(/'/g, "&#x27;"))).toBeLessThan(html.indexOf("The ratio of rafted material"));
    expect(html).toMatch(/class="[^"]*annotation[^"]*"[^>]*>Peer&#x27;s reading/);
    expect(html).not.toContain("<blockquote");
    expect(html).not.toMatch(/border-l|italic|<q\b|<cite/);
    expect(html.match(/Peer&#x27;s reading/g)).toHaveLength(1);
  });

  it("is named for a screen reader, as a note beside the paragraph", () => {
    expect(html).toContain('role="note"');
    expect(html).toContain(`aria-label="${PLAIN.rewrite}"`);
  });

  it("draws a formula the paragraph held, as the paragraph does", () => {
    const withFormula = renderToStaticMarkup(createElement(PlainRewrite, { text: "The term ⟦x^{2}⟧ grew." }));

    // The marks are not shown; the TeX is, in the mono, until KaTeX arrives in the browser.
    expect(withFormula).not.toContain("⟦");
    expect(withFormula).toMatch(/<code[^>]*>x\^\{2\}<\/code>/);
  });
});

// ── Where the control is offered ──────────────────────────────────────

describe("plainOffered — only under a paragraph the route marks read", () => {
  const mark = (tier: Exclude<TintTier, "none">, paragraphs: Array<[number, Exclude<TintTier, "none">]> = []): SectionMark => ({
    tier,
    title: "Q1",
    hits: [],
    paragraphs: new Map(paragraphs),
  });

  it("is true for a paragraph whose own tier is read", () => {
    expect(plainOffered(mark("read", [[2, "read"]]), 2)).toBe(true);
    expect(plainOffered(mark("read", [[2, "read"], [3, "skim"]]), 2)).toBe(true);
  });

  it("is false for a paragraph the section marks but the route does not mark read: skim, background, or unmarked beside marked ones", () => {
    expect(plainOffered(mark("read", [[2, "read"], [3, "skim"]]), 3)).toBe(false);
    expect(plainOffered(mark("read", [[2, "read"], [4, "background"]]), 4)).toBe(false);
    expect(plainOffered(mark("read", [[2, "read"]]), 5)).toBe(false);
  });

  it("is true under every paragraph of a section the route marks read when it has no paragraph marks — a Tier 2 answer's section", () => {
    expect(plainOffered(mark("read"), 0)).toBe(true);
    expect(plainOffered(mark("read"), 7)).toBe(true);
  });

  // P4-03 (BACKLOG-20): the route rewrites only the first `PLAIN_CAPS.paragraphChars` characters of a
  // paragraph, so the numbers after the cut are outside the guard: no control under a longer one.
  const sized = (n: number) => {
    const whole = Math.floor((n - 1) / 6);
    return "abcde ".repeat(whole) + "f".repeat(n - 6 * whole);
  };

  it("is true for a paragraph of exactly the cap and false for one character more, whichever way it is marked read", () => {
    const cap = PLAIN_CAPS.paragraphChars;
    expect(sized(cap)).toHaveLength(cap);
    expect(sized(cap + 1)).toHaveLength(cap + 1);
    expect(plainOffered(mark("read", [[2, "read"]]), 2, sized(cap))).toBe(true);
    expect(plainOffered(mark("read", [[2, "read"]]), 2, sized(cap + 1))).toBe(false);
    expect(plainOffered(mark("read"), 0, sized(cap))).toBe(true);
    expect(plainOffered(mark("read"), 0, sized(cap + 1))).toBe(false);
  });

  it("applies the cap per paragraph in a section with no paragraph marks: a long one beside a short one", () => {
    const section = mark("read");
    expect(plainOffered(section, 0, sized(40))).toBe(true);
    expect(plainOffered(section, 1, sized(PLAIN_CAPS.paragraphChars + 1))).toBe(false);
    expect(plainOffered(section, 2, sized(40))).toBe(true);
  });

  it("is false in a section marked skim or background with no paragraph marks, and with no mark at all", () => {
    expect(plainOffered(mark("skim"), 0)).toBe(false);
    expect(plainOffered(mark("background"), 0)).toBe(false);
    expect(plainOffered(null, 0)).toBe(false);
  });
});

// ── The request ───────────────────────────────────────────────────────

describe("requestPlain", () => {
  let fetchStub: ReturnType<typeof vi.fn>;

  // A fresh Response for every call: a body can be read once.
  const respond = (status: number, body: unknown) =>
    fetchStub.mockImplementation(() => Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status })));
  const args = (over: Record<string, unknown> = {}) => ({ paper, sectionId: "s2", paragraphIndex: 1, text: TEXT, level: "undergrad" as const, ...over });

  beforeEach(() => {
    fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the paper's plain route with the paragraph, where it sits and the level — and nothing else of the page", async () => {
    respond(200, { plain: PLAIN_TEXT, level: "undergrad", cached: false });
    await requestPlain(args());

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/papers/${encodeURIComponent(paper.id)}/plain`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["level", "paper", "paragraphIndex", "sectionId", "text"]);
    expect(body).toMatchObject({ sectionId: "s2", paragraphIndex: 1, text: TEXT, level: "undergrad" });
  });

  it("sends only what the server needs to find the paper's text: its id and title, its DOI and links, an upload's id — not the abstract, the authors or the reader's marks on it", async () => {
    respond(200, { plain: PLAIN_TEXT });
    await requestPlain(args({ paper: { ...paper, fullTextUploadId: "upload:0123456789abcdef", linkPaper: "https://example.org/p.pdf" } }));
    const body = JSON.parse((fetchStub.mock.calls[0][1] as RequestInit).body as string) as { paper: Record<string, unknown> };

    expect(Object.keys(body.paper).sort()).toEqual(["doi", "fullTextUploadId", "id", "linkArxiv", "linkPaper", "title"]);
    const sent = JSON.stringify(body);
    for (const word of ["PRIVATE-ABSTRACT-SENTINEL", "A. Researcher", "isSaved", "relevanceReason", "Peer Review"]) expect(sent).not.toContain(word);
  });

  it("carries the reader's own key when they have one, and nothing when they do not", async () => {
    respond(200, { plain: PLAIN_TEXT });
    await requestPlain(args({ llmOverride: { provider: "gemini", apiKey: KEY_SENTINEL } }));
    await requestPlain(args());
    const bodies = fetchStub.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>);

    expect(bodies[0].llmOverride).toEqual({ provider: "gemini", apiKey: KEY_SENTINEL });
    expect(bodies[1]).not.toHaveProperty("llmOverride");
  });

  it("answers the plain paragraph, trimmed, when the server gives one", async () => {
    respond(200, { plain: `  ${PLAIN_TEXT}\n`, level: "undergrad", cached: true });

    expect(await requestPlain(args())).toEqual({ plain: PLAIN_TEXT });
  });

  it("answers numbers_changed for a 422 that says so, and unavailable for every other 422", async () => {
    respond(422, { error: "numbers_changed" });
    expect(await requestPlain(args())).toBe("numbers_changed");
    respond(422, { error: "not_in_paper" });
    expect(await requestPlain(args())).toBe("unavailable");
    respond(422, "not json at all");
    expect(await requestPlain(args())).toBe("unavailable");
  });

  it("answers unavailable for anything else: no model, a refusal, a gone upload, a body that is not what was promised, no network", async () => {
    const cases: Array<() => void> = [
      () => respond(200, { unavailable: true }),
      () => respond(200, { plain: "" }),
      () => respond(200, { plain: "   " }),
      () => respond(200, { plain: 5 }),
      () => respond(200, "not json"),
      () => respond(200, ""),
      () => respond(401, { error: "Sign in before using an AI feature" }),
      () => respond(404, { error: "Upload not found." }),
      () => respond(410, { error: "Upload no longer available" }),
      () => respond(429, { error: "AI request limit reached. Try again later." }),
      () => respond(500, { error: "boom" }),
      () => fetchStub.mockRejectedValue(new TypeError("Failed to fetch")),
    ];
    for (const set of cases) {
      set();
      expect(await requestPlain(args())).toBe("unavailable");
    }
  });

  it("writes nothing to any console, whatever happens — the key and the paragraph are not for a log", async () => {
    const consoleText = captureConsole();
    try {
      respond(200, { plain: PLAIN_TEXT });
      await requestPlain(args({ llmOverride: { provider: "gemini", apiKey: KEY_SENTINEL } }));
      fetchStub.mockRejectedValue(new Error(`failed with ${KEY_SENTINEL} ${TEXT}`));
      await requestPlain(args({ llmOverride: { provider: "gemini", apiKey: KEY_SENTINEL } }));

      expect(consoleText.calls()).toBe(0);
    } finally {
      consoleText.restore();
    }
  });
});

// ── The click ─────────────────────────────────────────────────────────

describe("sayPlainly — what a click does with the answer", () => {
  const state = () => usePlainRewritesStore.getState();
  const gate = () => {
    let release: (result: PlainRequestResult) => void = () => {};
    const request = vi.fn(() => new Promise<PlainRequestResult>((resolve) => (release = resolve)));
    return { request, release: (result: PlainRequestResult) => release(result) };
  };
  const say = (request: (args: never) => Promise<PlainRequestResult>, over: Record<string, unknown> = {}) =>
    sayPlainly({ paper, target, level: "undergrad", request: request as never, ...over });

  beforeEach(() => {
    usePlainRewritesStore.setState({ byPaper: {}, showing: {}, busy: {}, notices: {} });
  });

  it("asks once, keeps the rewrite at its level, shows it, and leaves the paragraph free again", async () => {
    const request = vi.fn(async () => ({ plain: PLAIN_TEXT }));

    expect(await say(request)).toBe("shown");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ paper, sectionId: "s2", paragraphIndex: 1, text: TEXT, level: "undergrad" });
    expect(state().byPaper[paper.id][KEY].undergrad?.plain).toBe(PLAIN_TEXT);
    expect(state().showing[paper.id]).toEqual([{ key: KEY, level: "undergrad" }]);
    expect(state().isBusy(paper.id, KEY)).toBe(false);
    expect(state().notices[paper.id]).toBeUndefined();
  });

  it("passes the reader's own key to the request, and nothing else new", async () => {
    const request = vi.fn(async () => ({ plain: PLAIN_TEXT }));
    const llmOverride = { provider: "gemini" as const, apiKey: KEY_SENTINEL };
    await say(request, { llmOverride });

    expect(request).toHaveBeenCalledWith({ paper, sectionId: "s2", paragraphIndex: 1, text: TEXT, level: "undergrad", llmOverride });
  });

  it("is busy while the request runs: the paragraph says so, and a second click asks nothing", async () => {
    const { request, release } = gate();
    const first = say(request);

    expect(state().isBusy(paper.id, KEY)).toBe(true);
    expect(await say(request)).toBe("busy");
    expect(request).toHaveBeenCalledTimes(1);
    release({ plain: PLAIN_TEXT });
    expect(await first).toBe("shown");
    expect(state().isBusy(paper.id, KEY)).toBe(false);
  });

  it("reopens a kept rewrite with no request: after `u` hid it, a second click shows it again", async () => {
    const request = vi.fn(async () => ({ plain: PLAIN_TEXT }));
    await say(request);
    expect(state().hideLatest(paper.id)).toBe(true);
    expect(state().showing[paper.id]).toBeUndefined();

    expect(await say(request)).toBe("kept");
    expect(request).toHaveBeenCalledTimes(1);
    expect(state().showing[paper.id]).toEqual([{ key: KEY, level: "undergrad" }]);
  });

  it("asks again for another level, and keeps both: the paragraph shows the one chosen", async () => {
    const request = vi.fn(async (args: { level: string }) => ({ plain: `${PLAIN_TEXT} (${args.level})` }));
    await say(request);
    await say(request, { level: "graduate" });

    expect(request).toHaveBeenCalledTimes(2);
    expect(state().showing[paper.id]).toEqual([{ key: KEY, level: "graduate" }]);
    expect(Object.keys(state().byPaper[paper.id][KEY]).sort()).toEqual(["graduate", "undergrad"]);
    // Back at the first: kept, no third request.
    expect(await say(request, { level: "undergrad" })).toBe("kept");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not hand back a kept rewrite for a paragraph that now says something else: it asks again", async () => {
    const request = vi.fn(async () => ({ plain: PLAIN_TEXT }));
    await say(request);
    state().hide(paper.id, KEY);

    expect(await sayPlainly({ paper, target: { ...target, text: `${TEXT} A new sentence appeared.` }, level: "undergrad", request: request as never })).toBe("shown");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("when the numbers could not be kept exact: no rewrite shown or kept, one line under the paragraph, the original alone", async () => {
    const request = vi.fn(async () => "numbers_changed" as const);

    expect(await say(request)).toBe("numbers_changed");
    expect(state().byPaper[paper.id]).toBeUndefined();
    expect(state().showing[paper.id]).toBeUndefined();
    expect(state().notices[paper.id][KEY]).toBe("numbers_changed");
    expect(state().isBusy(paper.id, KEY)).toBe(false);
  });

  it("when there is no answer: the same, with the other line", async () => {
    const request = vi.fn(async () => "unavailable" as const);

    expect(await say(request)).toBe("unavailable");
    expect(state().notices[paper.id][KEY]).toBe("unavailable");
    expect(state().showing[paper.id]).toBeUndefined();
  });

  it("clears the last line when the reader tries again, and shows the original alone if the other level fails while one shows", async () => {
    const failing = vi.fn(async () => "numbers_changed" as const);
    await say(failing);
    const working = vi.fn(async () => ({ plain: PLAIN_TEXT }));
    await say(working);

    expect(state().notices[paper.id]).toBeUndefined();
    expect(state().showing[paper.id]).toEqual([{ key: KEY, level: "undergrad" }]);

    await say(failing, { level: "graduate" });
    expect(state().showing[paper.id]).toBeUndefined();
    expect(state().notices[paper.id][KEY]).toBe("numbers_changed");
    // The first level's rewrite is still kept for a later click.
    expect(state().byPaper[paper.id][KEY].undergrad?.plain).toBe(PLAIN_TEXT);
  });

  it("never loses the rewrite to a browser store that cannot keep it: persist's write throws after zustand has set its state, and the rewrite is shown anyway", async () => {
    const real = state().remember;
    const remember = vi.fn((...args: Parameters<typeof real>) => {
      real(...args);
      throw new Error("QuotaExceededError");
    });
    usePlainRewritesStore.setState({ remember });
    const request = vi.fn(async () => ({ plain: PLAIN_TEXT }));

    expect(await say(request)).toBe("shown");
    expect(remember).toHaveBeenCalledTimes(1);
    expect(state().showing[paper.id]).toEqual([{ key: KEY, level: "undergrad" }]);
    expect(state().byPaper[paper.id][KEY].undergrad?.plain).toBe(PLAIN_TEXT);
    expect(state().isBusy(paper.id, KEY)).toBe(false);
    usePlainRewritesStore.setState({ remember: real });
  });

  it("keeps each paper's paragraphs apart", async () => {
    const request = vi.fn(async () => ({ plain: PLAIN_TEXT }));
    await say(request);
    const other = { ...paper, id: "arxiv:2607.99999" } as Paper;

    expect(await sayPlainly({ paper: other, target, level: "undergrad", request: request as never })).toBe("shown");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
