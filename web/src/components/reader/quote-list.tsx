// A block of the paper's own sentences — what the sections tier shows under
// "What they found", "How it was done" and "Where it is thin". Each sentence
// is verbatim and carries the heading it was taken from; the heading over the
// list is the only thing Peer adds.

import { quoteAttribution, type ReadingQuote } from "@/lib/papers/reading";
import { BlockHeading, type BlockName } from "./block-heading";
import { SectionAttribution } from "./evidence-quote";
import { MathText } from "./math";

export function QuoteList({ block, quotes }: { block: BlockName; quotes: ReadingQuote[] }) {
  if (quotes.length === 0) return null;
  return (
    // The Tier 0 twin of `ClaimList`, and the same host. The list is ONE
    // `.rv` — these are the paper's sentences, and prose does not stagger
    // against itself.
    <section data-reveal>
      <BlockHeading block={block} className="rv" />
      {/* The abstract's measure, so the column has one right edge. */}
      <ul className="rv rv-late reading-prose space-y-4 list-none measure-paper">
        {quotes.map((quote) => (
          <li
            key={`${quote.from.heading}${quote.text}`}
            className="font-reading text-lead leading-[1.6] text-text reading-justify"
          >
            <MathText text={quote.text} />
            <span className="annotation text-meta text-text-faint ml-2">
              {/* P1-05 (§1f.13 amendment): a section's "§Heading" goes to
                  that section of the body; a figure's label stays text. */}
              {quote.from.kind === "section" ? (
                <SectionAttribution where={quote.from.heading}>{quoteAttribution(quote.from)}</SectionAttribution>
              ) : (
                quoteAttribution(quote.from)
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
