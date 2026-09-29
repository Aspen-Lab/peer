export const ALLOWED_VOCABULARY_SOURCE_IDS = ["openalex", "thesoz", "stw"] as const;

export type VocabularySourceId = (typeof ALLOWED_VOCABULARY_SOURCE_IDS)[number];

export interface VocabularySourcePolicy {
  id: VocabularySourceId;
  licenseName: "CC0-1.0" | "CC-BY-4.0";
  licenseUrl: string;
}

// This catalog names the only sources a future, separately reviewed import may
// use. It is not evidence that a package, release, or asset has been approved.
export const VOCABULARY_SOURCE_CATALOG: readonly VocabularySourcePolicy[] = [
  {
    id: "openalex",
    licenseName: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  {
    id: "thesoz",
    licenseName: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  },
  {
    id: "stw",
    licenseName: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  },
];

export function vocabularySourcePolicy(sourceId: unknown): VocabularySourcePolicy | undefined {
  return VOCABULARY_SOURCE_CATALOG.find((policy) => policy.id === sourceId);
}

// P1-03 F-A-03A (Round 3): a closed, compile-time-total map from machine
// source ID to a human-readable display name. The source allowlist above is
// a genuinely finite, maintainer-owned set, and a display name belongs to the
// source organization, not to any one imported release, so it is not a
// manifest field. `satisfies Record<VocabularySourceId, string>` makes
// TypeScript itself reject any future source ID added to the allowlist
// without a matching display name here.
export const VOCABULARY_SOURCE_DISPLAY_NAMES = {
  openalex: "OpenAlex",
  thesoz: "TheSoz — Thesaurus for the Social Sciences",
  stw: "STW Thesaurus for Economics",
} satisfies Record<VocabularySourceId, string>;
