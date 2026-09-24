// npm run purge-uploads — a local/manual trigger for the same daily cleanup
// Vercel's own cron (repo-root `vercel.json`) calls in production.
//
// WHY AN HTTP CALL, NOT A DIRECT IMPORT of `purgeExpiredUploads`: the route
// (`/api/jobs/purge-uploads`) already IS that function, gated by the same
// bearer check a real cron caller goes through — calling it over HTTP is the
// one code path, never a second implementation to keep in sync. A direct
// `import` of the TypeScript module would need a TS-execution tool; `tsx` is
// only an OPTIONAL peer dependency of `vite` in this repo (never resolved
// into `node_modules` — `npx tsx` would silently download a fresh copy on
// every run, which the "no new npm dependencies" rule treats as adding one).
// Plain `node` running this file avoids that entirely.
//
// Requires the app (`next dev` or a deployed instance) to already be
// running at PEER_PURGE_URL — this script does not start one. Requires
// CRON_SECRET to be set in the environment this script runs in; it is never
// printed, only sent as the bearer.
//
//   CRON_SECRET=... npm run purge-uploads
//   PEER_PURGE_URL=https://your-deployment/api/jobs/purge-uploads CRON_SECRET=... npm run purge-uploads
//
// This script existing does NOT mean a scheduler runs on this machine —
// nothing calls it automatically here. See docs/PRIVATE_PDF_UPLOADS.md for
// what self-hosting actually requires (an operator's own OS-level scheduler
// calling this script, or the route directly, on a cadence of their choice).

const url = process.env.PEER_PURGE_URL?.trim() || "http://localhost:3000/api/jobs/purge-uploads";
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("[purge-uploads] CRON_SECRET is not set in this environment — refusing to call the route with no bearer.");
  process.exit(1);
}

try {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`[purge-uploads] HTTP ${res.status}${body?.error ? `: ${body.error}` : ""}`);
    process.exit(1);
  }
  console.log(`[purge-uploads] ok: ${JSON.stringify(body)}`);
} catch (err) {
  console.error(`[purge-uploads] request failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
