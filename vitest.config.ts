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

// Durable filesystem, SQLite, and native diagnostics run on one worker.
// In-memory unit tests keep the normal timeout and parallel scheduling.
const diskIntegrationTests = [
  "tools/diagnose-public-service.test.mjs",
  "apps/desktop/src/main/model-usage-store.test.ts",
  "apps/desktop/src/main/image/image-persistence.test.ts",
  "apps/desktop/src/main/image/image-service*.test.ts",
  "apps/desktop/src/utilities/storage-migration.test.ts",
  "apps/desktop/src/utilities/project-transaction*.test.ts",
  "apps/desktop/src/utilities/project-transaction/**/*.test.ts",
  "apps/desktop/src/utilities/long-project-store*.test.ts",
  "apps/desktop/src/utilities/long-project-catalog*.test.ts",
  "apps/desktop/src/utilities/long-project-duplicate.test.ts",
  "apps/desktop/src/utilities/long-workspace*.test.ts",
  "apps/desktop/src/utilities/long-continuation-import.test.ts",
  "apps/desktop/src/utilities/long-import-integration.test.ts",
  "apps/desktop/src/utilities/long-search-pagination.test.ts",
  "apps/desktop/src/utilities/long-material-pack/*.test.ts",
  "apps/desktop/src/utilities/folder-catalog-store*.test.ts",
  "apps/desktop/src/utilities/folder-catalog-duplicate.test.ts",
  "apps/desktop/src/utilities/folder-catalog-marketplace.test.ts",
  "apps/desktop/src/utilities/folder-catalog-writing-context.test.ts",
  "apps/desktop/src/utilities/material-query-service.test.ts",
  "apps/desktop/src/utilities/device-sync-{initialization,workspace,plot-stages,recovery,interrupted-decomposition}.test.ts",
  "apps/desktop/src/extras/device-sync/initialization-workspace.test.ts",
  "apps/desktop/src/extras/agents/sources/long-book-source-commands.test.ts",
  ...[
    "briefs",
    "chronicle-rewrite",
    "completion-recovery",
    "creation-recovery",
    "evidence-validation",
    "generated-record-storage",
    "job-state-store",
    "overview-recovery",
    "process-recovery",
    "query",
    "quota-recovery",
    "read-cache",
    "recovery",
    "reuse-recovery",
    "registry-flow",
    "service",
    "shared-ref-recovery",
    "source-version",
    "usage-guard",
    "workflow-replanning"
  ].map(
    (name) =>
      `apps/desktop/src/utilities/long-book-decomposition/${name}.test.ts`
  ),
  "apps/desktop/src/utilities/conversation-history-*.integration.test.mjs",
  "apps/desktop/src/utilities/conversation-long-prompt.integration.test.mjs",
  "apps/desktop/src/utilities/conversation-exit.test.mjs",
  "apps/desktop/src/utilities/renderer-state-store.test.ts",
  "tools/renderer-state-history-migration.test.mjs",
  ...[
    "capacity",
    "runtime-recovery",
    "offline-repair",
    "migration-capacity",
    "message-projection",
    "legacy-replay-recovery",
    "worker-client",
    "legacy-migration-relocation",
    "legacy-file-migration",
    "staging",
    "sync-sessions",
    "database"
  ].map(
    (name) => `apps/desktop/src/utilities/conversation-storage/${name}.test.ts`
  )
];

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
    // A failed suite already blocks packaging; avoid running the slow
    // scale project afterwards just to report the same failed verification.
    bail: process.env.CI === "true" ? 1 : 0,
    globalSetup: ["./tools/setup-i18n-fixtures.ts"],
    setupFiles: ["./tools/setup-renderer-i18n.ts"],
    environment: "node",
    // Separate regular, disk integration, and scale phases so expensive durable
    // writes do not compete with other workers, especially on Windows.
    projects: [
      {
        extends: true,
        test: {
          name: "regular",
          include: testFiles,
          exclude: [
            ...configDefaults.exclude,
            scaleTest,
            ...diskIntegrationTests
          ],
          sequence: { groupOrder: 0 }
        }
      },
      {
        extends: true,
        test: {
          name: "disk-integration",
          include: diskIntegrationTests,
          maxWorkers: 1,
          testTimeout: 30_000,
          hookTimeout: 30_000,
          sequence: { groupOrder: 1 }
        }
      },
      {
        extends: true,
        test: {
          name: "scale",
          include: [scaleTest],
          maxWorkers: 1,
          sequence: { groupOrder: 2 }
        }
      }
    ]
  }
});
