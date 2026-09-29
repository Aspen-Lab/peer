import { defineConfig } from "vitest/config";
import { sharedVitestConfig } from "./vitest.shared";

// Shared deterministic configuration. The dedicated live config composes this
// object but deliberately overrides test selection and environment injection.
export default defineConfig(sharedVitestConfig);
