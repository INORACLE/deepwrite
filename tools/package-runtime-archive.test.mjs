import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  REQUIRED_RUNTIME_FILES,
  verifyPackagedRuntime
} from "../apps/desktop/scripts/package-runtime-files.mjs";

const require = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url)
);
const builderRequire = createRequire(require.resolve("electron-builder"));
const appBuilderRequire = createRequire(
  builderRequire.resolve("app-builder-lib")
);
const asar = appBuilderRequire("@electron/asar");
const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      })
    )
  );
});

async function runtimeArchive(includeChunk) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-runtime archive-"));
  roots.push(root);
  const source = join(root, "application");
  const chunk = "out/main/chunks/storage.js";
  const entries = [...REQUIRED_RUNTIME_FILES, ...(includeChunk ? [chunk] : [])];
  for (const entry of entries) {
    const file = join(source, entry);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      entry.endsWith("conversation-storage/worker-entry.js")
        ? 'import "../../chunks/storage.js";'
        : entry === "package.json"
          ? "{}"
          : ""
    );
  }
  const archive = join(root, "app.asar");
  await asar.createPackage(source, archive);
  return archive;
}

it("reads nested runtime entries and shared chunks from a real ASAR on the host platform", async () => {
  const archive = await runtimeArchive(true);
  expect(verifyPackagedRuntime(archive).checkedModules).toBe(7);
});

it("rejects a real archive missing a referenced runtime chunk", async () => {
  const archive = await runtimeArchive(false);
  expect(() => verifyPackagedRuntime(archive)).toThrow(
    "Packaged runtime dependency is missing: out/main/chunks/storage.js"
  );
});
