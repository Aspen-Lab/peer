// A block of the paper's own sentences — what the sections tier shows under
// "What they found", "How it was done" and "Where it is thin". Each sentence
// is verbatim and carries the heading it was taken from; the heading over the
// list is the only thing Peer adds.

import { displayHeading, type ReadingQuote } from "@/lib/papers/reading";
import { BlockHeading, type BlockName } from "./block-heading";

export function QuoteList({
  block,
  quotes,
  stagger,
}: {
  block: BlockName;
  quotes: ReadingQuote[];
  stagger: number;
}) {
  if (quotes.length === 0) return null;
  return (
    <section
      className="animate-fade-in-up"
      style={{ "--i": stagger } as React.CSSProperties}
    >
      <BlockHeading block={block} />
      <ul className="space-y-4 list-none">
        {quotes.map((quote) => (
          <li
            key={`${quote.from.heading}${quote.text}`}
            className="font-reading text-lead leading-[1.6] text-text"
          >
            {quote.text}
            <span className="font-mono text-meta text-text-faint ml-2">
              §{displayHeading(quote.from.heading)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
