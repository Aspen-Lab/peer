import type { PreferenceConcept } from "@/types";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { normalizePreferenceLabel, preferenceKey } from "./ledger";

// A conservative, local phrase extractor. No document text is sent to a model
// for preference learning. References, author blocks and boilerplate are out.
const STOP = new Set(("a an the and or of for to in on at by from with without into as is are was were be been being " +
  "this that these those it its their our we they you can may could should will would not no than then " +
  "using used use based via between during through over under more most also such which where when how " +
  "study studies paper article work research results result show shows shown found demonstrate demonstrated " +
  "measure measures measured improve improves improved support supports supported enable enables achieve achieves " +
  "propose proposed present presents presented new novel high low large small significant significantly " +
  "however therefore respectively compared comparison introduction abstract conclusion conclusions " +
  "figure figures table supplementary copyright reserved rights publisher doi http https www et al").split(/\s+/));

export function extractUploadConcepts(doc: ExtractedDocument): PreferenceConcept[] {
  const sections = [
    { canonical: "title", text: doc.title ?? "", weight: 4 },
    ...doc.sections.filter((s) => !/reference|bibliograph|acknowledg|funding|author/i.test(s.canonical + " " + s.heading))
      .map((s) => ({ ...s, weight: s.canonical === "abstract" ? 3 : /method|result|conclusion/.test(s.canonical) ? 2 : 1 })),
  ];
  const candidates = new Map<string, { count: number; score: number; section: string; title: boolean }>();
  for (const section of sections) {
    const tokens = section.text.slice(0, 14000).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*|[.,;:!?\n]/gu) ?? [];
    for (let start = 0; start < tokens.length; start++) {
      for (let length = 1; length <= 3 && start + length <= tokens.length; length++) {
        const parts = tokens.slice(start, start + length);
        if (parts.some((t) => STOP.has(t) || !/\p{L}/u.test(t) || t.length < 3)) break;
        if (length === 1 && parts[0].length < 5) continue;
        const label = normalizePreferenceLabel(parts.join(" "));
        const old = candidates.get(label);
        candidates.set(label, { count: (old?.count ?? 0) + 1,
          score: (old?.score ?? 0) + section.weight * (length === 1 ? 0.45 : length),
          section: old?.section ?? section.canonical, title: !!old?.title || section.canonical === "title" });
      }
    }
  }
  const ranked = [...candidates].filter(([label, c]) => label.length <= 70 && (c.title || c.count >= 2))
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]));
  const out: PreferenceConcept[] = [];
  for (const [label, c] of ranked) {
    if (out.some((p) => p.label.includes(label) || label.includes(p.label))) continue;
    out.push({ key: preferenceKey(label), label, source: "uploaded_article", section: c.section,
      confidence: Math.min(0.95, (c.title ? 0.65 : 0.45) + Math.min(c.count, 5) * 0.06) });
    if (out.length === 12) break;
  }
  return out;
}

export function matchesUploadedPaper(target: { title: string; doi?: string }, title: string, doi?: string): boolean {
  const normalizeDoi = (value: string) => value.toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi.org\//, "").trim();
  const tokens = (value: string) => new Set(normalizePreferenceLabel(value).split(" ").filter((t) => t.length > 2 && !STOP.has(t)));
  const expected = tokens(target.title);
  const actual = tokens(title);
  const overlap = [...expected].filter((word) => actual.has(word)).length;
  const fraction = overlap / Math.max(1, Math.min(expected.size, actual.size));
  if (target.doi && doi && normalizeDoi(target.doi) !== normalizeDoi(doi)) return false;
  return overlap >= 2 && fraction >= 0.6;
}
