// The reader's library as a graph: the papers they have read or kept, and the
// terms those papers are about, joined wherever a term is shared.
//
// Every edge is a fact from the paper's own record, of one of three kinds:
//
//   filed    OpenAlex filed the work under this topic. Its topics come from a
//            curated taxonomy of about 4,500 and are assigned to the whole
//            work, so they carry none of the mis-disambiguation the older
//            concept tagger does ("Identity (music)" on a crowdsourcing
//            paper). They are what joins the papers that ship no abstract.
//   text     The term is in the paper's own title or abstract — the plate's
//            rules, which is what keeps the older tagger's noise out.
//   contains A term's words contain one of the reader's own topics:
//            "Machine Learning and Data Classification" sits under "machine
//            learning". A fact about two strings, drawn as the hierarchy it is.
//
// Nothing is inferred: no similarity score, no embedding distance, no
// "related" guess. Two papers are near each other on the page only because
// their records say the same thing.
//
// Three kinds of node, told apart by SHAPE, never by hue (the accent is spent
// on whatever the reader is pointing at):
//
//   paper    a square — filled once read, outlined while it is one of today's
//            and still unread (the reading calendar's empty-slot vocabulary)
//   topic    one of the reader's own declared topics — a filled chip
//   concept  a term two or more papers share — an outlined chip
//
// Today's unread papers are in the graph on purpose: the library is most
// useful the morning a new paper turns out to sit next to three you have
// already read.

import type { Paper } from "@/types";
import { cleanTerms, termKey } from "@/lib/papers/plate-terms";

/** What Peer keeps about a paper once it has been read — enough to draw it
 *  and link it, long after it has left the day's briefing. */
export interface LibraryEntry {
  id: string;
  title: string;
  venue: string;
  /** ISO day it was first read. */
  readAt: string;
  /** OpenAlex's topics for the work, up to three. */
  filed: string[];
  /** Its terms that appear in its own words, cleaned at read time. Both lists
   *  are classified as the reader's topic or a concept when the graph is
   *  built, so a topic declared next month still finds them. */
  terms: string[];
}

/** Terms in the paper's own words, per paper. With up to three filed topics
 *  that is six at most — more and every paper links to everything. */
export const TERMS_PER_PAPER = 3;
const FILED_PER_PAPER = 3;
/** A term carried by one paper links nothing; it is a property, not a node. */
const MIN_PAPERS_PER_CONCEPT = 2;
/** Enough to show a year of real reading without the layout turning to fur. */
export const MAX_LIBRARY_NODES = 120;

/** OpenAlex's own topic filing for the work, as the record carries it. */
export function filedUnder(paper: Pick<Paper, "preferenceSignals">): string[] {
  return (paper.preferenceSignals ?? [])
    .filter((signal) => signal.source === "openalex_topic")
    .map((signal) => signal.label.trim())
    .filter(Boolean)
    .slice(0, FILED_PER_PAPER);
}

export function libraryEntryOf(paper: Paper, readAt: string): LibraryEntry {
  return {
    id: paper.id,
    title: paper.title,
    venue: paper.venue,
    readAt,
    filed: filedUnder(paper),
    terms: cleanTerms(paper, TERMS_PER_PAPER),
  };
}

export type TermSource = "filed" | "text";

export type PaperState = "read" | "saved" | "today";

export type GraphNode =
  | {
      id: string;
      kind: "paper";
      paperId: string;
      label: string;
      state: PaperState;
      readAt?: string;
      venue: string;
      degree: number;
    }
  | {
      id: string;
      kind: "topic" | "concept";
      label: string;
      /** How many papers in the graph carry it. */
      papers: number;
      /** Where the term came from — shown in the readout, never guessed. */
      sources: TermSource[];
      degree: number;
    };

export interface GraphLink {
  source: string;
  target: string;
  kind: "carries" | "contains";
}

export interface LibraryGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  counts: {
    read: number;
    saved: number;
    today: number;
    topics: number;
    concepts: number;
    links: number;
    /** Library papers left out by the node cap, oldest first. */
    omitted: number;
  };
}

interface PaperIn {
  paperId: string;
  label: string;
  venue: string;
  state: PaperState;
  readAt?: string;
  terms: { label: string; source: TermSource }[];
}

function termsOf(filed: string[], text: string[]): { label: string; source: TermSource }[] {
  return [
    ...filed.map((label) => ({ label, source: "filed" as const })),
    ...text.map((label) => ({ label, source: "text" as const })),
  ];
}

