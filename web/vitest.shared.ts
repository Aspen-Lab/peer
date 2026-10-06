import { fileURLToPath } from "node:url";

export const sharedVitestConfig = {
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // JEV-DIRECT (§1aa): the `server-only` package's `package.json` picks
      // its no-op `empty.js` under Next's own "react-server" build condition
      // and its throwing `index.js` (meant to catch an accidental CLIENT
      // bundle import) under every other condition. Plain Node module
      // resolution — which vitest uses — has no "react-server" condition, so
      // without this alias EVERY test (server-equivalent, `environment:
      // "node"`) would hit the throwing branch merely by importing a
      // server-only-tagged module transitively (e.g. `jev-direct-client.ts`,
      // via the Jev screen the feed pipeline imports). This only changes what the
      // TEST runner resolves the package to — Next's real webpack/turbopack
      // build is untouched and keeps enforcing the actual client/server
      // split via its own condition.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
};
