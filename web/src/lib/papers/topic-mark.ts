// What kind of paper this is, in one mark.
//
// Ten cards in a briefing are ten grey rectangles that differ only in their
// words, and the words are all in the same face at the same size. The eye has
// nothing to sort them by until it reads them — which is the opposite of what
// a board is for.
//
// So each card carries a small mark for its subject. The subject is read off
// the paper's own words, in this order:
//
//   the domain  what the paper is ABOUT — agriculture, physics, medicine,
//               markets, security. The most informative thing about a paper,
//               and the thing two cards are least likely to share.
//   the form    how it looks at the domain — images, language, graphs,
//               geometry.
//   the genre   a textbook, a survey, a toolkit. Not what it is about, but a
//               real difference: "A First Course in Machine Learning" and
//               "Nuclear Transport With Machine Learning" are not the same
//               kind of reading.
//   the method  data, or a model. The fallback, because in a briefing on
//               machine learning every paper matches these.
//
// The mark is a reading, not a fact — it is derived from a title, and a title
// can mislead. It is drawn faint and it is never the only thing on the card
// that says what a paper is. Nothing is filed by it and nothing is hidden by
// it.

export type TopicKey =
  | "earth"
  | "life"
  | "matter"
  | "market"
  | "shield"
  | "vision"
  | "language"
  | "geometry"
  | "network"
  | "robot"
  | "chip"
  | "primer"
  | "tool"
  | "data"
  | "model"
  | "paper";

export interface TopicMark {
  key: TopicKey;
  /** Shown on hover. Names the family, never the paper. */
  label: string;
}

/**
 * Order is the whole design: the first family that matches wins, so the list
 * runs from what a paper is about, through how it looks at it, to what it did
 * — and "machine learning", which is on every card in a machine-learning
 * briefing, is last.
 */
