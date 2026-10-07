import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { captureConsole, type ConsoleCapture } from "@/test-support/console-capture";

// P5-06 item 2 (S1, §1h.19 (b)). /privacy says of the preference ledger that
// travels in each briefing request: "the server uses these words for that one
// request and keeps none of it". `page.questionterms.test.tsx` pins that with
// text — it greps the `console.*` calls of `route.ts` and `pipeline.ts` for
// /ledger/i — and a log of the whole request object (`console.info("[feed]
// scoring request", req)`, A P5-05's Q8b) has no such word in the call, so it
// passed the whole suite. This is the behavioural pin beside the text ones: the
// real feed route and the real pipeline run with a request whose ledger holds an
// invented word as question evidence, every source and the pool stubbed, every
// console method watched, and not one console argument — rendered in depth, an
// object's fields included — holds the word. It is also not in the answer.

const mocks = vi.hoisted(() => ({
  requireAiRequest: vi.fn(),
  aiTierCeiling: vi.fn(),
}));

// The caller is a signed-out reader, as the /privacy sentence is about: the
// gate lets them through at tier 0 and no account store exists.
vi.mock("@/lib/security/ai-request", () => ({
  requireAiRequest: mocks.requireAiRequest,
  aiTierCeiling: mocks.aiTierCeiling,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

import { POST } from "./route";
import { runFeedPipeline } from "@/lib/feed/pipeline";
import { bySourceId } from "@/lib/sources";
import type { RawItem } from "@/lib/sources/types";
import { applyQuestionTermSignal } from "@/lib/preferences/ledger";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

// Invented. A single lower-case word, as a question term is; no paper has it.
const MARKER = "quillfeathertarn";
const FIXED_NOW = new Date(2026, 8, 28, 9, 0);
const RECENT = "2026-09-24";

/** A ledger holding the marker as the one word of a settled question, on an invented paper id. */
function ledgerWithMarker() {
  return applyQuestionTermSignal({}, "openalex:W0000001", [{ term: MARKER, weight: 0.2 }], "2026-10-07T00:00:00.000Z");
}

function paper(id: string, title: string): RawItem {
  return {
    id,
    source: "openalex",
    title,
    authors: ["Researcher"],
    abstract: `${title}: a study of the subject.`,
    url: `https://example.org/${id}`,
    publishedAt: RECENT,
    venue: "Journal of Testing",
    metadata: {},
  };
}

const originalOpenalexFetch = bySourceId.openalex.fetch;
let openalex: ReturnType<typeof vi.fn>;
let consoleText: ConsoleCapture;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  // Nothing in this file may leave the machine: the one source is stubbed and
  // any other request fails.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in this test"); }));
  resetCounterStoreForTests();
  mocks.requireAiRequest.mockResolvedValue({ user: null, anonymous: true });
  mocks.aiTierCeiling.mockImplementation((tier: number, gate: { anonymous: boolean }) => (gate.anonymous ? 0 : tier));
  consoleText = captureConsole();
});

afterEach(() => {
  consoleText.restore();
  bySourceId.openalex.fetch = originalOpenalexFetch;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubSource(topic: string): void {
  openalex = vi.fn(async () => [
    paper("openalex:W9000001", `A study of ${topic} in practice`),
    paper("openalex:W9000002", `${topic}: a second look`),
    paper("openalex:W9000003", `Notes on ${topic} and its limits`),
  ]);
  bySourceId.openalex.fetch = openalex as unknown as typeof bySourceId.openalex.fetch;
}

describe("the ledger is used for one request and written nowhere (P5-06, S1)", () => {
  it("the feed route: a request carrying a ledger with the marker, answered from stubbed sources, puts the marker in no console argument and not in the answer", async () => {
    const topic = "route lattice thermal conductivity";
    stubSource(topic);

    const response = await POST(
      new NextRequest("http://localhost/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topics: [topic],
          sources: ["openalex"],
          aiTier: 0,
          preferenceLedger: ledgerWithMarker(),
        }),
      }),
    );
    const answer = await response.text();

    // The premise: the request was served, the pool was built from the stubbed
    // source and papers came back — the scoring the log would sit beside ran.
    expect(response.status).toBe(200);
    expect(openalex).toHaveBeenCalled();
    expect(JSON.parse(answer).items.length).toBeGreaterThan(0);
    expect(answer).not.toContain(MARKER);
    expect(consoleText.text()).not.toContain(MARKER);
  });

  it("the pipeline's scoring entry: the same ledger, handed to runFeedPipeline directly, is in no console argument", async () => {
    const topic = "pipeline lattice thermal conductivity";
    stubSource(topic);
    const ledger = ledgerWithMarker();

    const result = await runFeedPipeline(
      { topics: [topic], sources: ["openalex"], aiTier: 0, preferenceLedger: ledger },
      { now: FIXED_NOW },
    );

    expect(openalex).toHaveBeenCalled();
    expect(result.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(MARKER);
    expect(consoleText.text()).not.toContain(MARKER);
  });

  it("the watch is real: a console method given the request would show the marker (the capture renders objects in depth)", () => {
    // Without this, a capture that dropped objects would make both cases above vacuous.
    console.info("[feed] scoring request", { preferenceLedger: ledgerWithMarker() });
    console.debug(["x", { deeper: { ledger: ledgerWithMarker() } }]);
    expect(consoleText.text()).toContain(MARKER);
  });
});
