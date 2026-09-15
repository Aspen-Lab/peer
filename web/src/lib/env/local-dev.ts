/**
 * "Is this process a developer's own machine running `next dev`?"
 *
 * ABC-freemium 1-01 — extracted rather than copied a fourth time. The same
 * three-condition expression was written out in `llm/providers/registry.ts`
 * (`canUseLocalServerProvider`) and `security/ai-request.ts`
 * (`isLocalDevelopment`), and R-ENT-5 needs it a third time for
 * `PEER_DEV_ENTITLEMENT`. Three hand-copies of a security predicate is how one
 * of them quietly loses a condition, so both existing copies now delegate here
 * and keep their own exported names and meanings.
 *
 * **All three conditions matter.** `NODE_ENV === "development"` alone is true
 * during a Vercel *build*, and `vercel dev` sets `VERCEL` without setting
 * `NODE_ENV=production`. A deployed runtime must never take a local-development
 * branch, because every one of them hands out something the operator pays for.
 *
 * Note this is deliberately **false under `NODE_ENV=test`**: a test that wants
 * the local-development branch stubs `NODE_ENV` itself, so no suite gets it by
 * accident.
 */
export function isLocalDevRuntime(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    !process.env.VERCEL &&
    !process.env.VERCEL_ENV
  );
}
