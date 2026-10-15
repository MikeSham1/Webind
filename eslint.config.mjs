import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // The codebase already uses a leading underscore (_prev, _formData) as
      // its own convention for "intentionally unused — required by a
      // callback signature (useActionState) I don't need". That only
      // silenced the default rule by accident when a later, used argument
      // followed it; a deliberately-unused FINAL argument (e.g. an action
      // with no form fields) still warned. Recognize the convention we
      // already rely on instead of renaming call signatures around it.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-e2e/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
