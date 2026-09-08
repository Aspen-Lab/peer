// The page's one loud sentence.
//
// Tier 0's reading column opened on the abstract: eleven lines of body text
// at one size, with two sentences in ink somewhere in the middle. Nothing
// answered "what does this paper say?" above the fold, and the eye had no
// second place to land after the title.
//
// So the claim is lifted out and set at display size, the way Peer's skim
// deck sits above the abstract when a model has read the paper. It is the
// same move for a reader with no key: the paper's own sentence, not Peer's
// words, chosen by the same `marks` the ink uses — and its ink is dropped
// from the abstract below (`PaperWords`, `lead`), so no sentence on this
// page is emphasised twice.

import { LEAD_CLAIM } from "./copy";

export function LeadClaim({ sentence }: { sentence: string }) {
  return (
    <section className="mt-10">
      {/* The one accent mark on the page. The hue is the interface's only
          signal, and this is the only thing on a reading page that Peer
          chose rather than the paper — so it is where the signal belongs. */}
      <span aria-hidden className="block h-[2px] w-8 rounded-full bg-accent mb-4" />
      <p className="font-reading font-medium text-heading text-display-sm leading-[1.28] tracking-[-0.01em] measure-lede">
        {sentence}
      </p>
      <p className="font-sans text-meta text-text-faint mt-3">{LEAD_CLAIM}</p>
    </section>
  );
}
