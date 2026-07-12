// @ts-check
/**
 * Flat ESLint config (ESLint 10 — eslintrc is no longer supported).
 *
 * Until now the repo had 100+ `// eslint-disable` comments but no ESLint
 * installed, so none of them did anything. This wires up real linting while
 * staying intentionally pragmatic: the goal is high-signal feedback that keeps
 * `npm run lint` green, not a wall of errors on an existing codebase.
 *
 * Notably we do NOT adopt the new React-Compiler ruleset shipped in
 * eslint-plugin-react-hooks v7 (purity / immutability / set-state-in-effect /
 * …). Those are valuable but are a separate, larger initiative; here we keep
 * only the two classic, high-confidence hooks rules.
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    // Generated output, the archived Chrome-extension code, vendored stubs, and
    // coverage are not ours to lint.
    ignores: [
      "dist/**",
      "legacy/**",
      "node_modules/**",
      "src/stubs/**",
      "coverage/**",
    ],
  },

  // --- TypeScript / React application source --------------------------------
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.worker, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // tsc already proves every identifier resolves and does it far better
      // than core no-undef, which would false-positive on every browser /
      // WebCodecs / chrome.* global. typescript-eslint recommends turning it
      // off for TS.
      "no-undef": "off",

      // Classic, high-signal hooks rules only (see file header).
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // Warnings, not errors: surfaces the issue without breaking the build.
      // The existing eslint-disable comments target exactly these rules, so
      // they finally mean something.
      "no-console": "warn",
      // New in ESLint 9.18; fires on a handful of defensive dead-stores in the
      // subtitle/player code. Useful signal, but not worth editing hot parsing
      // paths today — keep it visible as a warning.
      "no-useless-assignment": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // --- Node-side JS (build scripts, root config) ----------------------------
  {
    files: ["scripts/**/*.{js,mjs}", "*.{js,mjs}"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // Build scripts are expected to log to stdout.
      "no-console": "off",
    },
  },

  // Must come last: switches off stylistic rules that would fight Prettier.
  prettier,

  {
    linterOptions: {
      // A noisy first run would flag every suppression whose underlying rule
      // didn't happen to fire. Leave off for now; tighten to "warn" later.
      reportUnusedDisableDirectives: "off",
    },
  },
);
