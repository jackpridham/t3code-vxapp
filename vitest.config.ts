import * as path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["@Docs/**", "node_modules/**"],
  },
  resolve: {
    alias: [
      {
        find: /^@t3tools\/contracts$/,
        replacement: path.resolve(import.meta.dirname, "./packages/contracts/src/index.ts"),
      },
    ],
  },
});
