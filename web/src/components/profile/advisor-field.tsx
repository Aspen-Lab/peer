"use client";

// Advisor / PI field shared by the onboarding wizard and the profile editor.
// Flow (postal-address-style, single best match, confirm once):
//   type a name → "Find advisor" → "Did you mean <X>?" → confirm → locked.
// Once locked, the resolved OpenAlex author identity anchors feed discovery.

import { useState } from "react";
import { apiFetch } from "@/lib/api";

interface ResolvedAuthor {
  authorId: string;
  displayName: string;
  institution: string | null;
  worksCount: number;
  label: string;
}

type Status = "idle" | "searching" | "found" | "notfound";

export function AdvisorField({
  advisorName,
  school,
  advisorAuthorId,
  advisorAuthorLabel,
  onChangeName,
  onConfirm,
  onClear,
}: {
  advisorName: string;
  school: string;
  advisorAuthorId?: string;
  advisorAuthorLabel?: string;
  onChangeName: (name: string) => void;
  onConfirm: (authorId: string, label: string) => void;
  onClear: () => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [candidate, setCandidate] = useState<ResolvedAuthor | null>(null);

  const confirmed = Boolean(advisorAuthorId);

  const find = async () => {
    const name = advisorName.trim();
    if (name.length < 2) return;
    setStatus("searching");
    setCandidate(null);
    try {
      const params = new URLSearchParams({ name });
      if (school.trim()) params.set("institution", school.trim());
      const data = await apiFetch<{ author: ResolvedAuthor | null }>(
        `/api/affiliation/resolve?${params}`,
        { cache: "no-store" },
      );
      if (data.author) {
        setCandidate(data.author);
        setStatus("found");
      } else {
        setStatus("notfound");
      }
    } catch {
      setStatus("notfound");
    }
  };

  // ── Locked / confirmed state ──────────────────────────────────
  if (confirmed) {
    return (
      <div className="rounded-xl bg-accent-dim/60 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent)] px-3.5 py-3 flex items-start gap-3">
        <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent text-bg shrink-0">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-accent/90">
            Advisor confirmed
          </p>
          <p className="text-body-sm text-heading font-medium mt-0.5 leading-snug">
            {advisorAuthorLabel ?? advisorName}
          </p>
          <p className="text-caption text-text-muted mt-1 leading-relaxed">
            Peer seeds discovery from their recent work, refreshed monthly.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            onClear();
            setStatus("idle");
            setCandidate(null);
          }}
          className="text-caption text-text-faint hover:text-accent transition-colors shrink-0"
        >
          Change
        </button>
      </div>
    );
  }

  // ── Entry / search state ──────────────────────────────────────
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={advisorName}
          onChange={(e) => {
            onChangeName(e.target.value);
            if (status !== "idle") {
              setStatus("idle");
              setCandidate(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void find();
            }
          }}
          placeholder="First Last"
          className="flex-1 min-w-0 bg-bg-secondary/40 rounded-lg px-3 py-2.5 text-body text-text placeholder-text-faint/60 outline-none focus:bg-bg-secondary/60 focus:ring-2 focus:ring-accent/20 transition-all"
        />
        <button
          type="button"
          onClick={() => void find()}
          disabled={advisorName.trim().length < 2 || status === "searching"}
          className={`shrink-0 h-[42px] px-3.5 rounded-lg text-meta font-medium transition-colors active:scale-[0.97] ${
            advisorName.trim().length >= 2 && status !== "searching"
              ? "bg-heading text-bg hover:bg-heading/90"
              : "bg-bg-secondary text-text-faint/70 cursor-not-allowed"
          }`}
        >
          {status === "searching" ? "Finding…" : "Find advisor"}
        </button>
      </div>

      {status === "found" && candidate && (
        <div className="rounded-xl bg-surface shadow-card px-3.5 py-3 animate-fade-in-up">
          <p className="text-meta text-text-muted leading-relaxed">
            Did you mean{" "}
            <span className="text-heading font-medium">{candidate.label}</span>
            <span className="text-text-faint">
              {" "}
              · {candidate.worksCount.toLocaleString()} papers
            </span>
            ?
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onConfirm(candidate.authorId, candidate.label);
                setStatus("idle");
                setCandidate(null);
              }}
              className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-accent text-white text-meta font-medium hover:bg-accent/90 transition-colors active:scale-[0.97]"
            >
              Yes, that&rsquo;s my advisor
            </button>
            <button
              type="button"
              onClick={() => {
                setStatus("idle");
                setCandidate(null);
              }}
              className="text-meta text-text-faint hover:text-text-muted transition-colors"
            >
              No, edit name
            </button>
          </div>
        </div>
      )}

      {status === "notfound" && (
        <p className="text-caption text-text-faint/85 leading-relaxed px-0.5">
          Couldn&rsquo;t find that author on OpenAlex. Check the spelling and your School/Org,
          or leave it — Peer will just skip advisor-based discovery.
        </p>
      )}

      {status === "idle" && (
        <p className="text-caption text-text-faint/75 leading-relaxed px-0.5">
          Your advisor / PI. Peer finds their work and uses it as a compass to surface
          related papers you&rsquo;d care about. Add your School/Org above for an accurate match.
        </p>
      )}
    </div>
  );
}
