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
    // Worktrees created by agent sessions carry their own .next/ build output,
    // and the pattern above only anchors at the repo root. Without this, `npm
    // run lint` reported 1109 errors across 203 files of MINIFIED BUNDLE — none
    // of it source, all of it drowning the handful of findings that were real.
    // A lint gate nobody can read is a lint gate nobody runs.
    ".claude/**",
    "native-shell/**",
  ]),
]);

export default eslintConfig;
