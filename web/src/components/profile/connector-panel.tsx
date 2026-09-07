"use client";

// The "Data APIs" control body. This used to switch between three
// bring-your-own-key sources — Tavily, Adzuna, USAJobs — of which the last two
// existed only to widen JOB coverage. Jobs are no longer a product surface, so
// only Tavily remains: it feeds paper discovery. The key lives in local
// browser state (see UserProfile) — never synced to the shared profile row.

import { useProfileStore } from "@/store/profile";
import { SecretInput } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";

// Small external-link glyph shown inside the "Get a key" button.
function ExternalLinkIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

/**
 * How many optional data connectors are configured. Signature kept permissive
 * so existing callers that pass a whole profile keep compiling; only Tavily
 * counts now.
 */
export function connectedCount(p: {
  tavilyEnabled?: boolean;
  tavilyApiKey?: string;
  [key: string]: unknown;
}): number {
  return p.tavilyEnabled && p.tavilyApiKey?.trim() ? 1 : 0;
}

export function ConnectorPanel() {
  const profile = useProfileStore((s) => s.profile);
  const updateTavilyEnabled = useProfileStore((s) => s.updateTavilyEnabled);
  const updateTavilyApiKey = useProfileStore((s) => s.updateTavilyApiKey);
  const on = Boolean(profile.tavilyEnabled && profile.tavilyApiKey?.trim());

  return (
    <div
      className="px-3.5 pb-3.5 space-y-3 border-t border-border/50 pt-3"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${on ? "bg-accent" : "bg-text-faint/40"}`}
          aria-hidden
        />
        <span className="text-[12px] font-medium text-heading">Tavily</span>
      </div>

      <p className="text-[11.5px] leading-relaxed text-text-muted">
        Web discovery that widens the paper search beyond the academic APIs.
        Optional — Peer works without it.
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-text-faint">Enable Tavily web scouting</span>
          <button
            type="button"
            role="switch"
            aria-checked={profile.tavilyEnabled}
            onClick={() => updateTavilyEnabled(!profile.tavilyEnabled)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ease-out ${
              profile.tavilyEnabled ? "bg-accent" : "bg-bg-secondary"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-bg shadow transition-transform duration-200 ease-out ${
                profile.tavilyEnabled ? "translate-x-4" : ""
              }`}
            />
          </button>
        </div>
        <SecretInput
          value={profile.tavilyApiKey ?? ""}
          onChange={updateTavilyApiKey}
          placeholder="Tavily API key (tvly-…)"
        />
      </div>

      <div className="space-y-2 pt-0.5">
        <p className="text-[10.5px] leading-relaxed text-text-faint">
          Sign up free (1,000 searches/mo), copy the key from your dashboard.
        </p>
        <a
          href="https://tavily.com"
          target="_blank"
          rel="noopener noreferrer"
          className={`${buttonVariants({ tone: "accentSoft", size: "sm" })} w-full`}
        >
          Get a Tavily key
          <ExternalLinkIcon />
        </a>
      </div>
    </div>
  );
}
