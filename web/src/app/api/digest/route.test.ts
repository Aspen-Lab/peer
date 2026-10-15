import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { inspect } from "node:util";
import {
  deployedRuntimeEnv,
  signedIn,
  signedOut,
  supabaseServerStub,
} from "@/test-support/route-harness";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

const mocks = vi.hoisted(() => ({
  resolveProvider: vi.fn(),
  generateDigest: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/llm/providers/registry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/llm/providers/registry")>();
  return { ...actual, resolveProvider: mocks.resolveProvider };
});
// The session, for the cases below that drive the deployed-runtime gate.
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(supabaseServerStub(mocks.getUser)),
}));

import { POST } from "./route";

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/digest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCounterStoreForTests();
  mocks.generateDigest.mockResolvedValue({
    bullets: [{ paperId: "paper-1", text: "Finding" }],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetCounterStoreForTests();
});

describe("POST /api/digest", () => {
  it("returns Tier 0 without making a model call when no provider resolves", async () => {
    mocks.resolveProvider.mockReturnValue(null);

    const response = await POST(
      request({ papers: [{ id: "paper-1", title: "Paper" }] }),
    );

    expect(await response.json()).toEqual({ bullets: [], noLlm: true });
    expect(mocks.generateDigest).not.toHaveBeenCalled();
  });

  it("passes the user's override and bounds model input", async () => {
    mocks.resolveProvider.mockReturnValue({
      id: "openai",
      generateDigest: mocks.generateDigest,
    });
    const llmOverride = { provider: "openai", apiKey: "user-key" };
    const papers = Array.from({ length: 25 }, (_, index) => ({
      id: `paper-${index + 1}`,
      title: "x".repeat(900),
    }));

    const response = await POST(
      request({ papers, contextHint: "c".repeat(5_000), llmOverride }),
    );

    expect(response.status).toBe(200);
    // The provider is resolved from the reader's own override and nothing
    // else: one argument, asserted so a call that grows a second one (a
    // server-owned fallback) cannot pass.
    expect(mocks.resolveProvider).toHaveBeenCalledWith(llmOverride);
    expect(mocks.generateDigest).toHaveBeenCalledWith({
      papers: expect.arrayContaining([
        expect.objectContaining({ id: "paper-1" }),
      ]),
      contextHint: "c".repeat(4_000),
    });
    const call = mocks.generateDigest.mock.calls[0][0];
    expect(call.papers).toHaveLength(20);
    expect(call.papers[0].title).toHaveLength(800);
  });

  // P5-06b item 1 (§1h.20 (a)): the failure line says the kind and the status of
  // the error, never the error. The prompt this route sends holds the papers'
  // abstracts and the reader's `contextHint` (up to 4,000 characters of their own
  // profile text); an OpenAI-compatible provider's thrown message holds up to 400
  // characters of the response body, and a body can quote the request. The route's
  // answer to the caller is not changed by this: a failure is still the reading
  // without a model.
  describe("when the provider throws", () => {
    // Invented. Not a title, a brief or a profile line that anyone has.
    const MARKER = "Quillfeather-Tarn-marker";
    const papers = [{ id: "paper-1", title: "Paper" }];

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
      mocks.resolveProvider.mockReturnValue({
        id: "openai",
        generateDigest: mocks.generateDigest,
      });
    });

    afterEach(() => {
      for (const spy of spies.splice(0)) spy.mockRestore();
    });

    /** One console argument as text, objects and errors in depth (their message and stack included). */
    function render(argument: unknown): string {
      return typeof argument === "string"
        ? argument
        : inspect(argument, { depth: 10, breakLength: Infinity });
    }

    function everythingLogged(): string {
      return calls.map((c) => c.args.map(render).join(" ")).join("\n");
    }

    it("an Error whose message quotes the prompt and carries status 400: the same answer as today, one line with the kind and the status, no argument holds the quoted text", async () => {
      mocks.generateDigest.mockRejectedValue(
        Object.assign(
          new Error(`OpenAI API error 400: {"error":"bad request: ${MARKER} is not valid"}`),
          { status: 400 },
        ),
      );

      const response = await POST(
        request({ papers, contextHint: `my open question is ${MARKER}` }),
      );

      // What the caller sees is unchanged: a failure is the reading without a model.
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ bullets: [], noLlm: false });

      const errors = calls.filter((c) => c.method === "error");
      expect(errors).toHaveLength(1);
      const line = errors[0].args;
      expect(line).toHaveLength(1);
      expect(line[0]).toBe("[digest] openai error: Error status 400");
      expect(String(line[0])).toContain("[digest]");
      expect(String(line[0])).toContain("openai");
      expect(String(line[0])).toContain("Error");
      expect(String(line[0])).toContain("400");
      // No console method of any level carries the quoted text.
      expect(everythingLogged()).not.toContain(MARKER);
    });

    it("a thrown string: the line says string and nothing of the string", async () => {
      mocks.generateDigest.mockRejectedValue(`the provider said: ${MARKER}`);

      const response = await POST(request({ papers }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ bullets: [], noLlm: false });
      const errors = calls.filter((c) => c.method === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0].args).toEqual(["[digest] openai error: string"]);
      expect(everythingLogged()).not.toContain(MARKER);
    });
  });

  describe("in a deployed runtime", () => {
    const papers = [{ id: "paper-1", title: "Paper" }];

    beforeEach(() => {
      deployedRuntimeEnv(vi.stubEnv);
    });

    it("answers a signed-out caller 401 and resolves no provider", async () => {
      mocks.getUser.mockResolvedValue(signedOut());

      const response = await POST(request({ papers }));

      expect(response.status).toBe(401);
      expect(mocks.resolveProvider).not.toHaveBeenCalled();
      expect(mocks.generateDigest).not.toHaveBeenCalled();
    });

    it("gives a signed-in reader with no key of their own the reading without a model", async () => {
      // Peer holds no model key, so the registry answers null for a request
      // that carries no override (`registry.test.ts` pins that); the route
      // then answers with the reading without a model, not an error.
      mocks.getUser.mockResolvedValue(signedIn("user-1"));
      mocks.resolveProvider.mockReturnValue(null);

      const response = await POST(request({ papers }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ bullets: [], noLlm: true });
      expect(mocks.resolveProvider).toHaveBeenCalledWith(null);
    });
  });
});
