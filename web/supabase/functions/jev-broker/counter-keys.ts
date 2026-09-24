/**
 * Pure key-builders for THIS Edge Function's own reservation counters, used
 * by `reserveBoth` in ./index.ts. Deliberately has NO imports and reads no
 * `Deno` global, so it is plain, portable TypeScript: Deno can run it as-is
 * (nothing to resolve), and it can also be imported directly by relative
 * path from the Next/vitest side
 * (web/src/lib/decisions/broker-counter-keys.test.ts) even though the rest
 * of this folder is excluded from the web/ TypeScript project and from
 * eslint (web/tsconfig.json, web/eslint.config.mjs) — see index.ts's module
 * doc comment for why the folder itself is excluded; this one file just
 * happens to need none of what that exclusion protects against.
 *
 * SEPARATE NAMESPACE FROM THE NEXT SIDE — manager finding F-M-P3-01
 * (ABC-JEV-INTEGRATION.md §4, the 2026-09-24T11:29:31Z entry; ruling
 * corrects §1p.H(1)/(2)): before this fix, this Edge Function reserved the
 * SAME keys as the Next side (`jev:<owner>:<UTC-day>` / `jev:all:<UTC-day>`,
 * built by web/src/lib/security/jev-broker-auth.ts's `jevPerUserDayKey` /
 * `jevGlobalDayKey`), through the same underlying `increment_usage_counter`
 * SQL function. That meant one brokered call incremented each counter
 * TWICE, so every configured cap was silently halved (a 50/day per-user cap
 * became 25 real calls; a 2,000/day global cap became 1,000).
 *
 * Ruling: each side now reserves exactly ONE unit per call, in its own
 * namespace. The Next side is unchanged (`jev:<owner>:<day>` /
 * `jev:all:<day>`) — its count is what actually bounds real end-to-end
 * spend for a normal request. This Edge Function's own count, built here
 * with a disjoint `jev-edge:` prefix, independently bounds what a leaked
 * `PEER_JEV_BROKER_SECRET` could spend entirely on its own — which is the
 * whole reason this function reserves at all instead of just trusting that
 * the Next side already did (see index.ts's 429 response doc comment,
 * "defense-in-depth" / ABC-JEV-INTEGRATION.md §1p.H(2); §1p.I's
 * accepted-cost reasoning about a leaked secret is unaffected by this fix).
 * Both sides read their caps from the same env var names
 * (PEER_JEV_PER_USER_DAILY_CAP, PEER_JEV_GLOBAL_DAILY_CAP) but apply them to
 * their own separate counters.
 *
 * COLLISION NOTE: like the Next side's `jev:<owner>:<day>` / `jev:all:<day>`
 * scheme, an owner literally named `"all"` would make
 * `edgePerUserDayKey("all", now) === edgeGlobalDayKey(now)`. This is a
 * pre-existing property of the binding `<owner>` / literal-`"all"` design
 * (ABC-JEV-INTEGRATION.md §1p.H(1)), not something this fix introduces or
 * could unilaterally change without a new key-scheme ruling covering both
 * sides — see web/src/lib/decisions/broker-counter-keys.test.ts, which
 * proves both sides share the property. No real owner id is ever literally
 * `"all"` (Supabase auth ids are UUIDs), so this stays theoretical.
 */

function utcDaySegment(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * `jev-edge:<ownerId>:<UTC-day>` — this Edge Function's own per-user key.
 * Disjoint from the Next side's `jev:<ownerId>:<UTC-day>`
 * (web/src/lib/security/jev-broker-auth.ts's `jevPerUserDayKey`).
 */
export function edgePerUserDayKey(ownerId: string, now: Date): string {
  return `jev-edge:${ownerId}:${utcDaySegment(now)}`;
}

/**
 * `jev-edge:all:<UTC-day>` — this Edge Function's own global ceiling across
 * every owner, for one UTC day. Disjoint from the Next side's
 * `jev:all:<UTC-day>` (web/src/lib/security/jev-broker-auth.ts's
 * `jevGlobalDayKey`).
 */
export function edgeGlobalDayKey(now: Date): string {
  return `jev-edge:all:${utcDaySegment(now)}`;
}
