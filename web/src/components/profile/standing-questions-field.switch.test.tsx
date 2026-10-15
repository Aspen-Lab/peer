import { beforeEach, describe, expect, it, vi } from "vitest";

// P10-03 (round P10; the owner's review 2.3, rubric A6): flipping the Profile's switch "Use my questions to tune
// recommendations" writes the profile — off stores `false`, on takes the key away (absent = on) — and the switch
// shows what it did. No DOM: the field runs on the minimal hook runtime and the switch's handler is called on the
// element tree it returns.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { hookRuntime } from "@/test-support/hook-runtime";
import { elements } from "@/test-support/question-session";
import { defaultProfile } from "@/types";
import { useProfileStore } from "@/store/profile";
import { STANDING } from "@/components/reader/copy";
import { StandingQuestionsField } from "./standing-questions-field";

async function field() {
  const mounted = await hookRuntime.mount(() => StandingQuestionsField());
  const toggle = elements(mounted.value as never).find((el) => el.props["aria-label"] === STANDING.tuneLabel)!;
  return { mounted, toggle };
}

beforeEach(() => useProfileStore.setState({ profile: { ...defaultProfile } }));

describe("the switch writes the profile", () => {
  it("is on at first; a flip to off stores false, a flip back takes the key away", async () => {
    const { toggle, mounted } = await field();
    expect(toggle.props.checked).toBe(true);

    (toggle.props.onChange as (on: boolean) => void)(false);
    expect(useProfileStore.getState().profile.questionsTuneRecommendations).toBe(false);

    (toggle.props.onChange as (on: boolean) => void)(true);
    expect("questionsTuneRecommendations" in useProfileStore.getState().profile).toBe(false);
    mounted.unmount();
  });

  it("opens off when the profile says false, and a flip to on is stored", async () => {
    useProfileStore.setState({ profile: { ...defaultProfile, questionsTuneRecommendations: false } });
    const { toggle, mounted } = await field();
    expect(toggle.props.checked).toBe(false);

    (toggle.props.onChange as (on: boolean) => void)(true);
    expect(useProfileStore.getState().profile.questionsTuneRecommendations).toBeUndefined();
    mounted.unmount();
  });

  it("changes nothing else on the profile, the standing questions and the ledger included", async () => {
    const before = { ...defaultProfile, standingQuestions: ["Which cohort was studied?"], preferenceLedger: { "text:grain": { positive: 1, negative: 0, lastAt: "2026-10-07T00:00:00.000Z" } } } as never;
    useProfileStore.setState({ profile: before });
    const { toggle, mounted } = await field();
    (toggle.props.onChange as (on: boolean) => void)(false);
    expect(useProfileStore.getState().profile).toEqual({ ...(before as object), questionsTuneRecommendations: false });
    mounted.unmount();
  });
});
