// The receipt under a model claim: the paper's sentence, verbatim, with
// where it came from. Italic and a step smaller than the claim, indented,
// no rule, no box, no quote glyph — the attribution is the mark.

import { attribution } from "./copy";

export function EvidenceQuote({ text, where }: { text: string; where: string }) {
  return (
    <p className="font-reading italic text-body leading-[1.55] text-text-muted pl-5 mt-1.5">
      {text}
      <span className="font-mono not-italic text-meta text-text-faint ml-2">
        — {attribution(where)}
      </span>
    </p>
  );
}
