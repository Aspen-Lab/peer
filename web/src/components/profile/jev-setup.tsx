"use client";

// Paper screening with the reader's own Jev key: the field, the link to get a
// key, a one-line status, and the copy that says what the key turns on.
//
// Jev is a bring-your-own-key option, like a model key. The reader applies for a
// Jev key, pastes it here, and the paper screening runs a second pass on it; with
// no key the feed screens without Jev. The key lives in this browser only (see
// `UserProfile.jevApiKey`): never synced, never written into a backup file, sent
// only inside the paper request body.
//
// What this copy must never do: state a number for the improvement, use an
// adjective of size, or give a price. The repository has no measurement of Jev's
// effect, so the sentence about the improvement comes from the one place that owns
// the claim (`lib/decisions/jev-claim.ts`) and says it is not measured. The money
// sentence is the whole money statement: Jev bills the reader's own account.
//
// Used by the Profile page ("Paper screening" row) and the welcome wizard's `ai`
// step (a short block, no new wizard step).

import { useProfileStore } from "@/store/profile";
import { useJevScreeningStore, type JevScreeningReport } from "@/store/jev-screening";
import { SecretInput } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";
import { jevGainSentence } from "@/lib/decisions/jev-claim";
import { parseJevApiKey } from "@/lib/decisions/jev-key";

/**
 * Where a reader gets a Jev key. TODO(owner): this is the vendor's documentation
 * host, because the repository knows no sign-up page (the sandbox that wrote this
 * could not reach one). Replace it with the page where a reader applies for a key
 * when you have it. It is the only place the address is written.
 */
export const JEV_SIGNUP_URL = "https://docs.typesafe.ai/";

const WITHOUT_KEY =
  "Without a key, Peer screens each day's papers with fixed scoring: your topics, your project text, how new a paper is and where it was published. That works with no setup.";

const WHAT_A_KEY_ADDS =
  "A Jev key adds a second pass. For each of the 50 best candidates Jev answers up to four fixed questions about the paper: is it the meaning of your word, is it core to your project or only background, does it match your method, would it help your project. Peer moves papers up or down on the answers. A paper Jev cannot judge counts as neutral: Jev neither lifts nor lowers it, though papers Jev rates well can move ahead of it. Jev reads English best.";

const MONEY = "Jev bills your own account for what it reads.";

const OPTIONAL_AND_PRIVACY =
  "Optional. Applies to your next briefing. Peer keeps the key in this browser, never in your account; its server passes the key to Jev while it screens your papers and does not store or log it.";

// Small external-link glyph shown inside the "Get a Jev key" button.
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
 * One line about what Jev did the last time a briefing was built, or null when
 * there is nothing to report. Plain words, counts only: it states no size and no
 * price, and it never names the key.
 */
export function jevScreeningLine(report: JevScreeningReport | null | undefined): string | null {
  if (!report) return null;
  switch (report.status) {
    case "applied":
    case "partial":
      return `Last briefing: ${report.screened} of ${report.of} papers screened by Jev.`;
    case "unavailable":
      return report.screened > 0
        ? `Jev answered only ${report.screened} of ${report.of} papers, too few to use; this briefing was screened without it.`
        : "Jev did not answer; this briefing was screened without it.";
    case "rejected":
      return "Jev rejected the key.";
  }
}

/** The report line, or nothing at all. */
export function JevScreeningStatus({ report }: { report: JevScreeningReport | null | undefined }) {
  const line = jevScreeningLine(report);
  if (line === null) return null;
  return <p className="text-micro leading-relaxed text-text-faint">{line}</p>;
}

/**
 * The key input, its status line and the link to get a key. Controlled, so a
 * test can render it with any value. The status never prints the key.
 */
export function JevKeyField({
  value,
  onChange,
  idPrefix = "jev",
}: {
  value: string;
  onChange: (value: string) => void;
  idPrefix?: string;
}) {
  const typed = value.trim().length > 0;
  const usable = parseJevApiKey(value) !== undefined;
  const status = !typed
    ? "No Jev key: papers are screened without Jev."
    : usable
      ? "Jev key saved on this device."
      : "That does not look like a key. It must be one string with no spaces or line breaks.";

  return (
    <div className="space-y-2">
      <label htmlFor={`${idPrefix}-jev-key`} className="block eyebrow text-text-faint">
        Jev API key
      </label>
      <SecretInput
        id={`${idPrefix}-jev-key`}
        value={value}
        onChange={onChange}
        placeholder="Jev API key"
      />
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${typed && usable ? "bg-accent" : "bg-text-faint/40"}`}
          aria-hidden
        />
        <span className="text-micro leading-relaxed text-text-faint">{status}</span>
      </div>
      <a
        href={JEV_SIGNUP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`${buttonVariants({ tone: "accentSoft", size: "sm" })} w-full`}
      >
        Get a Jev key
        <ExternalLinkIcon />
      </a>
    </div>
  );
}

/**
 * The whole Jev setup, reading and writing the reader's own key in the profile
 * store. `profile` is the Profile page's full explanation; `welcome` is the
 * short block under the model-key fields in the wizard.
 */
export function JevSetup({
  variant = "profile",
  idPrefix = "jev",
}: {
  variant?: "profile" | "welcome";
  idPrefix?: string;
}) {
  const jevApiKey = useProfileStore((s) => s.profile.jevApiKey ?? "");
  const updateJevApiKey = useProfileStore((s) => s.updateJevApiKey);
  const report = useJevScreeningStore((s) => s.report);
  // No key, no hint: what Jev did is shown only while a usable key is saved.
  const usable = parseJevApiKey(jevApiKey) !== undefined;

  if (variant === "welcome") {
    return (
      <div className="space-y-3">
        <p className="eyebrow text-text-faint">A second screening pass (optional)</p>
        <p className="text-caption leading-relaxed text-text-muted">{WITHOUT_KEY}</p>
        <p className="text-caption leading-relaxed text-text-muted">{WHAT_A_KEY_ADDS}</p>
        <p className="text-caption leading-relaxed text-text-muted">{jevGainSentence()}</p>
        <JevKeyField value={jevApiKey} onChange={updateJevApiKey} idPrefix={idPrefix} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-caption leading-relaxed text-text-muted">{WITHOUT_KEY}</p>
      <p className="text-caption leading-relaxed text-text-muted">{WHAT_A_KEY_ADDS}</p>
      <p className="text-caption leading-relaxed text-text-muted">{jevGainSentence()}</p>
      <p className="text-caption leading-relaxed text-text-muted">{MONEY}</p>
      <p className="text-micro leading-relaxed text-text-faint">{OPTIONAL_AND_PRIVACY}</p>
      <JevKeyField value={jevApiKey} onChange={updateJevApiKey} idPrefix={idPrefix} />
      {usable && <JevScreeningStatus report={report} />}
    </div>
  );
}
