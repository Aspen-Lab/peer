import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Deno-only Edge Function code (P3-S4) — not a Next file, reads Deno
    // globals ESLint's Next config has no reason to understand. See
    // web/supabase/functions/jev-broker/index.ts's module doc comment.
    "supabase/functions/**",
  ]),
]);

export default eslintConfig;
