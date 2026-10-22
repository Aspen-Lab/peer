// "Peer 0.14.0 · What's new" — the version's only home, at the foot of the
// help sheet and the You page, linking the changelog that nothing in the app
// used to reach. The sidebar footer showed the string in capitals with no
// link; a version is a way to the notes, not a badge.
//
// P11-17a (§1h.113 (b) O-1): "Peer 0.45.0 · c550daa · What's new" — the commit
// the running build was made from, so a server older than main says so.
// `next.config.ts` fixes `PEER_BUILD_REF` when it is evaluated (`next build`,
// `next dev` start; `lib/build-ref.ts`) and Next inlines it here. With no
// commit the line is exactly what it was.

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
  // Read in the render, as one whole `process.env.NAME` (Next replaces that
  // expression at build; it cannot replace a destructured one). Anything but
  // seven hex characters is not shown.
  const buildRef = process.env.PEER_BUILD_REF ?? "";
  const commit = /^[0-9a-f]{7}$/.test(buildRef) ? buildRef : null;
  // 12.5px, not the 11.5px caption: the version's only home is not allowed
  // under the floor the shell keeps for everything but the phone bar.
  return (
    <p className={`text-meta text-text-faint ${className}`}>
      Peer {APP_VERSION}
      {commit && (
        <>
          <span className="mx-1.5" aria-hidden>
            ·
          </span>
          <span title={`Built from commit ${commit}`}>{commit}</span>
        </>
      )}
      <span className="mx-1.5" aria-hidden>
        ·
      </span>
      <Link
        href="/changelog"
        onNavigate={onNavigate}
        className="hover:text-heading transition-colors "
      >
        What&apos;s new
      </Link>
    </p>
  );
}
