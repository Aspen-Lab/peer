"use client";

import { useState, useSyncExternalStore } from "react";
import {
  AXES,
  ZERO_SCORES,
  normalizeScores,
  pickPersona,
  type AxisId,
  type Persona,
  type Scores,
} from "@/lib/persona/axes";
import { QUESTIONS, AXIS_WEIGHTS } from "@/lib/persona/questions";
import { PersonaResult } from "./result";

type Choice = -1 | 1;
type Answers = Record<string, Choice | undefined>;

interface QuizState {
  step: number;
  answers: Answers;
}

interface StoredResult {
  scores: Scores;
  persona: Persona;
}

// Bumped if Scores shape or AxisId set changes — old blobs are silently
// dropped on hydrate.
const STORAGE_KEY = "peer:persona:v1";

/**
 * The quiz's one persisted value — the last completed result — read through
 * `useSyncExternalStore` rather than `useState` + a mount effect, so hydrating
 * it never calls `setState` from inside an effect body (the same shape as
 * `FigureRegistry` in reader/report-sections.tsx). We persist only scores;
 * persona is re-derived via `pickPersona` on every read so persona-definition
 * tweaks automatically reflect on next visit instead of getting frozen.
 */
class QuizResultStore {
  private cachedRaw: string | null = null;
  private cachedResult: StoredResult | null = null;
  private listeners = new Set<() => void>();

  private parse(raw: string | null): StoredResult | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { scores?: Scores };
      if (!parsed?.scores) return null;
      return { scores: parsed.scores, persona: pickPersona(parsed.scores) };
    } catch {
      return null; // bad blob — fall through to a fresh quiz
    }
  }

  getSnapshot = (): StoredResult | null => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== this.cachedRaw) {
      this.cachedRaw = raw;
      this.cachedResult = this.parse(raw);
    }
    return this.cachedResult;
  };

  getServerSnapshot = (): StoredResult | null => null;

  set(scores: Scores | null): void {
    const raw = scores ? JSON.stringify({ scores }) : null;
    try {
      if (raw) window.localStorage.setItem(STORAGE_KEY, raw);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage may be full, disabled, or unavailable (private mode) —
      // the result still renders for this tab; it just won't survive a reload.
    }
    this.cachedRaw = raw;
    this.cachedResult = scores ? { scores, persona: pickPersona(scores) } : null;
    for (const listen of this.listeners) listen();
  }

  subscribe = (listen: () => void): (() => void) => {
    this.listeners.add(listen);
    // Other tabs writing the same key fire "storage" here; a same-tab write
    // goes through set() above, which notifies directly.
    window.addEventListener("storage", listen);
    return () => {
      this.listeners.delete(listen);
      window.removeEventListener("storage", listen);
    };
  };
}

const quizResultStore = new QuizResultStore();

export function PersonaQuiz() {
  const [state, setState] = useState<QuizState>({ step: 0, answers: {} });
  const stored = useSyncExternalStore(
    quizResultStore.subscribe,
    quizResultStore.getSnapshot,
    quizResultStore.getServerSnapshot,
  );

  const current = QUESTIONS[state.step];
  const total = QUESTIONS.length;
  const progress = state.step / total;

  const choose = (choice: Choice) => {
    const nextAnswers = { ...state.answers, [current.id]: choice };
    const nextStep = state.step + 1;

    if (nextStep >= total) {
      quizResultStore.set(compute(nextAnswers));
      return;
    }

    setState({ step: nextStep, answers: nextAnswers });
  };

  const back = () => {
    if (state.step === 0) return;
    setState((prev) => ({ ...prev, step: prev.step - 1 }));
  };

  const restart = () => {
    quizResultStore.set(null);
    setState({ step: 0, answers: {} });
  };

  if (stored) {
    return (
      <PersonaResult
        scores={stored.scores}
        persona={stored.persona}
        onRestart={restart}
      />
    );
  }

  return (
    <div
      className="flex flex-col gap-8"
    >
      <div className="flex items-center gap-4">
        <div className="flex-1 h-1 bg-[color:var(--color-bg-secondary)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[color:var(--color-accent)] transition-[width] duration-300 ease-out"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <span className="text-meta text-text-faint tabular-nums shrink-0">
          {state.step + 1} / {total}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-caption uppercase tracking-[0.16em] text-text-faint">
          {axisLabel(current.axis)}
        </span>
        <h2
          className="text-title-lg text-heading leading-snug font-reading"
        >
          Which is more you?
        </h2>
      </div>

      <div className="flex flex-col gap-3">
        <ChoiceButton text={current.a} onClick={() => choose(-1)} />
        <ChoiceButton text={current.b} onClick={() => choose(1)} />
      </div>

      <div className="flex items-center justify-between text-meta text-text-faint">
        <button
          type="button"
          onClick={back}
          disabled={state.step === 0}
          className="hover:text-[color:var(--color-accent)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          ← Back
        </button>
        <span>Forced choice — pick the one that fits more, not perfectly.</span>
      </div>
    </div>
  );
}

function ChoiceButton({
  text,
  onClick,
}: {
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left p-5 rounded-2xl bg-surface shadow-card hover:shadow-card-hover hover:-translate-y-[1px] active:translate-y-0 active:shadow-card transition-[box-shadow,transform] duration-200 text-body-lg text-text leading-[1.5]"
    >
      {text}
    </button>
  );
}

function axisLabel(id: AxisId): string {
  const axis = AXES.find((a) => a.id === id);
  if (!axis) return "";
  return `${axis.negative} ↔ ${axis.positive}`;
}

function compute(answers: Answers): Scores {
  const votes: Record<AxisId, number> = { ...ZERO_SCORES };
  QUESTIONS.forEach((q) => {
    const choice = answers[q.id];
    if (choice == null) return;
    votes[q.axis] += choice;
  });
  return normalizeScores(votes, AXIS_WEIGHTS);
}
