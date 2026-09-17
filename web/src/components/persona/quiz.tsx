"use client";

import { useEffect, useState } from "react";
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

// Bumped if Scores shape or AxisId set changes — old blobs are silently
// dropped on hydrate.
const STORAGE_KEY = "peer:persona:v1";

export function PersonaQuiz() {
  const [state, setState] = useState<QuizState>({ step: 0, answers: {} });
  const [result, setResult] = useState<{
    scores: Scores;
    persona: Persona;
  } | null>(null);

  // Hydrate last result from localStorage on mount. We persist only scores;
  // persona is re-derived via pickPersona so persona-definition tweaks
  // automatically reflect on next visit instead of getting frozen.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { scores?: Scores };
      if (!parsed?.scores) return;
      const persona = pickPersona(parsed.scores);
      setResult({ scores: parsed.scores, persona });
    } catch {
      // bad blob / quota / private mode — fall through to fresh quiz
    }
  }, []);

  // Persist scores whenever a result lands.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!result) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ scores: result.scores }),
      );
    } catch {
      // ignore — localStorage may be full or disabled
    }
  }, [result]);

  const current = QUESTIONS[state.step];
  const total = QUESTIONS.length;
  const progress = state.step / total;

  const choose = (choice: Choice) => {
    const nextAnswers = { ...state.answers, [current.id]: choice };
    const nextStep = state.step + 1;

    if (nextStep >= total) {
      const scores = compute(nextAnswers);
      const persona = pickPersona(scores);
      setResult({ scores, persona });
      return;
    }

    setState({ step: nextStep, answers: nextAnswers });
  };

  const back = () => {
    if (state.step === 0) return;
    setState((prev) => ({ ...prev, step: prev.step - 1 }));
  };

  const restart = () => {
    setResult(null);
    setState({ step: 0, answers: {} });
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  };

  if (result) {
    return (
      <PersonaResult
        scores={result.scores}
        persona={result.persona}
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
            className="h-full bg-[color:var(--color-accent)] transition-[width] duration-[var(--dur-base)] ease-out"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <span className="text-meta text-text-faint tabular-nums shrink-0">
          {state.step + 1} / {total}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="eyebrow text-text-faint">
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
      className="text-left p-5 rounded-2xl bg-surface shadow-card hover:shadow-card-hover hover:-translate-y-[1px] active:translate-y-0 active:shadow-card transition-[box-shadow,transform] text-body-lg text-text leading-[1.5]"
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
