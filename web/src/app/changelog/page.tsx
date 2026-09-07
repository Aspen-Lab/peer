// Public changelog page — reads /public/CHANGELOG.md at request time
// and renders it with brand styling. No third-party markdown lib;
// the source format is fully ours, parser handles only what we emit.

import fs from "node:fs/promises";
import path from "node:path";
import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Changelog · Peer",
  description: "What we shipped, and when. Peer development log.",
};

// 1-min revalidate so a CHANGELOG push is reflected without redeploy.
export const revalidate = 60;

interface Entry {
  version: string;
  date: string;
  title: string;
  body: string;
}

interface Parsed {
  intro: string;
  entries: Entry[];
}

function parseChangelog(md: string): Parsed {
  const sections = md.split(/^## /m);
  const head = sections[0];
  const intro = head
    .replace(/^# Changelog\s*/m, "")
    .replace(/^---\s*$/m, "")
    .trim();

  const entries: Entry[] = [];
  for (const section of sections.slice(1)) {
    const lines = section.split("\n");
    const headerMatch = lines[0].match(/^v(\S+)\s*[—-]+\s*(.+?)\s*$/);
    if (!headerMatch) continue;
    const [, version, date] = headerMatch;
    let titleIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (/^\*\*(.+)\*\*\s*$/.test(lines[i])) {
        titleIdx = i;
        break;
      }
    }
    const title =
      titleIdx >= 0
        ? (lines[titleIdx].match(/^\*\*(.+)\*\*\s*$/) as RegExpMatchArray)[1]
        : "";
    const body = lines
      .slice(titleIdx + 1)
      .join("\n")
      .trim();
    entries.push({ version, date, title, body });
  }
  return { intro, entries };
}

async function loadChangelog(): Promise<Parsed> {
  const file = await fs.readFile(
    path.join(process.cwd(), "public", "CHANGELOG.md"),
    "utf8",
  );
  return parseChangelog(file);
}

// Minimal inline markdown — bold, code, links. Escaping is implicit
// since we render through React, not innerHTML.
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIdx = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) out.push(text.slice(lastIdx, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(
        <strong key={key++} className="text-text-heading font-semibold">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("`")) {
      out.push(
        <code
          key={key++}
          className="px-1.5 py-0.5 rounded bg-bg-secondary/60 text-meta font-mono text-text-heading"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      const linkM = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkM) {
        out.push(
          <a
            key={key++}
            href={linkM[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-text-faint/40 underline-offset-2 hover:decoration-accent hover:text-accent transition-colors"
          >
            {linkM[1]}
          </a>,
        );
      } else {
        out.push(tok);
      }
    }
    lastIdx = m.index + tok.length;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return out;
}

function renderBody(body: string): ReactNode {
  const paragraphs = body.split(/\n\n+/);
  return paragraphs.map((p, i) => (
    <p
      key={i}
      className="text-body leading-[1.65] text-text-body font-reading"
    >
      {renderInline(p.replace(/\n/g, " "))}
    </p>
  ));
}

export default async function ChangelogPage() {
  const { intro, entries } = await loadChangelog();
  return (
    <main
      className="mx-auto max-w-2xl px-6 pt-20 pb-24 font-sans"
    >
      <header className="mb-14 animate-fade-in-up">
        <p className="text-micro font-semibold uppercase tracking-[0.22em] text-accent mb-3">
          Peer · Changelog
        </p>
        <h1 className="text-display lg:text-display-lg leading-[1.02] text-text-heading font-light tracking-[-0.01em] font-display">
          What we shipped.
        </h1>
        {intro && (
          <p
            className="mt-5 text-body-lg leading-[1.6] text-text-muted max-w-prose font-reading"
          >
            {intro}
          </p>
        )}
      </header>

      <ol className="space-y-7">
        {entries.map((e, i) => (
          <li
            key={e.version}
            className="rounded-2xl bg-surface shadow-card px-7 py-6 animate-fade-in-up"
            style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
          >
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-micro font-semibold uppercase tracking-[0.18em] text-accent tabular-nums">
                v{e.version}
              </span>
              <span className="text-micro text-text-faint tabular-nums">
                {e.date}
              </span>
            </div>
            <h2
              className="text-display-xs leading-[1.18] text-text-heading font-light mb-3 tracking-[-0.005em] font-display"
            >
              {e.title}
            </h2>
            <div className="space-y-3">{renderBody(e.body)}</div>
          </li>
        ))}
      </ol>

      <footer className="mt-16 pt-6 border-t border-text-faint/15 text-meta text-text-faint leading-relaxed">
        Source of truth:{" "}
        <a
          href="https://github.com/Aspen-Lab/Peer/blob/main/web/public/CHANGELOG.md"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-text-faint/40 underline-offset-2 hover:decoration-accent hover:text-accent transition-colors"
        >
          CHANGELOG.md on main
        </a>
        . Raw markdown is also served at{" "}
        <a
          href="/CHANGELOG.md"
          className="underline decoration-text-faint/40 underline-offset-2 hover:decoration-accent hover:text-accent transition-colors"
        >
          /CHANGELOG.md
        </a>
        .
      </footer>
    </main>
  );
}
