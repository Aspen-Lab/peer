// GOOGLE-SIGNIN (ABC-JEV-INTEGRATION.md §1ad, rulings §1ai) — this file had
// zero coverage before this item (guide docs/jev-abc/GOOGLE-SIGNIN-B-…md §1
// confirms: no test file existed for use-auth-user.ts anywhere).
//
// use-auth-user.ts reads the `supabase` browser singleton AT CALL TIME inside
// each sign-in function (`if (!supabase) return;`), not at module-load time,
// so a getter-backed mock lets a single test flip between "configured" and
// "self-hosted / unconfigured" per test, without vi.resetModules() + a
// dynamic re-import (the pattern src/store/profile.test.ts uses for a
// different reason: reloading a module's own top-level state, not swapping
// what a dependency returns).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  configured: true,
}));

vi.mock("@/lib/supabase/client", () => ({
  get supabase() {
    return mocks.configured
      ? { auth: { signInWithOAuth: mocks.signInWithOAuth } }
      : null;
  },
}));

import { signInWithGitHub, signInWithGoogle, userAvatar, userName } from "./use-auth-user";

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00.000Z",
    email: "person@example.test",
    ...overrides,
  } as User;
}

beforeEach(() => {
  mocks.signInWithOAuth.mockReset();
  mocks.configured = true;
  // next/window shape signInWithGitHub/signInWithGoogle actually read.
  vi.stubGlobal("window", { location: { origin: "https://peer.test" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signInWithGoogle", () => {
  it("calls signInWithOAuth with the google provider, the shared /auth/callback redirect, and an account chooser", async () => {
    await signInWithGoogle();

    expect(mocks.signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://peer.test/auth/callback",
        queryParams: { prompt: "select_account" },
      },
    });
  });

  it("resolves without calling anything when Supabase is not configured (self-hosted)", async () => {
    mocks.configured = false;

    await expect(signInWithGoogle()).resolves.toBeUndefined();
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
  });
});

describe("signInWithGitHub — zero coverage before this item, added cheaply alongside signInWithGoogle (guide §6.2)", () => {
  it("resolves without calling anything when Supabase is not configured (self-hosted) — pre-existing guard", async () => {
    mocks.configured = false;

    await expect(signInWithGitHub()).resolves.toBeUndefined();
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("still requests only the github provider and the shared /auth/callback redirect — unchanged by adding Google", async () => {
    // P2 (ABC-JEV-INTEGRATION.md §1ai): GoTrue's own GitHub provider always
    // seeds its scope list with "user:email" server-side before appending
    // anything a caller passes (verified from
    // github.com/supabase/auth/internal/api/provider/github.go, quoted in
    // this item's C checkpoint) — so signInWithGitHub() is correctly left
    // with no explicit `scopes` option. This test protects that "no change"
    // finding from a silent future regression.
    await signInWithGitHub();

    expect(mocks.signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "github",
      options: { redirectTo: "https://peer.test/auth/callback" },
    });
  });
});

describe("userName / userAvatar — the existing fallback chain already serves a Google-shaped user (guide §2 — no code change)", () => {
  const googleShaped = {
    full_name: "Ada Lovelace",
    name: "Ada Lovelace",
    avatar_url: "https://lh3.googleusercontent.com/a/avatar.jpg",
    picture: "https://lh3.googleusercontent.com/a/avatar.jpg",
  };

  it("userName reads user_metadata.name (Google's normal shape carries it alongside full_name)", () => {
    const user = fakeUser({ user_metadata: googleShaped, email: "ada@gmail.com" });

    expect(userName(user)).toBe("Ada Lovelace");
  });

  it("userAvatar reads user_metadata.avatar_url for the same Google-shaped user", () => {
    const user = fakeUser({ user_metadata: googleShaped, email: "ada@gmail.com" });

    expect(userAvatar(user)).toBe("https://lh3.googleusercontent.com/a/avatar.jpg");
  });

  it("degrades to the email prefix and a null avatar when user_metadata is empty — never throws, never blank (community-reported edge case, guide §2)", () => {
    const user = fakeUser({ user_metadata: {}, email: "ada@gmail.com" });

    expect(userName(user)).toBe("ada");
    expect(userAvatar(user)).toBeNull();
  });
});
