import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Every systematization in this codebase so far was a one-time sweep with no
// enforcement, and the files record the decay in their own comments: thirteen
// display sizes grown between 22 and 52px before the type scale; a kicker
// "retyped 30+ times with drifting tracking values". Spacing is at that stage
// now — 19 distinct steps across 418 vertical utilities. These rules are the
// part that survives the next sweep.
const OFF_SCALE = String.raw`\b(m|mt|mb|my|ms|me|p|pt|pb|py|gap|gap-x|gap-y|space-x|space-y)-(0\.5|1\.5|2\.5|3\.5|7|14)\b`;

const SPACING_MESSAGE =
  "Off Latent's 8-based scale (globals.css, 'Space'). Use 0.5→1, 1.5→2, " +
  "2.5→2 or 3, 3.5→4, 7→6 or 8, 14→12 or 16. Optical corrections on type " +
  "(py-[3px], pt-[0.34em]) are not covered by this rule and are fine.";

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
  ]),
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: `JSXAttribute[name.name='className'] Literal[value=/${OFF_SCALE}/]`,
          message: SPACING_MESSAGE,
        },
        {
          selector: `JSXAttribute[name.name='className'] TemplateElement[value.raw=/${OFF_SCALE}/]`,
          message: SPACING_MESSAGE,
        },
        {
          // `rounded-[…]` and inline borderRadius are the two mechanisms that
          // let a round corner survive the squaring — every radius token is 0.
          selector: "Literal[value=/rounded-\\[/]",
          message:
            "Nothing is round (globals.css, 'The radius scale'). Every --radius-* is 0; an arbitrary radius is the one way back in.",
        },
        {
          selector: "Property[key.name='borderRadius'][value.value!=0]",
          message:
            "Nothing is round (globals.css, 'The radius scale'). Use 0, or the frame — `boxShadow: '0 0 0 1px …'`.",
        },
      ],
    },
  },
]);

export default eslintConfig;
