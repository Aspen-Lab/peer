"use client";

// Mathematics on the reading page.
//
// The extractors keep every formula's TeX, marked (`lib/text/math`); these
// two draw it. KaTeX is loaded once, on the first formula on the page, and
// never on a page without one — it is a quarter of a megabyte, and most of
// what Peer shows has no mathematics in it. Until it arrives, and wherever
// it cannot parse a formula, the TeX itself is set in the mono: readable,
// honest, never blank.
//
//   MathText   a paragraph with formulas in it — the abstract, a quote, a
//              line of the paper — prose in the reading face, formulas inline
//   Equation   a display equation, on a line of its own: the mathematics
//              centred, the paper's number for it at the right, and its TeX a
//              click away for a note or a draft

import { useEffect, useState, type ReactNode } from "react";
import "katex/dist/katex.min.css";
import type { ReadingEquation } from "@/lib/papers/reading";
import { splitMath } from "@/lib/text/math";
import { cn } from "@/lib/cn";

type Katex = typeof import("katex").default;
let loading: Promise<Katex> | null = null;
let loaded: Katex | null = null;

function loadKatex(): Promise<Katex> {
  loading ??= import("katex").then((m) => {
    loaded = m.default;
    return loaded;
  });
  return loading;
}

/** KaTeX once it is here; null on the first render of a page that has not
 *  loaded it yet, and a re-render when it lands. */
function useKatex(): Katex | null {
  const [katex, setKatex] = useState<Katex | null>(loaded);
  useEffect(() => {
    if (katex) return;
    let live = true;
    void loadKatex().then((k) => {
      if (live) setKatex(k);
    });
    return () => {
      live = false;
    };
  }, [katex]);
  return katex;
}

function render(katex: Katex | null, tex: string, display: boolean): ReactNode {
  if (!katex) {
    return <code className={cn("font-mono text-meta text-text-muted", display && "block whitespace-pre-wrap")}>{tex}</code>;
  }
  const html = katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    // A formula the parser refuses is shown as its TeX, in the mono, in the
    // text colour — not in KaTeX's red.
    errorColor: "var(--color-text-muted)",
    strict: "ignore",
    output: "htmlAndMathml",
  });
  // KaTeX's HTML is built from the TeX by KaTeX, with every character
  // escaped; nothing from the page reaches it unparsed.
  return <span className={display ? "block" : undefined} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A paragraph as the reader should see it: its prose, and its formulas
 *  drawn where they stand. Prose with no formula costs one comparison. */
export function MathText({ text }: { text: string }) {
  const runs = splitMath(text);
  const katex = useKatex();
  if (runs.length === 1 && runs[0].kind === "text") return <>{text}</>;
  return (
    <>
      {runs.map((run, i) =>
        run.kind === "text" ? (
          <span key={i}>{run.value}</span>
        ) : (
          // A formula is one unbreakable box. One wider than the column —
          // LaTeXML sets a whole "where head_i = …" clause inline — used to
          // push the page out sideways on a phone; it scrolls in place now,
          // and the prose around it stays where it was.
          <span key={i} className="inline-block max-w-full overflow-x-auto align-middle">
            {render(katex, run.value, false)}
          </span>
        ),
      )}
    </>
  );
}

export function Equation({ equation }: { equation: ReadingEquation }) {
  const katex = useKatex();
  const [copied, setCopied] = useState(false);
  const tex = equation.latex;

  const copy = () => {
    if (!tex) return;
    void navigator.clipboard?.writeText(tex).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    // The rule at the left is the reader's own sign for a block set apart —
    // the same hairline the panel and the bands use — and the number sits
    // where the paper printed it, at the right.
    <div className="group/eq relative my-6 flex items-center gap-4 border-l border-border-strong py-3 pl-5 pr-2">
      <div className="min-w-0 flex-1 overflow-x-auto text-center text-heading [&_.katex-display]:my-0">
        {tex ? (
          render(katex, tex, true)
        ) : (
          // A PDF's equation is the line as printed — no TeX to draw from.
          <code className="block whitespace-pre-wrap font-mono text-body text-text">{equation.text}</code>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {equation.number && <span className="annotation tabular-nums text-text-faint">{equation.number}</span>}
        {tex && (
          <button
            type="button"
            onClick={copy}
            title="Copy the TeX"
            className="eyebrow px-1.5 py-0.5 text-text-faint opacity-0 shadow-[inset_0_0_0_1px_var(--color-border-strong)] transition-opacity hover:text-heading focus:opacity-100 group-hover/eq:opacity-100"
          >
            {copied ? "copied" : "TeX"}
          </button>
        )}
      </div>
    </div>
  );
}
