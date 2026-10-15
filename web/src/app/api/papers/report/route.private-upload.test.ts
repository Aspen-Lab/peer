// P0-05 (§1e.1, A's F1, privacy) — the real chain, end to end in-process:
// the upload route stores an owner's PDF, and the report route is asked for
// it by someone else under a case-variant id. Only the request cookie jar
// (`next/headers`), the model registry and the model passes are stubbed;
// `upload-store`, `upload-access`, `full-text` and pdf.js are real. Adapted
// from A's P0-04 probe `p2-routes`, which showed the variant getting a 200
// and the deep pass receiving the owner's text on both transports.
import { rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { minimalPdf, prose, type Run } from "@/lib/papers/minimal-pdf.test-helper";

const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "peer-report-private-upload-test-"));
  process.env.PEER_PRIVATE_UPLOAD_DIR = dir;
  return dir;
});

const mocks = vi.hoisted(() => ({
  token: { value: undefined as string | undefined },
  pdfOpens: { n: 0 },
  deepDocs: [] as unknown[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "peer-private-uploads" && mocks.token.value ? { name, value: mocks.token.value } : undefined),
    set: (name: string, value: string) => {
      if (name === "peer-private-uploads") mocks.token.value = value;
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock("unpdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("unpdf")>();
  return {
    ...actual,
    getDocumentProxy: (...args: Parameters<typeof actual.getDocumentProxy>) => {
      mocks.pdfOpens.n += 1;
      return actual.getDocumentProxy(...args);
    },
  };
});
vi.mock("@/lib/llm/providers/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/providers/registry")>();
  return {
    ...actual,
    resolveProvider: () => ({ name: "stub", generateJsonText: async () => JSON.stringify({ title: null }) }),
  };
});
vi.mock("@/lib/papers/deep-report", () => ({
  generateDeepReport: async (input: { doc: unknown }) => {
    mocks.deepDocs.push(input.doc);
    return {
      skim: [],
      whatItProposes: { summary: "", methods: [] },
      resultsAndSignificance: { summary: "", keyResults: [] },
      provenance: { basis: "model-full-text", droppedClaims: 0 },
      depth: "deep",
    };
  },
  buildPaywalledFallback: () => ({ noLlm: true }),
}));
vi.mock("@/lib/papers/figure-binding", () => ({ bindFiguresToReport: async (input: { report: unknown }) => input.report }));
vi.mock("@/lib/figures/extract", () => ({ getFigurePool: async () => null }));

import { POST as uploadPOST } from "@/app/api/papers/upload/route";
import { POST as reportPOST } from "./route";

afterAll(async () => {
  delete process.env.PEER_PRIVATE_UPLOAD_DIR;
  await rm(uploadDir, { recursive: true, force: true });
});

const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const SECRET = "Quillwortane";

const PAPER: Run[][] = [
  [
    ["Grain Boundaries Set The Pace Of Creep", 72, 70, 18],
    ["Abstract", 72, 140, 14, true],
    ...prose([`We measure creep in ${SECRET} alloys with many grain boundaries per cubic micron.`, "Boundary density sets the creep rate across three decades of applied stress."], 160),
    ["1 Introduction", 72, 210, 11, true],
    ...prose(["Creep limits the life of parts that run hot for years at a time under load.", "Grain boundaries are where most of the creep strain is thought to happen."], 230),
  ],
];

async function uploadAsOwner(): Promise<string> {
  mocks.token.value = OWNER;
  const form = new FormData();
  form.set("rightsVersion", "2026-09-19");
  form.set("file", new File([minimalPdf(PAPER) as unknown as BlobPart], "paper.pdf", { type: "application/pdf" }));
  const res = await uploadPOST(new Request("http://localhost/api/papers/upload", {
    method: "POST", headers: { "sec-fetch-site": "same-origin" }, body: form,
  }));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: string };
  return body.id;
}

function report(paperId: string, accept: string): Promise<Response> {
  return reportPOST(new NextRequest("http://localhost/api/papers/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: accept },
    body: JSON.stringify({ paper: { id: paperId, title: "x" }, deepReport: true }),
  }));
}

describe("POST /api/papers/report — P0-05, another owner's upload under a case-variant id", () => {
  let id = "";

  beforeEach(async () => {
    if (!id) id = await uploadAsOwner();
    mocks.deepDocs.length = 0;
    mocks.pdfOpens.n = 0;
  });

  it.each(["application/json", "application/x-ndjson"])("answers a stranger 404 for UPLOAD:<hash16>, and the owner's text reaches no model (%s)", async (accept) => {
    const hash = id.slice("upload:".length);
    mocks.token.value = STRANGER;

    const variant = await report(`UPLOAD:${hash}`, accept);
    const canonical = await report(`upload:${hash}`, accept);

    expect(variant.status).toBe(404);
    expect(await variant.json()).toEqual({ error: "Upload not found." });
    expect(canonical.status).toBe(404);
    expect(mocks.deepDocs).toEqual([]);
    expect(mocks.pdfOpens.n).toBe(0);
  });

  it("still serves the owner under the canonical id (the harness reaches the deep pass)", async () => {
    mocks.token.value = OWNER;

    const res = await report(id, "application/x-ndjson");
    const events = (await res.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type: string });

    expect(res.status).toBe(200);
    expect(events.some((event) => event.type === "report")).toBe(true);
    expect(mocks.deepDocs).toHaveLength(1);
    expect(JSON.stringify(mocks.deepDocs[0])).toContain(SECRET);
  });
});
