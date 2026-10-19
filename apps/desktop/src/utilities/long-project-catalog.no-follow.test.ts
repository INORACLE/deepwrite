import {
  link,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { LongProjectCatalog } from "./long-project-catalog";

// Exercise the fallback used on hosts that lack the POSIX no-follow flag.
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, constants: { ...fs.constants, O_NOFOLLOW: 0 } };
});
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 10 }))
  );
});

it.each(["symbolic", "hard"])(
  "rejects a %s registry even without O_NOFOLLOW",
  async (kind) => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-registry-fallback-"))
    );
    roots.push(root);
    const userDataPath = join(root, "profile");
    await mkdir(userDataPath);
    const projects = {
      createBook: vi.fn(),
      openBook: vi.fn(),
      inspectBook: vi.fn()
    };
    const catalog = new LongProjectCatalog({ userDataPath, projects });
    const target = join(root, "outside.json");
    const content = JSON.stringify({
      schemaVersion: 2,
      updatedAt: "2026-10-18T00:00:00Z",
      projects: []
    });
    await writeFile(target, content);
    if (kind === "symbolic") await symlink(target, catalog.registryPath);
    else await link(target, catalog.registryPath);
    await expect(catalog.list()).rejects.toThrow(/符号链接|硬链接|安全/u);
    expect(projects.openBook).not.toHaveBeenCalled();
  }
);
