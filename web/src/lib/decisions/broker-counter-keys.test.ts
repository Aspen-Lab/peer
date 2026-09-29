/**
 * Proves the Edge Function's OWN reservation-key namespace
 * (web/supabase/functions/jev-broker/counter-keys.ts) is disjoint from the
 * Next side's (web/src/lib/security/jev-broker-auth.ts).
 *
 * Manager finding F-M-P3-01 (ABC-JEV-INTEGRATION.md §4, the
 * 2026-09-24T11:29:31Z entry; ruling corrects §1p.H(1)/(2)): before this fix
 * both sides reserved the exact same `jev:<owner>:<UTC-day>` /
 * `jev:all:<UTC-day>` keys through the same `increment_usage_counter` SQL
 * function, so every brokered call was counted TWICE and every cap was
 * silently halved (50/day per-user became 25 real calls; 2,000/day global
 * became 1,000). Ruling: each side reserves exactly once per call, in its
 * own namespace. The Next side keeps `jev:<owner>:<day>` / `jev:all:<day>`
 * (unchanged, asserted by web/src/lib/security/jev-broker-auth.test.ts).
 * The Edge side moves to `jev-edge:<owner>:<day>` / `jev-edge:all:<day>`,
 * built by the new pure module this file imports directly.
 *
 * That module lives under web/supabase/functions/jev-broker/, which is
 * excluded from the web/ TypeScript project (web/tsconfig.json) and from
 * eslint (web/eslint.config.mjs) because most of that folder is Deno-only
 * code (reads the `Deno` global, imports a bare https:// specifier). This
 * one module has neither — no imports, no Deno global — so it is plain,
 * portable TypeScript that both Deno and this Next-side vitest run can load
 * as-is. A "supabase/functions" tsconfig *exclude* only removes a file from
 * the auto-discovered root set; it does not stop an in-project file (this
 * test) from importing it directly, so `npx tsc --noEmit` still type-checks
 * this module once it is reached via this import — confirmed by the tsc
 * gate this slice's checkpoint records.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jevGlobalDayKey, jevPerUserDayKey } from "@/lib/security/jev-broker-auth";
import { edgeGlobalDayKey, edgePerUserDayKey } from "../../../supabase/functions/jev-broker/counter-keys";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const OWNER = "owner-a";

describe("edgePerUserDayKey / edgeGlobalDayKey", () => {
  it("build jev-edge:<owner>:<UTC-day> and jev-edge:all:<UTC-day>", () => {
    expect(edgePerUserDayKey(OWNER, NOW)).toBe("jev-edge:owner-a:2026-09-24");
    expect(edgeGlobalDayKey(NOW)).toBe("jev-edge:all:2026-09-24");
  });

  it("both start with the Edge side's own jev-edge: prefix", () => {
    expect(edgePerUserDayKey(OWNER, NOW).startsWith("jev-edge:")).toBe(true);
    expect(edgeGlobalDayKey(NOW).startsWith("jev-edge:")).toBe(true);
  });

  it("for the same owner and instant, never equal the Next side's keys (the bug this fixes)", () => {
    expect(edgePerUserDayKey(OWNER, NOW)).not.toBe(jevPerUserDayKey(OWNER, NOW));
    expect(edgeGlobalDayKey(NOW)).not.toBe(jevGlobalDayKey(NOW));
  });

  it("no Edge key can ever equal a Next key, for ANY owner — the two prefixes diverge at index 3 (':' vs '-'), so one string can never start with both at once", () => {
    expect("jev:".charAt(3)).not.toBe("jev-edge:".charAt(3));
    expect(edgePerUserDayKey(OWNER, NOW).startsWith("jev:")).toBe(false);
    expect(edgeGlobalDayKey(NOW).startsWith("jev:")).toBe(false);
    // Symmetric check from the other side, so this isn't just an artifact of
    // which literal happens to be a prefix of the other.
    expect(jevPerUserDayKey(OWNER, NOW).startsWith("jev-edge:")).toBe(false);
    expect(jevGlobalDayKey(NOW).startsWith("jev-edge:")).toBe(false);
  });

  it("compute the identical UTC-day segment as the Next side — same date math, only the prefix differs", () => {
    const edgeDay = edgePerUserDayKey(OWNER, NOW).split(":").pop();
    const nextDay = jevPerUserDayKey(OWNER, NOW).split(":").pop();
    expect(edgeDay).toBe("2026-09-24");
    expect(edgeDay).toBe(nextDay);
    expect(edgeGlobalDayKey(NOW).split(":").pop()).toBe(jevGlobalDayKey(NOW).split(":").pop());
  });

  it("an owner literally named \"all\" collides the per-user key with the global key on the Edge side — a pre-existing property of the binding <owner>/<all> scheme, not a new flaw introduced by this fix: the Next side has the identical collision", () => {
    expect(edgePerUserDayKey("all", NOW)).toBe(edgeGlobalDayKey(NOW));
    // Proven on the Next side too (ABC-JEV-INTEGRATION.md §1p.H(1)'s binding
    // jev:<owner>:<day> / jev:all:<day> scheme has the same shape), so this
    // is a documented, shared characteristic rather than a regression this
    // slice introduced. No production owner id is ever literally "all"
    // (Supabase auth ids are UUIDs), so this stays theoretical.
    expect(jevPerUserDayKey("all", NOW)).toBe(jevGlobalDayKey(NOW));
  });
});

describe("web/supabase/functions/jev-broker/index.ts wiring", () => {
  const INDEX_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../supabase/functions/jev-broker/index.ts",
  );
  const indexSource = readFileSync(INDEX_PATH, "utf8");

  it("imports edgePerUserDayKey and edgeGlobalDayKey from ./counter-keys.ts", () => {
    expect(indexSource).toMatch(/from ["']\.\/counter-keys\.ts["']/);
    expect(indexSource).toContain("edgePerUserDayKey");
    expect(indexSource).toContain("edgeGlobalDayKey");
  });

  it("no longer builds jev:${...} key literals inline (the double-reservation bug's exact shape)", () => {
    expect(indexSource).not.toMatch(/`jev:\$\{/);
  });
});
