"use client";

// Shared profile/onboarding field primitives.
//
// These are the interactive building blocks used by BOTH the profile editor
// (`/profile`) and the first-run onboarding wizard (`/welcome`). Extracted here
// so the two surfaces can't drift apart — in particular the topic ChipInput's
// "type a comma → it becomes a tag" behavior and the drag-between-Required/
// Nice-to-have behavior live in exactly one place.

import {
  useState,
  useRef,
  useEffect,
  type KeyboardEvent,
} from "react";
import { apiFetch } from "@/lib/api";
import { chipTones } from "@/components/ui/chip";

// ── Tone ────────────────────────────────────────────────────────

export type Tone = "accent" | "tag" | "link" | "neutral";

export function toneBadge(tone: Tone = "neutral") {
  switch (tone) {
    case "accent":
      return chipTones.accent;
    case "tag":
      return chipTones.tag;
    case "link":
      return chipTones.link;
    default:
      return "text-text-muted bg-bg-secondary/70";
  }
}

// ── Suggestion / option data ────────────────────────────────────

// Quick-add suggestion chips. Curated, not exhaustive — the goal is to seed
// common research languages so first-run users don't stare at an empty field.
// Intentionally empty: no pre-seeded example topics. A user's briefing
// should be built only from what they type, not from someone else's field.
export const SUGGESTED_TOPICS: string[] = [];

export const PAPER_FOCUS_OPTIONS = [
  { value: "tight", label: "Tight", help: "Stay close to my project." },
  { value: "balanced", label: "Balanced", help: "Mix close matches and useful neighbors." },
  { value: "exploratory", label: "Exploratory", help: "Look wider for ideas I might miss." },
] as const;

export const PAPER_FRESHNESS_OPTIONS = [
  { value: "today", label: "Today", help: "Only very new work." },
  { value: "week", label: "This week", help: "Recent without being too narrow." },
  { value: "month", label: "This month", help: "A wider recent window." },
] as const;

export const PAPER_COUNT_OPTIONS = [
  { value: 5, label: "5", help: "Shortest briefing." },
  { value: 10, label: "10", help: "Default daily forecast." },
] as const;

export const PAPER_SOURCE_OPTIONS = [
  { value: "balanced", label: "Balanced", help: "Use every source evenly." },
  { value: "preprints", label: "Preprints", help: "Favor arXiv and early papers." },
  { value: "published", label: "Published", help: "Favor journal and venue records." },
  { value: "code", label: "Code", help: "Favor work with code or datasets." },
] as const;

// Richer source descriptions for the radio-row presentation in onboarding.
export const PAPER_SOURCE_OPTIONS_DETAILED = [
  {
    value: "balanced",
    label: "Balanced",
    help: "Pull evenly from every source — arXiv, OpenAlex, Semantic Scholar, PubMed and more. A safe default when you don't have a strong preference.",
  },
  {
    value: "preprints",
    label: "Preprints",
    help: "Favor arXiv and other early, not-yet-peer-reviewed work. Best for fast-moving fields where the latest results appear months before journal publication.",
  },
  {
    value: "published",
    label: "Published",
    help: "Favor peer-reviewed work — journal articles and conference proceedings. Best when vetted, citable results matter more than being first.",
  },
  {
    value: "code",
    label: "Code",
    help: "Favor papers that ship code or datasets (e.g. a GitHub link). Best when you want work you can actually run and build on.",
  },
] as const;

export const PAPER_IMPORTANCE_OPTIONS = [
  { value: "new", label: "New", help: "Prefer fresh work." },
  { value: "highlyCited", label: "Highly cited", help: "Prefer proven papers." },
  { value: "rising", label: "Rising fast", help: "Prefer recent papers gaining attention." },
] as const;

export const PAPER_DISCOVERY_OPTIONS = [
  { value: "core", label: "Core field", help: "Stay inside my main area." },
  { value: "adjacent", label: "Adjacent fields", help: "Bring in nearby areas." },
  { value: "surprise", label: "Surprise me", help: "Include a few unusual finds." },
] as const;

export const industryLabels: Record<string, string> = {
  academia: "Academia",
  industry: "Industry",
  both: "Either",
  startups: "Startups",
  bigTech: "Big tech",
};

// ── ChoiceGroup ─────────────────────────────────────────────────

export type ChoiceValue = string | number;
export type ChoiceOption = {
  value: ChoiceValue;
  label: string;
  help?: string;
};

