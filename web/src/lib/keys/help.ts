// The help sheet's groups — the briefing's keys written here, the reading
// page's from its own table, so the sheet lists nothing a page does not
// answer to. Sentence-case headings: the sheet is part of the shell, and the
// shell has no capitals.

import { readerHelpItems } from "@/lib/reader/reader-keys";

export interface HelpItem {
  /** Space-separated keycaps; "g h" is a chord. */
  keys: string;
  label: string;
}

export interface HelpGroup {
  title: string;
  items: HelpItem[];
}

export function helpGroups(): HelpGroup[] {
  return [
    {
      title: "Anywhere",
      items: [
        { keys: "/", label: "Search" },
        { keys: "?", label: "Help" },
        { keys: "Esc", label: "Close help / blur search" },
      ],
    },
    {
      title: "Navigate",
      items: [
        { keys: "g h", label: "Briefing" },
        { keys: "g s", label: "Saved" },
        { keys: "g p", label: "Profile" },
      ],
    },
    {
      title: "Briefing",
      items: [
        { keys: "j", label: "Next paper" },
        { keys: "k", label: "Previous paper" },
        { keys: "Enter", label: "Open the focused paper" },
        { keys: "s", label: "Save / unsave" },
        { keys: "x", label: "Not interested" },
        { keys: "l", label: "Like — more like this" },
        { keys: "r", label: "Refresh briefing" },
        { keys: "u", label: "Undo last dismiss (within 4s)" },
      ],
    },
    { title: "Reading", items: readerHelpItems() },
  ];
}
