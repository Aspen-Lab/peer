/** The live benchmark is opt-in even when a machine happens to have Google env. */
export function canRunLiveEventsBenchmark(): boolean {
  return (
    process.env.PEER_RUN_LIVE_EVENTS_BENCHMARK === "1" &&
    Boolean(process.env.GOOGLE_VERTEX_PROJECT)
  );
}
