"use client";

// "Check key": a button under the model-key field that asks the provider, once,
// whether it accepts the key the reader pasted, and one line saying what it said.
//
// A reader who pasted a wrong key used to find out only when a report failed. The
// button posts `{ provider, apiKey }` to `/api/ai/check-key`, which makes one short
// request on that key and answers one word (`lib/llm/key-check.ts`); this file turns
// the word into a line. The key travels only in the request body, never in the
// address, and nothing here renders any part of it.
//
// What /privacy says about it ("Your own model key") is pinned to the route and to
// the button's label below.
//
// `KeyCheckView` is props only, so a test can render every state; `KeyCheck` reads
// the sign-in state and holds the result. The result belongs to one provider and one
// key: when either changes it is cleared, and an answer that arrives for a key the
// field no longer holds is dropped.

import { useState } from "react";
import type { UserAiProvider } from "@/types";
import { useSyncGate, type AuthOutcome } from "@/components/profile-sync";
import { buttonVariants } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { KEY_CHECK_RESULTS, type KeyCheckResult } from "@/lib/llm/key-check";

/** Where the check stands: not asked, waiting, or the route's word. */
export type KeyCheckStatus = "idle" | "checking" | KeyCheckResult;

/** Every string this component renders. */
export const KEY_CHECK_COPY = {
  button: "Check key",
  note: "Checking sends one short request to the provider, which may bill it to your key.",
  checking: "Checking…",
  ok: "This key works.",
  rejected: "The provider did not accept this key.",
  busy: "Too many checks this hour. Try again later.",
  unreachable: "Could not reach the provider just now. Try again.",
} as const;

/**
 * May the button be pressed? Only with a provider chosen, a key typed, and a sign-in
 * state the route will accept: signed in, or a copy of Peer with no sign-in at all.
 * "unknown" (still asking) and "signed-out" would only earn the route's 401.
 */
export function canCheckKey(provider: UserAiProvider, apiKey: string, authOutcome: AuthOutcome): boolean {
  return (
    provider !== "default" &&
    apiKey.trim().length > 0 &&
    (authOutcome === "signed-in" || authOutcome === "unconfigured")
  );
}

/** The line under the button, or nothing before the first check. */
export function keyCheckLine(status: KeyCheckStatus): string | null {
  return status === "idle" ? null : KEY_CHECK_COPY[status];
}

function isKeyCheckResult(value: unknown): value is KeyCheckResult {
  return typeof value === "string" && (KEY_CHECK_RESULTS as readonly string[]).includes(value);
}

/**
 * Ask the route. Answers a word whatever happens: the route's own 429 (this account's
 * hourly limit) is "busy", and any other failure, or an answer that is not one of the
 * four words, is "unreachable".
 */
export async function requestKeyCheck(provider: UserAiProvider, apiKey: string): Promise<KeyCheckResult> {
  try {
    const body = await apiFetch<{ result?: unknown } | undefined>("/api/ai/check-key", {
      method: "POST",
      body: JSON.stringify({ provider, apiKey }),
      cache: "no-store",
    });
    return isKeyCheckResult(body?.result) ? body.result : "unreachable";
  } catch (error) {
    return error instanceof ApiError && error.status === 429 ? "busy" : "unreachable";
  }
}

/** The button, the note beside it, and the result line. Props only. */
export function KeyCheckView({
  provider,
  apiKey,
  authOutcome,
  status,
  onCheck,
  idPrefix = "ai",
}: {
  provider: UserAiProvider;
  apiKey: string;
  authOutcome: AuthOutcome;
  status: KeyCheckStatus;
  onCheck: () => void;
  idPrefix?: string;
}) {
  const checking = status === "checking";
  const enabled = !checking && canCheckKey(provider, apiKey, authOutcome);
  const line = keyCheckLine(status);
  const noteId = `${idPrefix}-check-key-note`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          id={`${idPrefix}-check-key`}
          onClick={onCheck}
          disabled={!enabled}
          aria-busy={checking || undefined}
          aria-describedby={noteId}
          className={cn(
            buttonVariants({ tone: "soft", size: "sm" }),
            "shrink-0",
            !checking && "disabled:cursor-not-allowed",
          )}
        >
          {KEY_CHECK_COPY.button}
        </button>
        <span id={noteId} className="min-w-0 flex-1 text-micro leading-relaxed text-text-faint">
          {KEY_CHECK_COPY.note}
        </span>
      </div>
      <p
        id={`${idPrefix}-check-key-result`}
        role="status"
        aria-live="polite"
        className={cn(
          "text-caption leading-relaxed",
          status === "ok" ? "text-heading" : "text-text-muted",
        )}
      >
        {line}
      </p>
    </div>
  );
}

interface CheckState {
  provider: UserAiProvider;
  apiKey: string;
  status: KeyCheckStatus;
}

/**
 * The button under the model-key field. Pass the field's current provider and key;
 * `idPrefix` matches the field's (`AiKeyFields`), so the ids stay unique when both
 * the Profile page and the welcome wizard mount one.
 */
export function KeyCheck({
  provider,
  apiKey,
  idPrefix = "ai",
}: {
  provider: UserAiProvider;
  apiKey: string;
  idPrefix?: string;
}) {
  const authOutcome = useSyncGate((s) => s.authOutcome);
  const [state, setState] = useState<CheckState>(() => ({ provider, apiKey, status: "idle" }));

  // A new provider or key clears the result (React's "adjust state while rendering").
  const current = state.provider === provider && state.apiKey === apiKey;
  if (!current) setState({ provider, apiKey, status: "idle" });
  const status: KeyCheckStatus = current ? state.status : "idle";

  const onCheck = () => {
    if (!canCheckKey(provider, apiKey, authOutcome)) return;
    const started: CheckState = { provider, apiKey, status: "checking" };
    setState(started);
    void requestKeyCheck(provider, apiKey).then((result) => {
      // Dropped if the field moved on while the check was out.
      setState((now) => (now === started ? { ...started, status: result } : now));
    });
  };

  return (
    <KeyCheckView
      provider={provider}
      apiKey={apiKey}
      authOutcome={authOutcome}
      status={status}
      onCheck={onCheck}
      idPrefix={idPrefix}
    />
  );
}
