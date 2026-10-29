"use client";

// Mathematics on the reading page.
//
// The extractors keep every formula's TeX, marked (`lib/text/math`); these
// two draw it. KaTeX is available on the first render so formulas do not
// briefly appear as source code while a separate module is loading.
//
//   MathText   a paragraph with formulas in it — the abstract, a quote, a
//              line of the paper — prose in the reading face, formulas inline
//   Equation   a display equation, on a line of its own: the mathematics
//              centred, the paper's number for it at the right, and its TeX a
//              click away for a note or a draft

import { useEffect, useRef, useState, type ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import "./math-reading.css";
import type { ReadingEquation } from "@/lib/papers/reading";
import { splitMath } from "@/lib/text/math";
import { IconCheck, IconCopy } from "@/components/icons";

/** Some sources wrap the TeX in delimiters even when the whole field is math. */
export function normalizeEquationTex(tex: string): string {
  let value = tex.trim();
  if (value.startsWith("$$") && value.endsWith("$$")) value = value.slice(2, -2).trim();
  else if ((value.startsWith("\\(") && value.endsWith("\\)")) || (value.startsWith("\\[") && value.endsWith("\\]"))) value = value.slice(2, -2).trim();
  else if (value.startsWith("$") && value.endsWith("$")) value = value.slice(1, -1).trim();

  // LaTeXML preserves standard LaTeX constructs that KaTeX does not accept
  // verbatim. Convert equivalent presentation syntax without changing math.
  value = value.replace(/\\mbox(?=\s*\{)/g, "\\text");
  value = value.replace(/\\text\{\s*(\\(?:times|cdot|pm|mp|div|leq|geq|neq|,|;|!|quad|qquad))\s*\}/g, "$1");
  value = value.replace(/\\color\[(rgb|RGB)\]\{\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\}/g, (original, model: string, red: string, green: string, blue: string) => {
    const numbers = [red, green, blue].map(Number);
    const max = model === "rgb" ? 1 : 255;
    if (numbers.some((n) => !Number.isFinite(n) || n < 0 || n > max)) return original;
    const color = numbers.map((n) => Math.round(n * 255 / max).toString(16).padStart(2, "0")).join("");
    return `\\color{#${color}}`;
  });
  return value;
}

/** Keep single symbols in the sentence, but set substantive equations apart. */
export function isSubstantiveEquation(tex: string): boolean {
  const value = normalizeEquationTex(tex).trim();
  return value.length >= 8 && (/=/.test(value) || /\\(?:frac|dfrac|tfrac|sum|prod|int|iint|iiint)\b/.test(value));
}

function render(tex: string, display: boolean): ReactNode {
  const html = katex.renderToString(normalizeEquationTex(tex), {
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

function InlineEquation({ tex }: { tex: string }) {
  const formula = useRef<HTMLSpanElement>(null);
  const [status, setStatus] = useState("");
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(""), 2500);
    return () => window.clearTimeout(timer);
  }, [status]);
  const copyText = async () => {
    try { await navigator.clipboard.writeText(tex); setStatus("TeX copied"); }
    catch { setStatus("Could not copy"); }
  };
  const copyImage = async () => {
    if (!formula.current || copying) return;
    setCopying(true);
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Clipboard unavailable");
      const element = formula.current;
      const image = import("./equation-image").then(({ equationPng }) => equationPng(element));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
      setStatus("Image copied");
    } catch { setStatus("Could not copy image"); }
    finally { setCopying(false); }
  };
  return <span className="reader-inline-math reader-inline-equation">
    <span ref={formula} className="reader-inline-formula">{render(tex, false)}</span>
    <span className="reader-inline-equation-actions">
      <button type="button" onClick={copyText}><IconCopy size={14} /> Copy TeX</button>
      <button type="button" onClick={copyImage} disabled={copying}>{copying ? "Copying…" : "Copy image"}</button>
      <span role="status" aria-live="polite">{status}</span>
    </span>
  </span>;
}

/** A paragraph as the reader should see it: its prose, and its formulas
 *  drawn where they stand. Prose with no formula costs one comparison. */
export function MathText({ text }: { text: string }) {
  const runs = splitMath(text);
  if (runs.length === 1 && runs[0].kind === "text") return <>{text}</>;
  return (
    <>
      {runs.map((run, i) =>
        run.kind === "text" ? (
          <span key={i}>{run.value}</span>
        ) : isSubstantiveEquation(run.value) ? (
          <InlineEquation key={i} tex={run.value} />
        ) : (
          // A formula is one unbreakable box. One wider than the column —
          // LaTeXML sets a whole "where head_i = …" clause inline — used to
          // push the page out sideways on a phone; it scrolls in place now,
          // and the prose around it stays where it was.
          <span key={i} className="reader-inline-math">
            {render(run.value, false)}
          </span>
        ),
      )}
    </>
  );
}

export function Equation({ equation }: { equation: ReadingEquation }) {
  const [status, setStatus] = useState("");
  const [copying, setCopying] = useState(false);
  const formula = useRef<HTMLDivElement>(null);
  const tex = equation.latex || (equation.text && /\\[a-zA-Z]+|^\s*\$/.test(equation.text) ? equation.text : undefined);
  const source = tex || equation.text;

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(""), 2500);
    return () => window.clearTimeout(timer);
  }, [status]);

  const copyText = async () => {
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source);
      setStatus(tex ? "TeX copied" : "Formula copied");
    } catch {
      setStatus("Could not copy. Check clipboard access.");
    }
  };

  const copyImage = async () => {
    if (!formula.current || copying) return;
    setCopying(true);
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Clipboard unavailable");
      const element = formula.current;
      // Start clipboard access during the click; image rendering can finish asynchronously.
      const image = import("./equation-image").then(({ equationPng }) => equationPng(element));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
      setStatus("Image copied");
    } catch {
      setStatus("Could not copy image. Try copying the formula.");
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="reader-equation">
      <div className="reader-equation-toolbar">
        <span className="reader-equation-number">{equation.number || "Formula"}</span>
        <div className="reader-equation-actions">
          {source && <button type="button" onClick={copyText} title={tex ? "Copy TeX" : "Copy formula"}>
            <IconCopy size={15} /> {tex ? "Copy TeX" : "Copy"}
          </button>}
          <button type="button" onClick={copyImage} disabled={copying}>
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 5"/></svg>
            {copying ? "Copying…" : "Copy image"}
          </button>
        </div>
      </div>
      <div className="reader-equation-scroll" role="region" aria-label="Formula, scroll horizontally if needed" tabIndex={0}>
        <div className="reader-equation-formula" ref={formula}>
        {tex ? (
          render(tex, true)
        ) : (
          <code className="reader-equation-plain">{equation.text}</code>
        )}
        </div>
      </div>
      <span className="reader-equation-status" role="status" aria-live="polite">{status && <>{!status.startsWith("Could not") && <IconCheck size={13} />}{status}</>}</span>
    </div>
  );
}