export function ChoiceGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: ChoiceValue;
  options: readonly ChoiceOption[];
  onChange: (value: ChoiceValue) => void;
}) {
  return (
    <div>
      <p className="eyebrow text-text-faint/80 mb-1.5">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => onChange(option.value)}
              title={option.help}
              className={`group text-left text-meta px-2.5 py-1.5 rounded-xl transition-all ease-out active:scale-[0.94] ${
                active
                  ? "bg-accent-dim text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent)] scale-[1.02]"
                  : "text-text-faint hover:text-text-muted bg-bg-secondary/40 hover:bg-bg-secondary/70"
              }`}
            >
              <span className="block font-medium">{option.label}</span>
              {option.help && (
                <span className={`block text-micro leading-snug mt-0.5 ${active ? "text-accent/75" : "text-text-faint/75"}`}>
                  {option.help}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── RadioGroup (horizontal radio rows with circle + description) ─

export function RadioGroup({
  value,
  options,
  onChange,
}: {
  value: ChoiceValue;
  options: readonly ChoiceOption[];
  onChange: (value: ChoiceValue) => void;
}) {
  return (
    <div className="flex flex-col gap-2" role="radiogroup">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`flex items-start gap-3 w-full text-left rounded-xl px-3.5 py-3 transition-all ease-out active:scale-[0.99] ${
              active
                ? "bg-accent-dim shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_40%,transparent)]"
                : "bg-bg-secondary/40 hover:bg-bg-secondary/65 shadow-[inset_0_0_0_1px_rgba(20,20,20,0.05)]"
            }`}
          >
            {/* Selection circle — fills when active */}
            <span
              aria-hidden
              className={`mt-0.5 inline-flex items-center justify-center w-[18px] h-[18px] rounded-full shrink-0 transition-colors ${
                active
                  ? "shadow-[inset_0_0_0_2px_var(--color-accent)]"
                  : "shadow-[inset_0_0_0_2px_var(--color-border-strong)]"
              }`}
            >
              {active && <span className="w-2.5 h-2.5 rounded-full bg-accent" />}
            </span>
            <span className="min-w-0">
              <span className={`block text-body-sm font-medium ${active ? "text-accent" : "text-heading"}`}>
                {option.label}
              </span>
              {option.help && (
                <span className={`block text-meta leading-[1.5] mt-0.5 ${active ? "text-accent/80" : "text-text-muted"}`}>
                  {option.help}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── TogglePill ──────────────────────────────────────────────────

export function TogglePill({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onToggle}
      className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-meta transition-all ease-out active:scale-[0.94] ${
        active
          ? "bg-accent-dim text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent)]"
          : "bg-bg-secondary/40 text-text-faint hover:bg-bg-secondary/70 hover:text-text-muted"
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${active ? "bg-accent" : "bg-text-faint/45"}`}
      />
      {label}
    </button>
  );
}

// ── ChipInput ───────────────────────────────────────────────────

// Module-level drag state — avoids relying on dataTransfer.getData() which
// Firefox can fail to return in drop handlers when custom MIME types are used.
let _chipDrag: { value: string; source: string } | null = null;

type ConceptSuggestion = { name: string; hint?: string; worksCount: number };

// An entry "looks ambiguous" — worth a disambiguation nudge — when it's a
// single short token or an all-caps acronym (e.g. "LCO", "RAG"). Full phrases
// ("ion exchange") and long terms ("transformers") are left alone.
function looksAmbiguous(value: string): boolean {
  const t = value.trim();
  if (!t || t.includes(" ")) return false;
  return t.length <= 6 || t === t.toUpperCase();
}

export function ChipInput({
  values,
  onChange,
  placeholder,
  hint,
  suggestions,
  tone = "tag",
  dragId,
  onChipDrop,
  suggestConcepts = false,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** One-line helper text shown below the input. */
  hint?: string;
  /** Quick-add chips shown only when no values are present yet. */
  suggestions?: string[];
  tone?: Tone;
  /** When set, chips are draggable and carry this ID in the drag payload. */
  dragId?: string;
  /** Called with the chip value when a chip from a different dragId is dropped here. */
  onChipDrop?: (value: string) => void;
  /** When true, ambiguous acronyms get a "Did you mean …?" OpenAlex nudge. */
  suggestConcepts?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [suggestion, setSuggestion] = useState<
    { forValue: string; candidates: ConceptSuggestion[] } | null
  >(null);
  const suggestReqRef = useRef(0);

  const fetchSuggestion = async (value: string) => {
    if (!suggestConcepts || !looksAmbiguous(value)) return;
    const reqId = ++suggestReqRef.current;
    try {
      const data = await apiFetch<{ suggestions?: ConceptSuggestion[] }>(
        `/api/topics/suggest?q=${encodeURIComponent(value)}`,
        { cache: "no-store" },
      );
      if (reqId !== suggestReqRef.current) return; // a newer entry superseded this
      const candidates = (data.suggestions ?? [])
        .filter((s) => s.name.toLowerCase() !== value.trim().toLowerCase())
        .slice(0, 2);
      setSuggestion(candidates.length > 0 ? { forValue: value, candidates } : null);
    } catch {
      /* network hiccup — no nudge */
    }
  };

  const applySuggestion = (name: string) => {
    if (suggestion) {
      const next = values.map((v) => (v === suggestion.forValue ? name : v));
      onChange(Array.from(new Set(next)));
    }
    setSuggestion(null);
  };

  const commit = (raw: string) => {
    const cleaned = raw.trim().replace(/,$/, "").trim();
    if (!cleaned) return;
    if (values.includes(cleaned)) {
      setDraft("");
      return;
    }
    onChange([...values, cleaned]);
    setDraft("");
    void fetchSuggestion(cleaned);
  };

  const remove = (v: string) => {
    if (suggestion?.forValue === v) setSuggestion(null);
    onChange(values.filter((x) => x !== v));
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && values.length) {
      onChange(values.slice(0, -1));
    } else if (e.key === "Tab" && draft !== "") {
      e.preventDefault();
      commit(draft);
    }
  };

  const chipClass = toneBadge(tone);
  const isDraggable = !!dragId;
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep a stable ref to onChipDrop so the native listener always calls the
  // latest version without needing to re-register on every render.
  const onChipDropRef = useRef(onChipDrop);
  useEffect(() => { onChipDropRef.current = onChipDrop; }, [onChipDrop]);

  // ── Native drag listeners (bypass React synthetic events, matches the HTML
  //    test that confirmed working in Firefox) ──────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Source-side: dragstart / dragend (delegated from chip spans)
    const onDragStart = (e: DragEvent) => {
      const chip = (e.target as Element).closest("[data-chip-value]") as HTMLElement | null;
      if (!chip) return;
      const value = chip.dataset.chipValue;
      if (!value || !dragId) return;
      _chipDrag = { value, source: dragId };
      try {
        e.dataTransfer!.setData("text/plain", JSON.stringify({ kind: "chip", value, source: dragId }));
        e.dataTransfer!.effectAllowed = "move";
      } catch { /* ok */ }
    };
    const onDragEnd = () => { _chipDrag = null; };

    // Drop-target-side
    const onDragEnter = (e: DragEvent) => { e.preventDefault(); setIsDragOver(true); };
    const onDragLeave = (e: DragEvent) => {
      if (!el.contains(e.relatedTarget as Node)) setIsDragOver(false);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (_chipDrag && _chipDrag.source !== dragId) {
        onChipDropRef.current?.(_chipDrag.value);
        _chipDrag = null;
      }
    };

    el.addEventListener("dragstart", onDragStart);
    el.addEventListener("dragend", onDragEnd);
    if (onChipDropRef.current) {
      el.addEventListener("dragenter", onDragEnter);
      el.addEventListener("dragleave", onDragLeave);
      el.addEventListener("dragover", onDragOver);
      el.addEventListener("drop", onDrop);
    }
    return () => {
      el.removeEventListener("dragstart", onDragStart);
      el.removeEventListener("dragend", onDragEnd);
      el.removeEventListener("dragenter", onDragEnter);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("drop", onDrop);
    };
  }, [dragId, isDraggable]);

  const dropRingClass = isDragOver
    ? tone === "accent"
      ? "bg-accent-dim/50 ring-2 ring-accent/50"
      : "bg-tag-dim/50 ring-2 ring-tag/50"
    : "bg-bg-secondary/40 hover:bg-bg-secondary/55 focus-within:bg-bg-secondary/55 focus-within:ring-2 focus-within:ring-accent/20";

  return (
    <>
      <div
        ref={containerRef}
        onClick={() => inputRef.current?.focus()}
        className={`flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all min-h-[38px] ${dropRingClass}`}
        style={{ cursor: "text" }}
      >
        {values.map((v) => (
          <span
            key={v}
            draggable={isDraggable}
            data-chip-value={isDraggable ? v : undefined}
            className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-meta ${chipClass}`}
            style={{
              cursor: isDraggable ? "grab" : undefined,
              userSelect: isDraggable ? "none" : undefined,
            }}
          >
            {v}
            <button
              type="button"
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                remove(v);
              }}
              aria-label={`Remove ${v}`}
              className="inline-flex items-center justify-center w-4 h-4 rounded hover:bg-black/5 opacity-60 hover:opacity-100 transition-all"
              style={{ cursor: "pointer" }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ pointerEvents: "none" }}>
                <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          onBlur={() => draft && commit(draft)}
          placeholder={values.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[8ch] bg-transparent text-text placeholder-text-faint/60 outline-none text-body-sm py-0.5"
        />
      </div>
      {suggestion && (
        <div
          className="mt-1.5 rounded-lg bg-bg-secondary/45 shadow-[inset_0_0_0_1px_rgba(20,20,20,0.05)] px-3 py-2"
        >
          <p className="eyebrow text-text-faint/80 mb-1.5">
            Did you mean…?
          </p>
          <div className="space-y-1">
            {suggestion.candidates.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  applySuggestion(c.name);
                }}
                className="block w-full text-left rounded-md px-2 py-1.5 hover:bg-accent-dim/40 transition-colors active:scale-[0.99]"
              >
                <span className="text-meta font-medium text-accent">{c.name}</span>
                {c.hint && (
                  <span className="block text-caption text-text-muted leading-snug mt-0.5">
                    {c.hint}
                  </span>
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSuggestion(null);
            }}
            className="mt-1 text-caption text-text-faint hover:text-text-muted transition-colors px-2"
          >
            No, keep &ldquo;{suggestion.forValue}&rdquo;
          </button>
        </div>
      )}
      {(suggestions && suggestions.length > 0 && values.length === 0) && (
        <div className="flex flex-wrap items-center gap-1 mt-1.5 px-1">
          <span className="eyebrow text-text-faint/70 mr-1">
            Try
          </span>
          {suggestions
            .filter((s) => !values.includes(s))
            .map((s) => (
              <button
                key={s}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  commit(s);
                }}
                className="text-caption text-text-faint hover:text-accent px-1.5 py-0.5 rounded-md hover:bg-accent-dim/40 transition-colors active:scale-[0.95]"
              >
                + {s}
              </button>
            ))}
        </div>
      )}
      {hint && (
        <p
          className="text-caption text-text-faint/75 mt-1.5 px-1 leading-relaxed"
        >
          {hint}
        </p>
      )}
    </>
  );
}

