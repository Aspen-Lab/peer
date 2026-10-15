import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// P9-36 (the owner's decision, §1a.18 (f): job and event information is not
// processed, the two features are stopped). The Profile page and the shared
// AI-setup panel (the Profile's, and /welcome's AI step) name no Events or Jobs
// to a reader, and read no event or job list from any store, type or helper.
//
// The scan reads each file with the TypeScript parser rather than with a regex
// over the text, so that it sees exactly what can reach a reader — string and
// template literals, JSX text, attribute strings — and exactly what the code
// names — identifiers — and never a comment (a comment may say why a thing is
// gone) or an import path.

type Scan = { strings: string[]; identifiers: string[] };

function scanSource(text: string): Scan {
  const source = ts.createSourceFile(
    "scan.tsx",
    text.replace(/^﻿/, ""),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const strings: string[] = [];
  const identifiers: string[] = [];
  const visit = (node: ts.Node) => {
    // Module specifiers are paths, not copy.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      strings.push(node.text);
    } else if (ts.isIdentifier(node)) {
      identifiers.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { strings, identifiers };
}

/** `eventPool` -> ["event", "pool"]; `preventDefault` -> ["prevent", "default"]. */
function words(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s_]+/);
}

const COPY_WORD = /\b(events?|jobs?)\b/i;

function copyHits(scan: Scan): string[] {
  return scan.strings.filter((s) => COPY_WORD.test(s));
}

function identifierHits(scan: Scan): string[] {
  return [...new Set(scan.identifiers)].filter((id) =>
    words(id).some((w) => w === "event" || w === "events" || w === "job" || w === "jobs"),
  );
}

const FILES = {
  "the AI-setup panel": "src/components/profile/ai-setup.tsx",
  "the Profile page": "src/app/profile/page.tsx",
} as const;

describe("the scan itself (control: it must be able to fail)", () => {
  const sample = [
    '"use client";',
    'import { x } from "@/lib/events/types";',
    "// a comment may say Events and Jobs are gone",
    "export function A() {",
    "  const saved = useFeedStore((s) => s.eventPool);",
    "  return <p title=\"Jobs\">Papers, Events, and Jobs {`and ${saved} jobs`}</p>;",
    "}",
  ].join("\n");

  it("finds a user-facing Events / Jobs word in JSX text, an attribute and a template, and not in a comment or an import path", () => {
    const scan = scanSource(sample);
    expect(copyHits(scan)).toEqual(["Jobs", "Papers, Events, and Jobs ", " jobs"]);
  });

  it("finds an identifier that names an event or a job, and not a word that merely contains one", () => {
    expect(identifierHits(scanSource(sample))).toEqual(["eventPool"]);
    expect(identifierHits(scanSource("e.preventDefault(); const eventual = 1; const jobless = 2;"))).toEqual([]);
  });
});

describe.each(Object.entries(FILES))("%s names no Events or Jobs (P9-36)", (_name, path) => {
  const scan = scanSource(readFileSync(join(process.cwd(), path), "utf8"));

  it("has string, JSX and attribute text to scan (the scan is not vacuous)", () => {
    expect(scan.strings.length).toBeGreaterThan(50);
  });

  it("shows a reader no string that says Events or Jobs", () => {
    expect(copyHits(scan)).toEqual([]);
  });

  it("names no identifier that is an event or a job list, type or helper", () => {
    expect(identifierHits(scan)).toEqual([]);
  });
});
