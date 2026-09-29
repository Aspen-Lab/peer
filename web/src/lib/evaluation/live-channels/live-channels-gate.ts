// LIVE-EVAL-4 (ABC-JEV-INTEGRATION.md §1u/§1w) — the opt-in gate and the
// presence-only credential report for the live Semantic Scholar / OpenAlex
// channel-comparison runner.
//
// Finding C1a (docs/jev-abc/LIVE-EVAL-4-B-20260925T044015Z.md): unlike the
// Vertex live-events gate (`../../events/benchmark-live-gate.ts`), this gate
// does NOT also require a credential to be present. Both `semantic-scholar-
// client.ts` (unkeyed path, `UNKEYED_MIN_INTERVAL_MS`) and `sources/
// openalex.ts` (`openAlexAuthHeaders()` returns `undefined` when no key) show
// that both providers serve a real, live, billable-on-OpenAlex's-side request
// with zero credentials configured. A gate that also required a credential
// would falsely report "blocked" on a machine deliberately testing the
// keyless path. Credential presence is reported for visibility (§1u.2
// requires this), never as a gate condition.

/** The live channel-comparison eval is opt-in even when a machine happens to have S2/OpenAlex credentials set. */
export function canRunLiveChannelsEval(): boolean {
  return process.env.PEER_RUN_LIVE_CHANNELS_EVAL === "1";
}

export interface CredentialPresence {
  semanticScholar: boolean;
  openAlexKey: boolean;
  openAlexEmail: boolean;
}

/**
 * Presence booleans only (§1u.2) — a credential VALUE must never appear in
 * any output this runner produces. This function is the one place a value is
 * even glanced at (`Boolean(x?.trim())`), and the value itself is discarded
 * immediately — only a boolean survives past this line.
 */
export function credentialPresence(): CredentialPresence {
  return {
    semanticScholar: Boolean(process.env.SEMANTIC_SCHOLAR_API_KEY?.trim()),
    openAlexKey: Boolean(process.env.OPENALEX_API_KEY?.trim()),
    openAlexEmail: Boolean(process.env.OPENALEX_EMAIL?.trim()),
  };
}
