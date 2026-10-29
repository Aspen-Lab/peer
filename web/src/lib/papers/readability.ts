import type { FullTextResult } from "./full-text";

export type Readability = "readable" | "abstract" | "unknown";

export function hasReadableText(body: string): boolean {
  const visible = body.replace(/\s/g, "");
  const letters = (visible.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return visible.length >= 240 && letters / visible.length >= 0.35;
}

/** A failed source does not prove that no readable version exists. */
export function readabilityOf(result: FullTextResult | null): Readability {
  if (!result) return "unknown";
  if (result.status === "ok") {
    const body = result.doc?.sections?.filter((s) => s.canonical !== "abstract").map((s) => s.text ?? "").join(" ") ?? "";
    // A heading or a damaged text layer is not a readable paper.
    return hasReadableText(body) ? "readable" : "unknown";
  }
  if (result.status === "source_unavailable") return "unknown";
  if (result.attempts.some(({ outcome }) => outcome.startsWith("source_unavailable") && !/pdf-empty:|no-text-layer/i.test(outcome))) return "unknown";
  return "abstract";
}
