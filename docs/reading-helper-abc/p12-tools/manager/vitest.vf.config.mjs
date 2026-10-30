const WEB = "__P12_SCRATCH__/p504/wt/web";
export default {
  root: WEB,
  resolve: { alias: { "@": WEB + "/src", "server-only": WEB + "/node_modules/server-only/empty.js" } },
  server: { fs: { strict: false } },
  test: {
    environment: "node",
    include: ["__P12_SCRATCH__/p12/mgr/tools/map-dump-v.test.ts"],
    setupFiles: [WEB + "/vitest.setup.ts"],
    testTimeout: 600000,
  },
};
