import { mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { denyFileReads } from "./file-read-permissions.test-support";

it.each([...new Set<NodeJS.Platform>([process.platform, "win32"])])(
  "denies content I/O in %s mode and restores access without hiding metadata",
  async (platform) => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-test-permissions-"));
    const path = join(root, "fixture.txt");
    await writeFile(path, "permission fixture");
    try {
      const restore = await denyFileReads(path, platform);
      try {
        expect((await stat(path)).isFile()).toBe(true);
        await expect(open(path, "r")).rejects.toMatchObject({ code: "EACCES" });
        await expect(readFile(path, "utf8")).rejects.toMatchObject({
          code: "EACCES"
        });
      } finally {
        await restore();
      }
      expect(await readFile(path, "utf8")).toBe("permission fixture");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

it("keeps other paths readable and restores overlapping Windows failures independently", async () => {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-test-permissions-"));
  const first = join(root, "first.txt");
  const second = join(root, "second.txt");
  const allowed = join(root, "allowed.txt");
  const restores: Array<() => Promise<void>> = [];
  try {
    for (const path of [first, second, allowed])
      await writeFile(path, "fixture");
    restores.push(await denyFileReads(first, "win32"));
    restores.push(await denyFileReads(first, "win32"));
    restores.push(await denyFileReads(second, "win32"));
    expect(await readFile(allowed, "utf8")).toBe("fixture");
    await restores.pop()!();
    expect(await readFile(second, "utf8")).toBe("fixture");
    await restores.pop()!();
    await expect(readFile(first, "utf8")).rejects.toMatchObject({
      code: "EACCES"
    });
    await restores.pop()!();
    expect(await readFile(first, "utf8")).toBe("fixture");
  } finally {
    for (const restore of restores.reverse()) await restore();
    await rm(root, { recursive: true, force: true });
  }
});
