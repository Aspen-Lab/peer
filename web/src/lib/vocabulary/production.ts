import { readFile } from "node:fs/promises";
import { join } from "node:path";
import defaultManifest from "./assets/manifest.json";
import type { VocabularyRecord } from "./schema";
import { verifyVocabularyManifest } from "./verifier";

const DEFAULT_ROOT = join(process.cwd(), "src", "lib", "vocabulary");

// This is the only production reader. It deliberately exposes no rejected
// record, so an attribution page cannot accidentally display unverified data.
//
// P1-03 F-A-03D (Round 3): `root` is optional so a test can exercise this
// full composition (this function -> verifyVocabularyManifest) against an
// invented, disposable manifest+asset tree instead of writing fixtures into
// the real production `assets/` directory. The real caller (`page.tsx`)
// always calls this with zero arguments, which keeps the exact original
// mechanism unchanged: the real `manifest.json` is bundled at build time via
// a static import, never read from disk at request time, so production
// behaviour and build/tracing are byte-for-byte identical to before. Only a
// test-supplied, non-default root reads its manifest.json from disk.
export async function listApprovedProductionVocabularyRecords(
  root: string = DEFAULT_ROOT,
): Promise<VocabularyRecord[]> {
  const manifest = root === DEFAULT_ROOT
    ? defaultManifest
    : JSON.parse(await readFile(join(root, "assets", "manifest.json"), "utf8"));
  return (await verifyVocabularyManifest(manifest, root)).approved;
}
