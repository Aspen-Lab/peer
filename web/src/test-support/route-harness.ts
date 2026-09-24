/**
 * Shared scaffolding for driving real route handlers in tests.
 *
 * ABC-freemium 1-06 / 1-09 · Ruling 2 point 7. Round-1 A built this once as a
 * throwaway probe and deleted it; this is the permanent form, so the persona
 * pass is re-runnable by anyone instead of reconstructed from prose each round.
 *
 * **Not a `.test.ts` file on purpose** — vitest's `include` is
 * `src/**​/*.test.{ts,tsx}`, so a helper named `*.test.ts` would be run as an
 * empty suite.
 *
 * ── THE MONEY RULE, RESTATED WHERE IT BITES ──────────────────────────────────
 *
 * A suite that drives a real route reaches `resolveProvider`. After item 1-11
 * that returns a live provider wherever `GOOGLE_API_KEY` is set, so such a
 * suite must either mock `@/lib/llm/providers/registry` or run with the key
 * deleted. `vitest.setup.ts` (item 1-00) deletes `GOOGLE_API_KEY` and
 * `TAVILY_API_KEY` before every suite and every test, and
 * `deleteSpendableKeys()` below is the belt-and-braces call a suite can make
 * for itself. **Use sentinel strings only — never a real credential.**
 */

/** A key-shaped string that is obviously not a key. */
export const OPERATOR_SENTINEL = "OPERATOR-NOT-A-KEY";
/** The user's own key, for the BYOK personas. */
export const USER_SENTINEL = "USER-NOT-A-KEY";

/**
 * Belt-and-braces on top of `vitest.setup.ts`. Call from a `beforeEach` in any
 * suite that drives a real route without mocking the provider registry.
 */
export function deleteSpendableKeys(): void {
  delete process.env.GOOGLE_API_KEY;
  delete process.env.TAVILY_API_KEY;
}

export interface StubbedAuthUser {
  id: string;
}

/**
 * Build the object `@/lib/supabase/server`'s `createClient` returns, with a
 * controllable `auth.getUser()`.
 *
 * Used from inside a test file's own `vi.mock` factory, because `vi.mock` is
 * hoisted and cannot close over anything declared normally:
 *
 * ```ts
 * const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));
 * vi.mock("@/lib/supabase/server", () => ({
 *   createClient: () => Promise.resolve(supabaseServerStub(mocks.getUser)),
 * }));
 * ```
 */
export function supabaseServerStub(getUser: () => unknown) {
  return { auth: { getUser } };
}

/** What `auth.getUser()` resolves to for a signed-in user. */
export function signedIn(userId: string): {
  data: { user: StubbedAuthUser };
  error: null;
} {
  return { data: { user: { id: userId } }, error: null };
}

/** What `auth.getUser()` resolves to for a signed-out visitor. */
export function signedOut(): { data: { user: null }; error: null } {
  return { data: { user: null }, error: null };
}

/**
 * The environment of a real deployment: Supabase auth is configured, so the
 * shared guard reads a session instead of taking the "no sign-in mechanism"
 * branch.
 *
 * Pass `vi.stubEnv` in; this module must not import from `vitest`, or every
 * non-test consumer would pull the test runner in with it.
 */
export function deployedRuntimeEnv(
  stubEnv: (name: string, value: string) => void,
): void {
  stubEnv("VERCEL", "1");
  stubEnv("VERCEL_ENV", "production");
  stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "ANON-NOT-A-KEY");
}
