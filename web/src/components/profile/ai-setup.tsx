"use client";

// Shared AI-provider setup used by BOTH the feed command bar (`/`) and the
// onboarding wizard (`/welcome`). Runtime model IDs and walkthrough copy share
// one catalog so the guidance always matches the requests Peer actually sends.

import { useState } from "react";
import type { UserAiProvider } from "@/types";
import { SecretInput } from "@/components/ui";
import {
  PROVIDER_MODELS,
  type UserCloudAiProvider,
} from "@/lib/llm/provider-models";

export const FEED_AI_PROVIDER_OPTIONS: { value: UserAiProvider; label: string }[] = [
  { value: "default", label: "Tier 0 — no AI API" },
  { value: "gemini", label: "Google Gemini — recommended: best value" },
  { value: "openai", label: "OpenAI (ChatGPT models) — recommended: easiest" },
  { value: "qwen", label: "Alibaba Qwen — low-cost alternative" },
  { value: "anthropic", label: "Anthropic Claude — premium quality" },
  { value: "deepseek", label: "DeepSeek — text only, no image analysis" },
];

type ProviderGuide = {
  name: string;
  verdict: string;
  dropdownTitle: string;
  bestFor: string;
  estimatedMonthly: string;
  keyUrl: string;
  keyLinkLabel: string;
};

const PROVIDER_GUIDES: Record<UserCloudAiProvider, ProviderGuide> = {
  gemini: {
    name: "Google Gemini",
    verdict: "Best value for most Peer users",
    dropdownTitle: "Why Google Gemini is the best value model for most Peer users",
    bestFor:
      "Strong reports, charts, and paper figures at the lowest cost among our two primary recommendations.",
    estimatedMonthly: "about $8/month",
    keyUrl: "https://aistudio.google.com/apikey",
    keyLinkLabel: "Create a Gemini API key",
  },
  openai: {
    name: "OpenAI",
    verdict: "Easiest all-around choice",
    dropdownTitle: "Why OpenAI is the easiest all-around choice",
    bestFor:
      "Reliable text and image understanding with the simplest familiar option for people who already use ChatGPT.",
    estimatedMonthly: "about $16/month",
    keyUrl: "https://platform.openai.com/api-keys",
    keyLinkLabel: "Create an OpenAI API key",
  },
  qwen: {
    name: "Alibaba Qwen",
    verdict: "Low-cost full-feature alternative",
    dropdownTitle: "Why Alibaba Qwen is a low-cost full-feature alternative",
    bestFor:
      "Good text and image capability at low cost, with a slightly more involved account and region setup.",
    estimatedMonthly: "about $7/month",
    keyUrl: "https://modelstudio.console.alibabacloud.com/",
    keyLinkLabel: "Open Alibaba Model Studio",
  },
  anthropic: {
    name: "Anthropic Claude",
    verdict: "Premium report quality",
    dropdownTitle: "Why Anthropic Claude is the premium-quality option",
    bestFor:
      "Excellent long-form reading and image understanding when report quality matters more than price.",
    estimatedMonthly:
      "about $60/month during Sonnet 5 introductory pricing; about $75/month afterward",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyLinkLabel: "Create an Anthropic API key",
  },
  deepseek: {
    name: "DeepSeek",
    verdict: "Lowest-cost text-only option",
    dropdownTitle: "Why DeepSeek is the lowest-cost text-only option",
    bestFor:
      "Tier 1/2 text ranking, summaries, and report writing when you do not need figures, charts, or other images analyzed.",
    estimatedMonthly: "about $7/month",
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyLinkLabel: "Create a DeepSeek API key",
  },
};

/** Short label for the inline tool pill on the feed command bar. */
export function providerShortLabel(p: UserAiProvider): string {
  switch (p) {
    case "openai":
      return "OpenAI";
    case "gemini":
      return "Gemini";
    case "anthropic":
      return "Claude";
    case "qwen":
      return "Qwen";
    case "deepseek":
      return "DeepSeek";
    default:
      return "AI key";
  }
}

