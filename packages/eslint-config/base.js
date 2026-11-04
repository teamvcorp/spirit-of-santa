import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import onlyWarn from "eslint-plugin-only-warn";
import tseslint from "typescript-eslint";

/**
 * Base ESLint config for every workspace (apps extend it via ./next.js).
 *
 * - typescript-eslint parses TS. It requires TypeScript < 6.1, so do NOT bump the
 *   repo to TS 7 until typescript-eslint supports it (see docs/CODEMAP.md).
 * - only-warn turns errors into warnings. Every `lint` script runs with
 *   `--max-warnings 0`, so warnings still fail CI.
 * - turbo/no-undeclared-env-vars flags env vars missing from turbo.json, because
 *   an undeclared var won't invalidate the build cache when it changes.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    plugins: { turbo: turboPlugin },
    rules: { "turbo/no-undeclared-env-vars": "warn" },
  },
  { plugins: { onlyWarn } },
  { ignores: ["dist/**", ".next/**", "coverage/**"] },
];
