import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { resolveRendererStyles } from "./tools/resolve-renderer-styles.mjs";

const configuredMaxWorkers = process.env.DEEPWRITE_TEST_MAX_WORKERS;
const maxWorkers =
  configuredMaxWorkers === undefined ? undefined : Number(configuredMaxWorkers);
if (
  maxWorkers !== undefined &&
  (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1)
) {
  throw new Error("DEEPWRITE_TEST_MAX_WORKERS must be a positive integer.");
}

export default defineConfig({
  plugins: [
    vue({
      template: {
        // Public-root SVG image URLs remain URLs; importing them creates
        // synthetic file:///app-icon.png modules that are invalid on Windows.
        transformAssetUrls: { tags: { image: [] } }
      }
    }),
    {
      name: "deepwrite-test-source",
      enforce: "pre",
      resolveId(id) {
        if (id === "virtual:deepwrite-renderer-styles") {
          return "\0virtual:deepwrite-renderer-styles";
        }
        return null;
      },
      load(id) {
        if (id !== "\0virtual:deepwrite-renderer-styles") return null;
        const source = resolveRendererStyles();
        return `export default ${JSON.stringify(source)};`;
      }
    }
  ],
  test: {
    maxWorkers,
    globalSetup: ["./tools/setup-i18n-fixtures.ts"],
    setupFiles: ["./tools/setup-renderer-i18n.ts"],
    include: [
      "packages/**/*.test.ts",
      "tools/**/*.test.mjs",
      "apps/desktop/src/main/**/*.test.ts",
      "apps/desktop/src/utilities/**/*.test.{ts,mjs}",
      "apps/desktop/src/extras/**/*.test.ts",
      "apps/desktop/src/renderer/**/*.test.ts"
    ],
    environment: "node"
  }
});
