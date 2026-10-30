import { test } from "__P12_SCRATCH__/p504/wt/web/node_modules/vitest/dist/index.js";
import { readFileSync, writeFileSync } from "node:fs";
import { extractPdfTextFromBytes } from "@/lib/papers/pdf-text";
import { readableSections, readingMapOf } from "@/lib/papers/reading-map";
import { closingPartition, partitionedMap } from "@/lib/papers/reading-partition";

test("dump map", async () => {
  const pdf = process.env.MGR_PDF!;
  const out = process.env.MGR_OUT!;
  const bytes = readFileSync(pdf);
  const t0 = Date.now();
  const res = await extractPdfTextFromBytes(bytes);
  const ms = Date.now() - t0;
  if (!res.ok || !res.doc) {
    writeFileSync(out, JSON.stringify({ ok: false, reason: res.reason, ms }, null, 1));
    return;
  }
  const doc = res.doc;
  const rendered = readableSections(doc);
  const map0 = readingMapOf(rendered);
  const bodyLike = rendered.map((r: any) => ({ id: r.id, canonical: r.section.canonical, paragraphs: r.paragraphs }));
  const abs = (doc.sections.find((s: any) => s.canonical === 'abstract')?.text ?? '');
  const part = closingPartition(map0, bodyLike, abs);
  const map = partitionedMap(map0, bodyLike, part);
  const byId = new Map(rendered.map((r: any) => [r.id, r]));
  const rows = map.sections.map((row, i) => ({
    i,
    id: row.id,
    level: row.level,
    parentId: row.parentId ?? null,
    page: row.page ?? null,
    canonical: row.canonical,
    role: row.role,
    heading: row.heading,
    words: row.words,
    nParas: row.paragraphs.length,
    firstPara: (rendered[i]?.paragraphs[0] ?? "").slice(0, 160),
    lastPara: (rendered[i]?.paragraphs[rendered[i].paragraphs.length - 1] ?? "").slice(-100),
    paragraphs: (() => { const sid = (row as any).part?.sectionId ?? row.id; const src: any = byId.get(sid); return src ? row.paragraphs.map((x: any) => src.paragraphs[x.index]).filter(Boolean) : []; })(),
  }));
  writeFileSync(out, JSON.stringify({ ok: true, ms, pageCount: doc.pageCount, title: doc.title, nDocSections: doc.sections.length, nFigCaps: doc.figureCaptions.length, rows }, null, 1));
}, 600_000);
