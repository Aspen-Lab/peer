// "Peer 0.14.0 · What's new" — the version's only home, at the foot of the
// help sheet and the You page, linking the changelog that nothing in the app
// used to reach. The sidebar footer showed the string in capitals with no
// link; a version is a way to the notes, not a badge.

import Link from "next/link";
import { APP_VERSION } from "@/lib/version";

export function VersionLine({
  className = "",
  onNavigate,
}: {
  className?: string;
  /**
   * Fired as the client navigation starts — the help sheet passes its
   * close, so the changelog is not opened behind the sheet's own scrim.
   * (Cmd-click opens a tab and never navigates here, so nothing closes.)
   */
  onNavigate?: () => void;
}) {
  // 12.5px, not the 11.5px caption: the version's only home is not allowed
  // under the floor the shell keeps for everything but the phone bar.
  return (
    <p className={`text-meta text-text-faint ${className}`}>
      Peer {APP_VERSION}
      <span className="mx-1.5" aria-hidden>
        ·
      </span>
      <Link
        href="/changelog"
        onNavigate={onNavigate}
        className="hover:text-heading transition-colors duration-150 ease-snap"
      >
        What&apos;s new
      </Link>
    </p>
  );
}
