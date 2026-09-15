// The briefing's fixed words.

export const DAY_STRIP = {
  /** One line saying how to read the strip. A chart that needs a paragraph
   *  is the wrong chart; one that needs no line at all is usually a chart
   *  nobody can read. */
  caption: "Each bar is a paper below, as tall as it matches your topics",
  /** Only when some of the day has been read — with none read there is
   *  nothing for a key to distinguish. */
  readKey: "· grey is read",
};

export const SEARCH_BOX = {
  /** What the search page searches; the box promises no less and no more. */
  placeholder: "Search all papers…",
  label: "Search papers",
};

export const UPLOAD_BUTTON = {
  label: "Upload a paper PDF",
  /** Server and client rejection reasons are already plain sentences; this
   *  just names the seam so every caller reads the same way. */
  error: (reason: string) => reason,
};
