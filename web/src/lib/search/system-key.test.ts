import { afterEach, describe, expect, it, vi } from "vitest";
import {
  operatorSearchAvailability,
  resolveSystemSearchKeys,
} from "./system-key";

/**
 * ABC-freemium 1-05 · R-KEY-3.
 *
 * B's guide puts unit (b)'s tests in 1-09 (the three route tests). This file is
 * additional: 1-09 proves the routes send no operator key, and this proves the
 * resolver's order in isolation, so a failure says which of the two broke.
 *
 * The sentinel strings below are deliberately not key-shaped.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveSystemSearchKeys", () => {
  it("prefers the user's own key over everything", () => {
    vi.stubEnv("TAVILY_API_KEY", "OPERATOR-NOT-A-KEY");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");

    expect(
      resolveSystemSearchKeys({
        requestTavilyKey: "  USER-NOT-A-KEY  ",
        systemSearchAllowed: true,
      }),
    ).toEqual({
      tavily: "USER-NOT-A-KEY",
      brave: undefined,
      provenance: "byok",
    });
  });

  it("gives even an 'entitled' request nothing — the operator funds no search", () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 5-01 · D2a (Ruling 12).
    //
    // This case was called "gives an entitled request the operator's key" and
    // asserted `{ tavily: "OPERATOR-NOT-A-KEY", provenance: "system" }`. D2a
    // removed that branch: nobody, on any plan, spends the operator's Tavily
    // key, so the server key is never read even when it is set AND the flag
    // somehow arrives `true`. `systemSearchAllowed` is permanently `false`
    // after 5-02, and this case proves the resolver refuses regardless — it is
    // the removal of the BRANCH, not just the flag, that closes the path.
    vi.stubEnv("TAVILY_API_KEY", "OPERATOR-NOT-A-KEY");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");

    expect(resolveSystemSearchKeys({ systemSearchAllowed: true })).toEqual({
      tavily: undefined,
      brave: undefined,
      provenance: "none",
    });
  });

  it("gives an UNENTITLED request nothing, however the key is set", () => {
    // This is the whole item. Before it, this call returned the operator's key
    // to anyone who could reach a route — signed in or not, entitled or not.
    vi.stubEnv("TAVILY_API_KEY", "OPERATOR-NOT-A-KEY");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");

    expect(resolveSystemSearchKeys({ systemSearchAllowed: false })).toEqual({
      tavily: undefined,
      brave: undefined,
      provenance: "none",
    });
  });

  it("ignores a blank request key rather than treating it as BYOK", () => {
    // `parseSearchConnectors` drops an empty key, but a whitespace one could
    // still arrive; it must not read as the user's own.
    vi.stubEnv("TAVILY_API_KEY", "OPERATOR-NOT-A-KEY");

    expect(
      resolveSystemSearchKeys({
        requestTavilyKey: "   ",
        systemSearchAllowed: false,
      }).provenance,
    ).toBe("none");
  });

  it("gates Brave exactly like the system Tavily key", () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 2-04 · Ruling 5 point 2.
    //
    // This case used to be called "leaves Brave ungated, because D2 bans it on
    // Vercel anyway" and asserted that an unentitled caller still got the key.
    // The reasoning was that the build guard's ban made it unreachable — but a
    // ban on Vercel is not a gate on a self-host or a developer machine, and
    // Brave is operator-funded on both. It is one of the four providers Ruling
    // 5 point 2 puts behind one predicate.
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "BRAVE-NOT-A-KEY");

    const denied = resolveSystemSearchKeys({ systemSearchAllowed: false });
    const allowed = resolveSystemSearchKeys({ systemSearchAllowed: true });

    expect(denied.brave).toBeUndefined();
    expect(allowed.brave).toBe("BRAVE-NOT-A-KEY");
    // Provenance still describes the TAVILY key specifically — its meaning is
    // deliberately not widened (2-04). No Tavily key resolved either way.
    expect(denied.provenance).toBe("none");
    expect(allowed.provenance).toBe("none");
  });

  it("withholds Brave from a BYOK caller who is not entitled", () => {
    // 2-04 — the BYOK branch returns early and used to carry the ungated Brave
    // key out with it, so a reader's own Tavily key doubled as a free pass to
    // the operator's Brave account.
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "BRAVE-NOT-A-KEY");

    const keys = resolveSystemSearchKeys({
      requestTavilyKey: "USER-NOT-A-KEY",
      systemSearchAllowed: false,
    });

    expect(keys.provenance).toBe("byok");
    expect(keys.tavily).toBe("USER-NOT-A-KEY");
    expect(keys.brave).toBeUndefined();
  });

  it("withholds Brave when systemSearchAllowed is false, however the env is set", () => {
    // NEW — ABC-freemium 5-01 · **Ruling 13 point 3**, the named trap.
    //
    // The protective test for the field the ruling forbids deleting. With the
    // system Tavily branch gone, `SystemSearchKeyInput.systemSearchAllowed`
    // looks dead — it is the ONLY gate left on the `BRAVE_SEARCH_API_KEY` read.
    // If anyone "tidies" the field away, this case fails and says why: a
    // deployment-time ban on Vercel is not a gate on a self-host or a laptop,
    // and Brave is operator-funded on both.
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "BRAVE-NOT-A-KEY");
    vi.stubEnv("TAVILY_API_KEY", "OPERATOR-NOT-A-KEY");

    const keys = resolveSystemSearchKeys({ systemSearchAllowed: false });

    expect(keys.brave).toBeUndefined();
    expect(keys.tavily).toBeUndefined();
    expect(keys.provenance).toBe("none");
  });

  it("returns nothing when no candidate survives", () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");

    expect(resolveSystemSearchKeys({ systemSearchAllowed: true })).toEqual({
      tavily: undefined,
      brave: undefined,
      provenance: "none",
    });
  });
});

describe("operatorSearchAvailability", () => {
  it("is frozen false for both capabilities, whatever the flag says", () => {
    // NEW — ABC-freemium 5-01 · D2a (Ruling 12). Vertex AI Search and Gemini
    // grounding are operator-funded, so under D2a they are unavailable on every
    // plan. The helper no longer asks the environment at all: it stopped
    // importing `isGeminiSearchAvailable` / `isVertexSearchAvailable`, which is
    // why `spend-scans.test.ts` scan 3 now expects only the two owning modules.
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "NOT-A-PROJECT");
    vi.stubEnv("GOOGLE_VERTEX_LOCATION", "nowhere");
    vi.stubEnv("GOOGLE_VERTEX_SEARCH_ENGINE_ID", "NOT-AN-ENGINE");
    vi.stubEnv("GOOGLE_API_KEY", "NOT-A-KEY");

    expect(operatorSearchAvailability({ systemSearchAllowed: false })).toEqual({
      geminiAvailable: false,
      vertexAvailable: false,
    });
    expect(operatorSearchAvailability({ systemSearchAllowed: true })).toEqual({
      geminiAvailable: false,
      vertexAvailable: false,
    });
  });
});
