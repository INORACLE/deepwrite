import { configDefaults, defineConfig } from "vitest/config";
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

const scaleTest =
  "apps/desktop/src/utilities/long-book-decomposition/scale.test.ts";

const testFiles = [
  "packages/**/*.test.ts",
  "tools/**/*.test.mjs",
  "apps/desktop/src/main/**/*.test.ts",
  "apps/desktop/src/utilities/**/*.test.{ts,mjs}",
  "apps/desktop/src/extras/**/*.test.ts",
  "apps/desktop/src/renderer/**/*.test.ts"
];

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
    // A failed regular suite already blocks packaging; avoid running the slow
    // scale project afterwards just to report the same failed verification.
    bail: process.env.CI === "true" ? 1 : 0,
    globalSetup: ["./tools/setup-i18n-fixtures.ts"],
    setupFiles: ["./tools/setup-renderer-i18n.ts"],
    environment: "node",
    // Scale fixtures perform thousands of durable writes. Run them after other
    // suites so they do not compete for the same disk, especially on Windows.
    projects: [
      {
        extends: true,
        test: {
          name: "regular",
          include: testFiles,
          exclude: [...configDefaults.exclude, scaleTest],
          sequence: { groupOrder: 0 }
        }
      },
      {
        extends: true,
        test: {
          name: "scale",
          include: [scaleTest],
          maxWorkers: 1,
          sequence: { groupOrder: 1 }
        }
      }
    ]
  }
});
