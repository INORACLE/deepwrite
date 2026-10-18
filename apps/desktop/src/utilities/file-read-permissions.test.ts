import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { denyFileReads } from "./file-read-permissions.test-support";

it("denies actual file reads and restores access on the host filesystem", async () => {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-test-permissions-"));
  const path = join(root, "fixture.txt");
  await writeFile(path, "permission fixture");
  try {
    const restore = await denyFileReads(path);
    try {
      expect((await stat(path)).isFile()).toBe(true);
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
});