export function buildLibraryGraph(input: {
  /** Everything read, newest last or in any order. */
  library: LibraryEntry[];
  saved: Paper[];
  /** Today's briefing. Read ones are already in `library`. */
  today: Paper[];
  readIds: Record<string, true>;
  readerTopics: string[];
}): LibraryGraph {
  const savedIds = new Set(input.saved.map((p) => p.id));

  // The library, newest first, capped.
  const byRecency = [...input.library].sort((a, b) => b.readAt.localeCompare(a.readAt));
  const recent = byRecency.slice(0, MAX_LIBRARY_NODES);
  const omitted = byRecency.length - recent.length;

  // Where the full record is still at hand (today's briefing, the shelf), its
  // terms are read fresh; the entry supplies the day it was read. An entry
  // written before `filed` existed would otherwise stay unlinked for good.
  const full = new Map<string, Paper>([...input.saved, ...input.today].map((p) => [p.id, p]));

  const papers = new Map<string, PaperIn>();
  for (const entry of recent) {
    const record = full.get(entry.id);
    papers.set(entry.id, {
      paperId: entry.id,
      label: entry.title,
      venue: entry.venue,
      state: savedIds.has(entry.id) ? "saved" : "read",
      readAt: entry.readAt,
      terms: record
        ? termsOf(filedUnder(record), cleanTerms(record, TERMS_PER_PAPER))
        : termsOf(entry.filed ?? [], entry.terms),
    });
  }
  for (const paper of input.saved) {
    if (papers.has(paper.id)) continue;
    papers.set(paper.id, {
      paperId: paper.id,
      label: paper.title,
      venue: paper.venue,
      state: "saved",
      terms: termsOf(filedUnder(paper), cleanTerms(paper, TERMS_PER_PAPER)),
    });
  }
  for (const paper of input.today) {
    if (papers.has(paper.id)) continue;
    // A paper read today whose entry has not been written yet still counts as
    // read — the flag is the truth, the entry is the record.
    papers.set(paper.id, {
      paperId: paper.id,
      label: paper.title,
      venue: paper.venue,
      state: input.readIds[paper.id] ? "read" : "today",
      terms: termsOf(filedUnder(paper), cleanTerms(paper, TERMS_PER_PAPER)),
    });
  }

  // Classify each term once. It IS the reader's topic when it names it or a
  // narrower phrase of it ("protein structure" for "protein structure
  // prediction"). A longer label that merely CONTAINS the topic — "Machine
  // Learning and Data Classification" — is its own node, so two different
  // corners of a field do not collapse into one hub; a `contains` edge puts it
  // under the topic instead.
  const topics = input.readerTopics
    .map((t) => t.trim())
    .filter(Boolean)
    .map((label) => ({ label, key: termKey(label) }));
  const topicNamed = (key: string) => topics.find((t) => t.key === key || t.key.includes(key));
  const topicsInside = (key: string) => topics.filter((t) => key !== t.key && key.includes(t.key));

  type TermIn = {
    kind: "topic" | "concept";
    label: string;
    carriers: Set<string>;
    sources: Set<TermSource>;
    parents: string[];
  };
  const termNodes = new Map<string, TermIn>();
  for (const paper of papers.values()) {
    const seen = new Set<string>();
    for (const term of paper.terms) {
      const key = termKey(term.label);
      if (!key) continue;
      const topic = topicNamed(key);
      const nodeKey = topic ? `topic:${topic.key}` : `concept:${key}`;
      if (seen.has(nodeKey)) {
        termNodes.get(nodeKey)?.sources.add(term.source);
        continue;
      }
      seen.add(nodeKey);
      const node: TermIn = termNodes.get(nodeKey) ?? {
        kind: topic ? "topic" : "concept",
        label: topic ? topic.label : term.label,
        carriers: new Set<string>(),
        sources: new Set<TermSource>(),
        parents: topic ? [] : topicsInside(key).map((t) => `topic:${t.key}`),
      };
      node.carriers.add(paper.paperId);
      node.sources.add(term.source);
      termNodes.set(nodeKey, node);
    }
  }

  // A reader topic a concept sits under is on the page even if no paper names
  // it directly — the concept's words are the evidence.
  for (const term of termNodes.values()) {
    for (const parent of term.parents) {
      if (termNodes.has(parent)) continue;
      const t = topics.find((x) => `topic:${x.key}` === parent)!;
      termNodes.set(parent, {
        kind: "topic",
        label: t.label,
        carriers: new Set(),
        sources: new Set(),
        parents: [],
      });
    }
  }

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const degree = new Map<string, number>();
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);

  const kept = new Set<string>();
  for (const [nodeKey, term] of termNodes) {
    // A concept earns a node by joining two papers, or by sitting under one of
    // the reader's topics (then its one paper still reaches the topic).
    if (
      term.kind === "concept" &&
      term.carriers.size < MIN_PAPERS_PER_CONCEPT &&
      term.parents.length === 0
    ) {
      continue;
    }
    kept.add(nodeKey);
  }
  for (const nodeKey of kept) {
    const term = termNodes.get(nodeKey)!;
    const id = `t:${nodeKey}`;
    for (const paperId of term.carriers) {
      links.push({ source: `p:${paperId}`, target: id, kind: "carries" });
      bump(id);
      bump(`p:${paperId}`);
    }
    for (const parent of term.parents) {
      if (!kept.has(parent)) continue;
      links.push({ source: id, target: `t:${parent}`, kind: "contains" });
      bump(id);
      bump(`t:${parent}`);
    }
    nodes.push({
      id,
      kind: term.kind,
      label: term.label,
      papers: term.carriers.size,
      sources: [...term.sources],
      degree: 0,
    });
  }

  for (const paper of papers.values()) {
    const id = `p:${paper.paperId}`;
    // Today's unread papers earn their place by connecting to something; a
    // read or kept paper is part of the library whether it links or not.
    if (paper.state === "today" && !degree.has(id)) continue;
    nodes.push({
      id,
      kind: "paper",
      paperId: paper.paperId,
      label: paper.label,
      state: paper.state,
      readAt: paper.readAt,
      venue: paper.venue,
      degree: 0,
    });
  }

  for (const node of nodes) node.degree = degree.get(node.id) ?? 0;

  const paperNodes = nodes.filter((n) => n.kind === "paper");
  return {
    nodes,
    links,
    counts: {
      read: paperNodes.filter((n) => n.kind === "paper" && n.state === "read").length,
      saved: paperNodes.filter((n) => n.kind === "paper" && n.state === "saved").length,
      today: paperNodes.filter((n) => n.kind === "paper" && n.state === "today").length,
      topics: nodes.filter((n) => n.kind === "topic").length,
      concepts: nodes.filter((n) => n.kind === "concept").length,
      links: links.length,
      omitted,
    },
  };
}
