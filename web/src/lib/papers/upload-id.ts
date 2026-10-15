// The one rule for "is this an upload id" (P0-05, §1e.1), in a module of its
// own with no `node:` import, so the browser can use it too (P0-10, §1e.10).
// `upload-store.ts` re-exports both functions, so every server import of them
// from there keeps working.

/**
 * The bare hash16 from an `upload:<hash16>` id, or null when it isn't one.
 *
 * P0-05 (§1e.1): the one rule for "is this an upload id", and it is exact —
 * the lower-case prefix and the lower-case hex `sha16` / `privateUploadHash`
 * produce. It used to match case-insensitively while the owner checks in
 * front of it tested `startsWith("upload:")`, so `UPLOAD:<hash16>` skipped
 * the owner check and was still read from disk, into the shared full-text
 * cache. Every caller decides with this function; a spelling it does not
 * accept is refused where it claims to be an upload (`claimsUploadId`).
 */
export function bareUploadId(itemId: string): string | null {
  const match = itemId.match(/^upload:([0-9a-f]{16})$/);
  return match ? match[1] : null;
}

/**
 * Whether an id claims to be an upload: the prefix in any case, any
 * whitespace before it. A claim `bareUploadId` does not accept is refused as
 * "not found" — never read, and never treated as a public paper id either.
 */
export function claimsUploadId(itemId: string): boolean {
  return /^\s*upload:/i.test(itemId);
}
