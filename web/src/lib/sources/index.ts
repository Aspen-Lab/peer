import { openalex } from "./openalex";
import { arxiv } from "./arxiv";
import { semanticScholar } from "./semantic-scholar";
import { dblp } from "./dblp";
import { pubmed } from "./pubmed";
import { hn } from "./hn";
import type { SourceAdapter, SourceId } from "./types";

export * from "./types";
export { openalex, arxiv, semanticScholar, dblp, pubmed, hn };

/**
 * The source ids that have an adapter. `web` stays a `SourceId` (the database's
 * check constraint lists it, and the rerank and the card mapper still handle
 * an item tagged with it) but has none: Peer runs no web search, so a request
 * that names `web` fetches nothing for it.
 */
export type RegisteredSourceId = Exclude<SourceId, "web">;

export const sources: SourceAdapter[] = [
  openalex,
  arxiv,
  semanticScholar,
  dblp,
  pubmed,
  hn,
];

export const bySourceId: Record<RegisteredSourceId, SourceAdapter> = {
  openalex,
  arxiv,
  semantic_scholar: semanticScholar,
  dblp,
  pubmed,
  hn,
};

/** True when `id` has an adapter in `bySourceId` (every id but `web`). */
export function isRegisteredSource(id: SourceId): id is RegisteredSourceId {
  return Object.prototype.hasOwnProperty.call(bySourceId, id);
}
