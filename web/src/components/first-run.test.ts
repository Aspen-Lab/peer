// P7-16 (R12): `FirstRunGate` with its effects running.
//
// A profile that has never been set up opens on the /welcome walkthrough once.
// This repo has no DOM and `react-dom/server` never runs effects, so the gate
// runs on `test-support/hook-runtime` and the three things it reads — the
// router, the profile store and the sync gate — are small stand-ins. The
// decision itself (what counts as "set up", which pages are exempt) is proven
// in `lib/profile/first-visit.test.ts`; this file proves the gate acts on it:
// after hydration and sync, with `router.replace`, once.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return {
    ...actual,
    ...hookRuntime.hooks,
    // The gate reads "has the store hydrated" through this; a plain read is
    // what it comes to once the page is mounted.
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  };
});

const world = vi.hoisted(() => ({
  pathname: "/" as string | null,
  hydrated: true,
  syncSettled: true,
  profile: {} as Record<string, unknown>,
  replace: vi.fn(),
  completeOnboarding: vi.fn(),
  /** Stands in for the store action: it records the flag where a second open can read it. */
  skipWelcome: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => world.pathname,
  useRouter: () => ({ replace: world.replace }),
}));

vi.mock("@/store/profile", () => {
  const state = () => ({
    profile: world.profile,
    completeOnboarding: world.completeOnboarding,
    skipWelcome: world.skipWelcome,
  });
  const useProfileStore = Object.assign(
    (selector: (s: ReturnType<typeof state>) => unknown) => selector(state()),
    {
      persist: {
        hasHydrated: () => world.hydrated,
        onFinishHydration: () => () => {},
      },
    },
  );
  return { useProfileStore };
});

vi.mock("@/components/profile-sync", () => ({
  useSyncGate: (select: (s: { settled: boolean }) => unknown) => select({ settled: world.syncSettled }),
}));

import { hookRuntime } from "@/test-support/hook-runtime";
import { defaultProfile } from "@/types";
import { FirstRunGate } from "./first-run";

/** One page open: the gate mounts, runs its effects, and is let go. */
async function open(pathname: string) {
  world.pathname = pathname;
  const mounted = await hookRuntime.mount(() => FirstRunGate());
  mounted.unmount();
}

describe("FirstRunGate — a never-set-up profile opens on the walkthrough once (P7-16, R12)", () => {
  beforeEach(() => {
    world.pathname = "/";
    world.hydrated = true;
    world.syncSettled = true;
    world.profile = { ...defaultProfile };
    world.replace.mockReset();
    world.completeOnboarding.mockReset();
    world.skipWelcome.mockReset();
    world.skipWelcome.mockImplementation(() => {
      world.profile = { ...world.profile, welcomeSkipped: true };
    });
  });

  it("sends a fresh profile on the home page to /welcome, with replace", async () => {
    await open("/");
    expect(world.replace).toHaveBeenCalledTimes(1);
    expect(world.replace).toHaveBeenCalledWith("/welcome");
  });

  it("does it once per browser: the second open, after the flag was recorded, goes nowhere", async () => {
    await open("/");
    await open("/");
    await open("/search");
    expect(world.replace).toHaveBeenCalledTimes(1);
    expect(world.profile.welcomeSkipped).toBe(true);
  });

  it("sends a fresh profile on another page there too", async () => {
    await open("/search");
    expect(world.replace).toHaveBeenCalledWith("/welcome");
  });

  it("waits for the store to hydrate: nothing happens on the default profile of a first paint", async () => {
    world.hydrated = false;
    await open("/");
    expect(world.replace).not.toHaveBeenCalled();
    expect(world.skipWelcome).not.toHaveBeenCalled();
  });

  it("waits for the first sync to settle", async () => {
    world.syncSettled = false;
    await open("/");
    expect(world.replace).not.toHaveBeenCalled();
    expect(world.skipWelcome).not.toHaveBeenCalled();
  });

  it.each([
    ["a research topic", { researchTopics: ["battery materials"] }],
    ["a model key", { feedAiProvider: "openai", feedAiApiKey: "an-invented-key-for-the-test" }],
    ["onboardedAt", { onboardedAt: "2026-10-01T09:00:00.000Z" }],
    ["welcomeSkipped", { welcomeSkipped: true }],
  ])("leaves a profile with %s alone", async (_name, patch) => {
    world.profile = { ...defaultProfile, ...patch };
    await open("/");
    expect(world.replace).not.toHaveBeenCalled();
  });

  it("on /welcome nothing moves the reader; it only records that the walkthrough has been shown", async () => {
    await open("/welcome");
    expect(world.replace).not.toHaveBeenCalled();
    expect(world.skipWelcome).toHaveBeenCalledTimes(1);
    // ...so leaving it for another page does not bring the reader back.
    await open("/profile");
    expect(world.replace).not.toHaveBeenCalled();
  });

  it.each(["/privacy", "/persona", "/auth/error"])("never takes over %s", async (pathname) => {
    await open(pathname);
    expect(world.replace).not.toHaveBeenCalled();
    expect(world.skipWelcome).not.toHaveBeenCalled();
  });

  it("still backfills onboardedAt for a profile that has topics but no flag (unchanged)", async () => {
    world.profile = { ...defaultProfile, researchTopics: ["battery materials"] };
    await open("/");
    expect(world.completeOnboarding).toHaveBeenCalledTimes(1);
    expect(world.replace).not.toHaveBeenCalled();
  });

  it("does not backfill while the reader is on /welcome (a first topic may just have been added)", async () => {
    world.profile = { ...defaultProfile, researchTopics: ["battery materials"] };
    await open("/welcome");
    expect(world.completeOnboarding).not.toHaveBeenCalled();
  });
});
