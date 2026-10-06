// Single source of truth for the P4 dashboard-ledger rollout flag
// (ABC-JEV-INTEGRATION.md §1p.F). EXTRACTED from the inline
// `isDashboardLedgerEnabled()` that used to live directly in
// web/src/app/api/feed/route.ts: same env var, same
// `?.trim().toLowerCase() === "on"` comparison, same "anything else keeps
// today's behaviour" default. route.ts is switched to import this module
// (P4-S3's job) and no longer keeps its own inline copy;
// `ledger-flag.test.ts` is the contract this module is expected to satisfy.
//
// Deliberately narrow, unlike a forgiving on/true/1 parsing: the ledger
// tables are authored but not yet applied, so
// this flag is the explicit human rollout step a person flips only after
// separately authorizing the migration -- it does not try to be forgiving
// about how it's spelled ("true", "1", "yes" all stay off).
export function dashboardLedgerEnabled(): boolean {
  return process.env.PEER_DASHBOARD_LEDGER?.trim().toLowerCase() === "on";
}