export function providerKeyPlaceholder(p: UserAiProvider): string {
  switch (p) {
    case "openai":
      return "OpenAI API key";
    case "gemini":
      return "Gemini API key";
    case "qwen":
      return "Qwen / Model Studio API key";
    case "deepseek":
      return "DeepSeek API key";
    case "anthropic":
      return "Anthropic API key";
    default:
      return "API key";
  }
}

/**
 * The provider <select> + conditional API-key <input>. The one piece of AI
 * setup that must look and behave identically on the feed and in onboarding.
 */
export function AiKeyFields({
  provider,
  apiKey,
  onProviderChange,
  onApiKeyChange,
  idPrefix = "ai",
  emphasized = false,
  showRegistrationLink = false,
}: {
  provider: UserAiProvider;
  apiKey: string;
  onProviderChange: (p: UserAiProvider) => void;
  onApiKeyChange: (key: string) => void;
  idPrefix?: string;
  emphasized?: boolean;
  showRegistrationLink?: boolean;
}) {
  const guide = provider === "default" ? null : PROVIDER_GUIDES[provider];
  const fields = (
    <>
      {emphasized && (
        <div>
          <p className="text-meta font-semibold text-heading">
            Connect your API key here
          </p>
          <p className="mt-1 text-caption leading-relaxed text-text-muted">
            First choose the AI company. Then paste the key it gives you into
            the box below.
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <label
          htmlFor={`${idPrefix}-provider`}
          className={`block text-micro font-bold uppercase tracking-[0.14em] ${
            emphasized ? "text-accent" : "text-text-faint"
          }`}
        >
          AI company
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            id={`${idPrefix}-provider`}
            value={provider}
            onChange={(e) => onProviderChange(e.target.value as UserAiProvider)}
            className={`min-w-0 flex-1 rounded-lg px-3 py-2.5 text-meta font-medium text-text focus:outline-none focus:ring-2 focus:ring-accent/35 ${
              emphasized
                ? "border border-accent/30 bg-bg shadow-[0_3px_14px_color-mix(in_srgb,var(--color-accent)_10%,transparent)]"
                : "bg-bg-secondary/45"
            }`}
          >
            {FEED_AI_PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {showRegistrationLink && guide && (
            <a
              href={guide.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-heading px-3.5 py-2.5 text-meta font-semibold text-bg shadow-sm transition-colors hover:bg-heading/90"
            >
              {guide.keyLinkLabel}
              <span aria-hidden>↗</span>
            </a>
          )}
        </div>
      </div>
      {provider !== "default" && (
        <div className="space-y-1.5">
          <label
            htmlFor={`${idPrefix}-key`}
            className={`block text-micro font-bold uppercase tracking-[0.14em] ${
              emphasized ? "text-accent" : "text-text-faint"
            }`}
          >
            API key
          </label>
          <SecretInput
            id={`${idPrefix}-key`}
            value={apiKey}
            onChange={onApiKeyChange}
            placeholder={providerKeyPlaceholder(provider)}
            className={
              emphasized
                ? "w-full rounded-lg border border-accent/30 bg-bg py-2.5 pl-3 pr-10 text-[12.5px] text-text shadow-[0_3px_14px_color-mix(in_srgb,var(--color-accent)_10%,transparent)] placeholder:text-text-faint/65 focus:outline-none focus:ring-2 focus:ring-accent/35"
                : undefined
            }
          />
        </div>
      )}
    </>
  );

  return emphasized ? (
    <div className="space-y-3 rounded-2xl border-2 border-accent/25 bg-accent/[0.055] p-4 shadow-[0_8px_28px_color-mix(in_srgb,var(--color-accent)_8%,transparent)]">
      {fields}
    </div>
  ) : (
    fields
  );
}

function modelLabel(model: string): string {
  const exactLabels: Record<string, string> = {
    "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
    "claude-sonnet-5": "Claude Sonnet 5",
    "gemini-2.5-flash-lite": "Gemini 2.5 Flash-Lite",
    "gemini-2.5-flash": "Gemini 2.5 Flash",
    "gpt-5.4-nano": "GPT-5.4 nano",
    "gpt-5.4-mini": "GPT-5.4 mini",
    "qwen3.5-flash": "Qwen 3.5 Flash",
    "qwen3.7-plus": "Qwen 3.7 Plus",
    "deepseek-v4-flash": "DeepSeek V4 Flash",
    "deepseek-v4-pro": "DeepSeek V4 Pro",
  };
  return exactLabels[model] ?? model;
}

/** The calm, always-visible first recommendation for API beginners. */
export function AiProviderRecommendation() {
  return (
    <div className="rounded-2xl border border-accent/15 bg-accent/[0.045] p-4">
      <p className="text-meta font-semibold text-heading">
        Which AI company should you choose?
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-bg/70 p-3 shadow-[inset_0_0_0_1px_rgba(20,20,20,0.05)]">
          <p className="text-meta font-semibold text-heading">Gemini — best value</p>
          <p className="mt-1 text-caption leading-relaxed text-text-muted">
            Our first choice for most people: economical, fast, and able to read
            paper figures and charts.
          </p>
        </div>
        <div className="rounded-xl bg-bg/70 p-3 shadow-[inset_0_0_0_1px_rgba(20,20,20,0.05)]">
          <p className="text-meta font-semibold text-heading">OpenAI — easiest</p>
          <p className="mt-1 text-caption leading-relaxed text-text-muted">
            The company behind ChatGPT. It costs a little more, but offers a
            strong, familiar text-and-image option.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Selected-provider guidance. Runtime and copy share the same model IDs. */
export function AiProviderGuide({ provider }: { provider: UserAiProvider }) {
  const [open, setOpen] = useState(false);

  if (provider === "default") {
    return (
      <div className="rounded-xl bg-bg-secondary/35 p-4 text-meta leading-relaxed text-text-muted shadow-[inset_0_0_0_1px_rgba(20,20,20,0.05)]">
        <span className="font-semibold text-heading">No key is okay.</span>{" "}
        Peer&apos;s free Tier 0 briefing still works. Choose a company above only
        when you want Tier 1/2 AI ranking, richer summaries, and Deep reports.
      </div>
    );
  }

  const guide = PROVIDER_GUIDES[provider];
  const models = PROVIDER_MODELS[provider];
  const isDeepSeek = provider === "deepseek";

  return (
    <div className="overflow-hidden rounded-xl bg-bg-secondary/35 shadow-[inset_0_0_0_1px_rgba(20,20,20,0.05)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-meta font-semibold text-heading transition-colors hover:text-accent"
      >
        <span>{guide.dropdownTitle}</span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          className={`shrink-0 opacity-60 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        >
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>

      {isDeepSeek && (
        <div
          role="note"
          className="mx-4 mb-3 rounded-xl border border-accent/25 bg-accent/[0.06] px-3 py-2.5 text-caption leading-relaxed text-text-muted"
        >
          <strong className="text-heading">
            Important: DeepSeek cannot process images in Peer.
          </strong>{" "}
          It can power Tier 1/2 text work and text Deep reports across Papers,
          Events, and Jobs, but Peer will skip figure, chart, diagram, and other
          image analysis.
        </div>
      )}

      {open && (
        <div className="space-y-3 border-t border-border/50 px-4 pb-4 pt-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="max-w-2xl text-caption leading-relaxed text-text-muted">
              {guide.bestFor}
            </p>
            <span className="rounded-full bg-bg px-2.5 py-1 text-micro font-semibold text-text-muted shadow-[inset_0_0_0_1px_rgba(20,20,20,0.06)]">
              Heavy-use estimate: {guide.estimatedMonthly}
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-bg/65 p-3">
              <p className="text-micro font-semibold uppercase tracking-[0.12em] text-text-faint">
                Everyday model
              </p>
              <p className="mt-1 text-meta font-semibold text-heading">
                {modelLabel(models.small)}
              </p>
              <p className="mt-1 text-caption leading-relaxed text-text-muted">
                Fast, economical ranking, query building, classification, and
                short summaries.
              </p>
            </div>
            <div className="rounded-xl bg-bg/65 p-3">
              <p className="text-micro font-semibold uppercase tracking-[0.12em] text-text-faint">
                Deep-report model
              </p>
              <p className="mt-1 text-meta font-semibold text-heading">
                {modelLabel(models.large)}
              </p>
              <p className="mt-1 text-caption leading-relaxed text-text-muted">
                Stronger reading and extraction for every Deep report you open
                in Papers, Events, or Jobs.
              </p>
            </div>
          </div>

          <p className="text-caption leading-relaxed text-text-muted">
            <strong className="text-heading">Why two models?</strong> You provide
            one key. Peer automatically sends frequent, simpler work to the
            economical model and reserves the stronger model for Deep reports.
            You do not need to choose or switch models yourself.
          </p>

          {provider === "openai" && (
            <p className="text-caption leading-relaxed text-text-muted">
              A ChatGPT subscription and OpenAI API billing are separate. Even
              if you pay for ChatGPT, create an API key and add a small API
              spending limit for Peer.
            </p>
          )}

          <p className="text-micro leading-relaxed text-text-faint">
            Estimate assumes about 40 opened Deep reports per day (10 papers, 15
            events, and 15 jobs), plus normal daily Tier 1/2 use. Actual billing
            is usage-based and can be much lower.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * "What is an API key?" helper for non-technical users. Collapsed by default so
 * the setup page stays calm; the explainer video only mounts once expanded.
 */
export function ApiKeyHelp({ provider }: { provider: UserAiProvider }) {
  const [open, setOpen] = useState(false);
  const guide = provider === "default" ? null : PROVIDER_GUIDES[provider];

  return (
    <div className="overflow-hidden rounded-xl bg-bg-secondary/35 shadow-[inset_0_0_0_1px_rgba(20,20,20,0.05)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-meta font-medium text-text-muted transition-colors hover:text-heading"
      >
        <span className="inline-flex items-center gap-2">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
          </svg>
          New to API keys? How this works
        </span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          className={`opacity-60 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border/50 px-4 pb-4 pt-3">
          <p className="text-meta leading-relaxed text-text-muted">
            An API key is a private password that lets Peer send your requests
            directly to the AI company you chose. That company bills you only
            for what you use, measured in &ldquo;tokens&rdquo; (small chunks of
            text).
          </p>
          <ol className="list-decimal space-y-1.5 pl-5 text-meta leading-relaxed text-text-muted">
            <li>Choose an AI company above.</li>
            <li>Create an account, enable API billing, and set a small spending limit.</li>
            <li>Create a secret API key, copy it once, and paste it into Peer.</li>
          </ol>
          {guide && (
            <a
              href={guide.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-meta font-semibold text-accent hover:underline"
            >
              {guide.keyLinkLabel}
              <span aria-hidden>↗</span>
            </a>
          )}
          <p className="text-caption leading-relaxed text-text-faint">
            Never share your key. Peer stores it only in this browser and sends
            it only when calling your selected AI provider.
          </p>

          <div
            className="relative w-full overflow-hidden rounded-lg bg-black/80"
            style={{ paddingTop: "56.25%" }}
          >
            <iframe
              className="absolute inset-0 h-full w-full"
              src="https://www.youtube-nocookie.com/embed/sNn23dPRUS8?start=103"
              title="What is an API key?"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>

          <p className="text-caption leading-relaxed text-text-faint">
            You can skip this now and add a key anytime in your profile.
          </p>
        </div>
      )}
    </div>
  );
}