const FAMILIES: { key: TopicKey; label: string; words: string[] }[] = [
  {
    key: "earth",
    label: "Earth, climate and agriculture",
    // Before `life`: a plant disease is an agriculture paper, and the word
    // "disease" would otherwise file it under medicine.
    words: [
      "agricultur", "agronom", "crop", "plant", "soil", "harvest", "irrigat", "farm",
      "climate", "weather", "rainfall", "environment", "ecolog", "biodiversity", "forest",
      "water", "ocean", "river", "energy", "solar", "wind power", "renewable",
      "geolog", "seismic", "remote sensing", "satellite", "sustainab", "emission", "carbon",
    ],
  },
  {
    key: "life",
    label: "Life and health",
    words: [
      "biolog", "protein", "genom", "genetic", "gene expression", "rna", "dna", "cell",
      "clinical", "medic", "patient", "diagnos", "health", "disease", "cancer", "tumour",
      "tumor", "drug", "pharma", "therap", "vaccine", "epidemi", "brain", "neuro",
      "molecul", "enzyme", "microb", "species", "ecosystem",
    ],
  },
  {
    key: "matter",
    label: "Physical sciences",
    words: [
      "physic", "quantum", "nuclear", "reactor", "neutron", "particle", "photon",
      "material", "semiconductor", "crystal", "alloy", "polymer", "chemistr", "catalys",
      "astro", "cosmol", "galax", "thermodynam", "fluid", "turbulen", "mechanic",
      "spectroscop", "plasma",
    ],
  },
  {
    key: "market",
    label: "Economy and society",
    words: [
      "market", "consumer", "econom", "financ", "bank", "invest", "price", "pricing",
      "trade", "trading", "business", "supply chain", "customer", "retail", "advertis",
      "behaviour", "behavior", "policy", "social media", "labour", "labor",
    ],
  },
  {
    key: "shield",
    label: "Security and privacy",
    words: [
      "security", "secure", "privacy", "private", "attack", "adversarial", "threat",
      "encrypt", "cryptograph", "malware", "intrusion", "fraud", "authenticat",
      "vulnerabilit", "federated", "differential privacy", "watermark",
    ],
  },
  // Before the form families: "An FPGA accelerator for sparse transformers"
  // is a hardware paper that mentions language models, and "vision-based
  // grasping" is a robotics paper that uses a camera.
  {
    key: "robot",
    label: "Robotics and control",
    words: [
      "robot", "robotic", "manipulat", "autonomous", "drone", "uav", "self-driving",
      "control system", "motion planning", "locomotion", "actuator", "grasp", "slam",
    ],
  },
  {
    key: "chip",
    label: "Hardware and systems",
    words: [
      "hardware", "fpga", "gpu", "accelerator", "circuit", "processor", "microcontroller",
      "embedded", "edge device", "on-device", "memory bandwidth", "silicon", "asic", "compiler",
    ],
  },
  {
    key: "vision",
    label: "Images and vision",
    words: [
      "image", "imaging", "vision", "visual", "segmentation", "detection", "recognition",
      "video", "camera", "photograph", "pixel", "scene", "object detection", "face",
    ],
  },
  {
    key: "language",
    label: "Language and text",
    words: [
      "language", "linguistic", "text", "nlp", "translat", "speech", "transformer",
      "attention", "large language", "llm", "dialogue", "conversation", "sentiment",
      "summariz", "summaris", "corpus", "token",
    ],
  },
  {
    key: "geometry",
    label: "Geometry and topology",
    words: [
      "topolog", "geometr", "manifold", "riemann", "curvature", "simplicial",
      "persistent homology", "shape", "metric space",
    ],
  },
  {
    key: "network",
    label: "Networks and graphs",
    words: [
      "graph", "network science", "social network", "node", "edge list",
      "internet of things", "iot", "distributed system", "peer-to-peer", "routing",
      "knowledge graph",
    ],
  },
  {
    key: "primer",
    label: "Course, survey or textbook",
    words: [
      "a first course", "first course", "introduction to", "introductory", "textbook",
      "tutorial", "lecture", "handbook", "principles", "fundamental", "survey",
      "a review", "review of", "overview", "primer", "basics", "beginner",
      "getting started", "guide to", "encyclopedia",
    ],
  },
  {
    key: "tool",
    label: "Tools and software",
    words: [
      "tool", "toolkit", "software", "framework", "library", "platform", "package",
      "pipeline", "benchmark", "dataset", "implementation", "api", "open-source",
      "open source",
    ],
  },
  {
    key: "data",
    label: "Data and statistics",
    words: [
      "statistic", "classification", "classifier", "regression", "cluster",
      "forecast", "time series", "analytic", "data mining", "big data", "sampling",
      "bayesian", "probabilistic", "uncertainty", "causal",
    ],
  },
  {
    key: "model",
    label: "Models and learning",
    words: [
      "machine learning", "deep learning", "neural", "model", "training", "algorithm",
      "optimis", "optimiz", "inference", "reinforcement", "artificial intelligence",
      "prediction", "predictive", "supervised", "unsupervised", "generative",
    ],
  },
];

const DEFAULT: TopicMark = { key: "paper", label: "Paper" };

/** The words a paper offers, cheapest first: its title, then whatever the
 *  record filed it under. The abstract is deliberately left out — at three
 *  hundred words it matches everything. */
export interface TopicInput {
  title: string;
  venue?: string;
  summaryExperimentKeywords?: string[];
  /** The terms already chosen for this card's plate, where it has them. */
  terms?: string[];
}

export function topicMarkOf(paper: TopicInput): TopicMark {
  const haystack = [
    paper.title,
    ...(paper.terms ?? []),
    ...(paper.summaryExperimentKeywords ?? []),
    paper.venue ?? "",
  ]
    .join(" · ")
    .toLocaleLowerCase();
  if (!haystack.trim()) return DEFAULT;
  for (const family of FAMILIES) {
    if (family.words.some((w) => haystack.includes(w))) {
      return { key: family.key, label: family.label };
    }
  }
  return DEFAULT;
}
