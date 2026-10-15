import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UserCloudAiProvider } from "@/lib/llm/provider-models";
import { AiProviderGuide, AiProviderGuideDetails } from "./ai-setup";

// P9-36 (the owner's decision, §1a.18 (f); ruling §1h.60 R4). The AI-setup
// panel is the Profile's and /welcome's AI step. It used to say that a Deep
// report is opened "in Papers, Events, or Jobs", and its monthly dollar figures
// rested on "about 40 opened Deep reports per day (10 papers, 15 events, and 15
// jobs)". Events and jobs are stopped, so the basis is gone; the repo holds the
// finished monthly strings and none of the arithmetic (nor a per-report price),
// so no figure can be re-derived and none is invented: the cost line states
// what a bill depends on and who sends it, with no number.

const PROVIDERS: { id: UserCloudAiProvider; name: string }[] = [
  { id: "gemini", name: "Google Gemini" },
  { id: "openai", name: "OpenAI" },
  { id: "qwen", name: "Alibaba Qwen" },
  { id: "anthropic", name: "Anthropic Claude" },
  { id: "deepseek", name: "DeepSeek" },
];

/** What a reader reads: tags and React's text-node comments out, entities decoded. */
function textOf(html: string): string {
  return html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const guideText = (id: UserCloudAiProvider) =>
  textOf(renderToStaticMarkup(createElement(AiProviderGuideDetails, { provider: id })));

const EVENT_OR_JOB = /\b(events?|jobs?)\b/i;
const COST_MARKER = "What this costs";

/** The guide's last paragraph, from its first words; fails if there is none. */
function costLine(id: UserCloudAiProvider): string {
  const text = guideText(id);
  const at = text.indexOf(COST_MARKER);
  expect(at, "the guide has a cost line").toBeGreaterThan(-1);
  return text.slice(at);
}

describe("AI setup - the expanded guide reads papers only (P9-36)", () => {
  it.each(PROVIDERS)("$name: says nothing of Events or Jobs", ({ id }) => {
    const text = guideText(id);
    expect(text.length).toBeGreaterThan(200);
    expect(text).not.toMatch(EVENT_OR_JOB);
  });

  it.each(PROVIDERS)("$name: the Deep-report model is for the Deep report a reader opens on a paper", ({ id }) => {
    expect(guideText(id)).toContain("every Deep report you open on a paper");
  });
});

describe("AI setup - the DeepSeek note, which shows before the guide is opened (P9-36)", () => {
  const closed = textOf(
    renderToStaticMarkup(createElement(AiProviderGuide, { provider: "deepseek" })),
  );

  it("still says DeepSeek cannot read images, and now says its text work is for papers", () => {
    expect(closed).toContain("Important: DeepSeek cannot process images in Peer.");
    expect(closed).toContain(
      "text ranking, summaries and text Deep reports for papers, but Peer will skip figure, chart, diagram, and other image analysis",
    );
  });

  it("names no Events or Jobs", () => {
    expect(closed).not.toMatch(EVENT_OR_JOB);
  });
});

describe("AI setup - the cost line states no figure it cannot back (P9-36, R4)", () => {
  it.each(PROVIDERS)("$name: says what the bill depends on and who sends it, in words", ({ id, name }) => {
    const cost = costLine(id);
    expect(cost).toContain("depends on how many Deep reports you open");
    expect(cost).toContain(`${name} bills your own key by usage`);
  });

  it.each(PROVIDERS)("$name: the cost line holds no digit and no currency sign", ({ id }) => {
    expect(costLine(id)).not.toMatch(/\d|[$€£¥]/);
  });

  it.each(PROVIDERS)("$name: nowhere in the guide is there a dollar figure, a monthly total or a per-day basis", ({ id }) => {
    const text = guideText(id);
    expect(text).not.toMatch(/[$€£¥]/);
    expect(text).not.toMatch(/\/\s?month|per month|a month|per day|opened Deep reports/i);
    expect(text).not.toMatch(/Heavy-use|Estimate assumes|introductory/i);
  });
});
