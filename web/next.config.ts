import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ABC-freemium 9-05 · Ruling 26 point 5 — STATICALLY TYPED LINKS.
  //
  // Next generates a route definition into `.next/types` and TypeScript checks
  // every `next/link` `href` and every `next/navigation` `push`/`replace`/
  // `prefetch` against it. **A dead internal link becomes a compile error
  // instead of a test**, which is the earlier of the two guards this loop now
  // has — Ruling 18 point 2 and Ruling 19 point 1 both exist because a rendered
  // control resolved nowhere.
  //
  // **It does NOT replace `src/lib/navigation/dead-links.test.ts` and nothing
  // was deleted.** Typed routes check literals and the types feeding them; the
  // test resolves RENDERED links against the route tree **and `public/`** —
  // which is what proves `/CHANGELOG.md` is a real static file rather than a
  // dead link. Neither covers the other.
  //
  // Setup cost was zero: `tsconfig.json` already includes `.next/types/**/*.ts`,
  // which this option requires, and Next 16 validates template literals (its
  // own docs: "support includes any string literal, including dynamic
  // segments"), so `` href={`/papers/${id}`} `` is checked rather than cast.
  //
  // **THE ONE TRAP, measured twice — once by round-9 B and once by me.** The
  // generated types live under `.next/`, which `tsconfig.json` includes, so
  // `npx tsc --noEmit` reads whatever the last build wrote. Change this file
  // and `tsc` can report errors on source you never touched until a build
  // regenerates them. **If tsc reddens on untouched code, rebuild before
  // believing it.** That is why §3's gate runs the build LAST.
  typedRoutes: true,
  // Pin the Turbopack project root to THIS directory.
  //
  // Turbopack otherwise infers the root by walking up for a lockfile, and it
  // refuses to resolve modules outside that root. A stray package-lock.json in
  // the repo root (easy to create by running `npm` one directory too high)
  // moved the inferred root above web/, which made `tailwindcss` unresolvable.
  // Every failed CSS compile then leaked a postcss worker process that was
  // never reaped — hundreds of orphaned node processes in one session.
  // Pinning the root makes resolution deterministic and immune to that.
  turbopack: {
    root: __dirname,
  },
  outputFileTracingIncludes: {
    "/api/figure": ["./scripts/extract_pdf_figures.py"],
  },
  outputFileTracingExcludes: {
    "/*": [".tmp*/**"],
  },
};

export default nextConfig;
