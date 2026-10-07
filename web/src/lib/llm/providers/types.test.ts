import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import { safeParseDigest } from "./types";

// P5-06b item 2 (§1h.20 (b)). A model reply that does not parse as a digest is
// logged by length (and whether it began like JSON), never by its characters:
// the prompt holds the papers' abstracts and the reader's own profile text, and
// a reply can quote either. What `safeParseDigest` returns to its five callers is
// not under test here to change, only to stay: a digest, or null. Every marker is
// invented.
const MARKER = "Quillfeather-Tarn-marker";

type Call = { method: "log" | "info" | "debug" | "warn" | "error"; args: unknown[] };
const calls: Call[] = [];
const spies: { mockRestore: () => void }[] = [];

beforeEach(() => {
  calls.length = 0;
  for (const method of ["log", "info", "debug", "warn", "error"] as const) {
    spies.push(
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        calls.push({ method, args });
      }),
    );
  }
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

/** One console argument as text, objects in depth. */
function render(argument: unknown): string {
  return typeof argument === "string" ? argument : inspect(argument, { depth: 10, breakLength: Infinity });
}

function everythingLogged(): string {
  return calls.map((c) => c.args.map(render).join(" ")).join("\n");
}

function warnLines(): string[] {
  return calls.filter((c) => c.method === "warn").map((c) => c.args.map(render).join(" "));
}

describe("safeParseDigest — a reply that does not parse is logged by length, never by its characters", () => {
  it("prose that quotes the prompt: null, one warn line with the length, no character of the reply", () => {
    // Longer than 300 characters, with the quoted text inside the first 300 (the
    // old line printed exactly those).
    const reply = `I cannot produce the digest. The context says: ${MARKER}. ${"More words follow. ".repeat(30)}`;
    expect(reply.length).toBeGreaterThan(300);

    expect(safeParseDigest(reply)).toBeNull();

    const lines = warnLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[digest]");
    expect(lines[0]).toContain(String(reply.length));
    expect(lines[0]).toBe(
      `[digest] Could not parse JSON from model response (reply length ${reply.length}, begins like JSON: no)`,
    );
    expect(everythingLogged()).not.toContain(MARKER);
    expect(everythingLogged()).not.toContain("I cannot produce");
  });

  it("a short reply, which the old line printed whole: the length, not the text", () => {
    const reply = `no digest for ${MARKER}`;

    expect(safeParseDigest(reply)).toBeNull();

    expect(warnLines()).toEqual([
      `[digest] Could not parse JSON from model response (reply length ${reply.length}, begins like JSON: no)`,
    ]);
    expect(everythingLogged()).not.toContain(MARKER);
  });

  it("broken JSON that begins with a brace: null, the length, yes, and none of its characters", () => {
    const reply = `{"bullets": [{"paperId": "p1", "text": "${MARKER}`;

    expect(safeParseDigest(reply)).toBeNull();

    expect(warnLines()).toEqual([
      `[digest] Could not parse JSON from model response (reply length ${reply.length}, begins like JSON: yes)`,
    ]);
    expect(everythingLogged()).not.toContain(MARKER);
  });

  it("a reply that begins with a bracket, after leading white space, also says yes", () => {
    const reply = `\n  [{"paperId": "p1", "text": "${MARKER}"}]`;

    expect(safeParseDigest(reply)).toBeNull();

    expect(warnLines()).toEqual([
      `[digest] Could not parse JSON from model response (reply length ${reply.length}, begins like JSON: yes)`,
    ]);
    expect(everythingLogged()).not.toContain(MARKER);
  });

  it("valid JSON that holds no bullets is still null and still logs only a length", () => {
    const reply = JSON.stringify({ note: MARKER, bullets: [] });

    expect(safeParseDigest(reply)).toBeNull();

    expect(warnLines()).toEqual([
      `[digest] Could not parse JSON from model response (reply length ${reply.length}, begins like JSON: yes)`,
    ]);
    expect(everythingLogged()).not.toContain(MARKER);
  });

  it("an empty reply: null, length 0", () => {
    expect(safeParseDigest("")).toBeNull();

    expect(warnLines()).toEqual([
      "[digest] Could not parse JSON from model response (reply length 0, begins like JSON: no)",
    ]);
  });
});

describe("safeParseDigest — a reply that parses logs nothing and returns the digest as before", () => {
  const digest = { bullets: [{ paperId: "paper-1", text: "A finding about tarns." }] };

  it("plain JSON", () => {
    expect(safeParseDigest(JSON.stringify(digest))).toEqual(digest);
    expect(calls).toHaveLength(0);
  });

  it("JSON in a code fence", () => {
    expect(safeParseDigest(`\`\`\`json\n${JSON.stringify(digest)}\n\`\`\``)).toEqual(digest);
    expect(calls).toHaveLength(0);
  });

  it("JSON after reasoning text", () => {
    expect(safeParseDigest(`Let me think about ${MARKER}. Here it is: ${JSON.stringify(digest)} Done.`)).toEqual(digest);
    expect(calls).toHaveLength(0);
  });

  it("bullets that are not shaped as a paper id and a text are dropped, as before", () => {
    const reply = JSON.stringify({
      bullets: [{ paperId: "paper-1", text: "Kept." }, { paperId: 2, text: "Dropped." }, { paperId: "paper-3" }],
    });
    expect(safeParseDigest(reply)).toEqual({ bullets: [{ paperId: "paper-1", text: "Kept." }] });
    expect(calls).toHaveLength(0);
  });
});
