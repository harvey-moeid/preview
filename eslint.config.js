import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: [
      "**/dist/**",
      "**/.wrangler/**",
      "**/worker-configuration.d.ts",
      "test-results/**",
      "playwright-report/**",
      "node_modules/**",
      "**/.local/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  { rules: { "no-control-regex": "off" } },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        performance: "readonly",
        Buffer: "readonly",
        document: "readonly",
      },
    },
  },
);
