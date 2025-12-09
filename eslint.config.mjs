// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  {
    files: ["**/*.ts"],
    ignores: ["node_modules/**", "main.js", "*.mjs"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
    plugins: {
      obsidianmd,
    },
    rules: {
      ...obsidianmd.configs.recommended,
      // You can add your own configuration to override or add rules
    },
  },
];
