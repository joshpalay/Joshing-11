import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    "_salvaged/**",
    ".next/**",
    "node_modules/**",
    "out/**",
    "build/**",
    "dist/**",
    "coverage/**",
    ".drizzle-tmp/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
