import { writeFile, access } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";

const outputs = vi.hoisted(() => [] as string[]);
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const execFile = Object.assign(vi.fn(), {
    [promisify.custom]: async (_command: string, args: string[]) => {
      const output = args[args.indexOf("--output") + 1];
      const input = args[args.indexOf("--input") + 1];
      outputs.push(output);
      await writeFile(output, JSON.stringify({ figures: [{ ordinal: 0, caption: input,
        dataBase64: "ZmFrZQ==", mimeType: "image/png" }] }));
      return { stdout: "", stderr: "" };
    },
  });
  return { execFile };
});
import { extractPdfCandidatesFromPath } from "./pdf-extract";

it("isolates concurrent users' figure intermediates and removes every copy after extraction", async () => {
  const first = path.resolve(".local-data/uploads/alice.pdf");
  const second = path.resolve(".local-data/uploads/bob.pdf");
  const [a, b] = await Promise.all([
    extractPdfCandidatesFromPath(first, "publisher"),
    extractPdfCandidatesFromPath(second, "publisher"),
  ]);
  expect(a.candidates[0].caption).toBe(first);
  expect(b.candidates[0].caption).toBe(second);
  expect(new Set(outputs).size).toBe(2);
  for (const output of outputs) {
    expect(path.dirname(output)).not.toBe(path.dirname(first));
    await expect(access(output)).rejects.toThrow();
  }
});
