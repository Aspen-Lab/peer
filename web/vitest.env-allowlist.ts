/** Exact environment names that the opt-in events benchmark may receive. */
export const liveEventsEnvAllowlist = [
  "GOOGLE_VERTEX_PROJECT",
  "GOOGLE_VERTEX_LOCATION",
  "GOOGLE_APPLICATION_CREDENTIALS",
] as const;

export type LiveEventsEnvName = (typeof liveEventsEnvAllowlist)[number];

/**
 * Picks only explicit names after Vite reads local env files. `loadEnv` takes
 * prefixes, so it cannot itself express this exact-name policy.
 */
export function selectLiveEventsEnv(
  source: Record<string, string | undefined>,
): Partial<Record<LiveEventsEnvName, string>> {
  return Object.fromEntries(
    liveEventsEnvAllowlist.flatMap((name) => {
      const value = source[name];
      return value === undefined ? [] : [[name, value]];
    }),
  ) as Partial<Record<LiveEventsEnvName, string>>;
}