// ── TopicsField (Required + Nice-to-have, with cross-drag) ──────

export function TopicsField({
  required,
  soft,
  onChangeRequired,
  onChangeSoft,
}: {
  required: string[];
  soft: string[];
  onChangeRequired: (next: string[]) => void;
  onChangeSoft: (next: string[]) => void;
}) {
  // Single column on phones — two 155px columns at 375px made the one
  // REQUIRED onboarding field nearly unusable.
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="min-w-0">
        <p className="eyebrow mb-1.5 text-accent/80">
          Required
        </p>
        <ChipInput
          values={required}
          onChange={onChangeRequired}
          placeholder="Add a topic, press Enter"
          suggestions={SUGGESTED_TOPICS}
          tone="accent"
          dragId="required"
          suggestConcepts
          onChipDrop={(value) => {
            if (!required.includes(value)) {
              onChangeRequired([...required, value]);
            }
            onChangeSoft(soft.filter((v) => v !== value));
          }}
        />
        <p className="mt-1.5 px-0.5 text-micro leading-snug text-text-faint/70">
          Each result <strong>must</strong> be related to at least one of these.{" "}
          <strong>Prefer full terms over acronyms</strong> — short acronyms can be
          ambiguous and match unrelated fields, so spell the term out (you can add
          the acronym too).
        </p>
      </div>
      <div className="min-w-0">
        <p className="eyebrow mb-1.5 text-tag/80">
          Explore
        </p>
        <ChipInput
          values={soft}
          onChange={onChangeSoft}
          placeholder="Add a topic, press Enter"
          tone="tag"
          dragId="soft"
          suggestConcepts
          onChipDrop={(value) => {
            if (!soft.includes(value)) {
              onChangeSoft([...soft, value]);
            }
            onChangeRequired(required.filter((v) => v !== value));
          }}
        />
        <p className="mt-1.5 px-0.5 text-micro leading-snug text-text-faint/70">
          Matches on these topics score higher, but results without them can still
          appear.
        </p>
      </div>
    </div>
  );
}
