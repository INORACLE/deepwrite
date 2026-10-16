import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyWindowsArchitecture } from "../apps/desktop/scripts/package-runtime-files.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function executableFixture(machine) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-windows-pe-"));
  roots.push(root);
  const path = join(root, "synthetic-runtime.exe");
  const bytes = Buffer.alloc(134);
  bytes.write("MZ", 0);
  bytes.writeUInt32LE(128, 60);
  bytes.writeUInt32LE(0x4550, 128);
  bytes.writeUInt16LE(machine, 132);
  await writeFile(path, bytes);
  return { path, bytes };
}

describe("Windows runtime architecture verification", () => {
  it.each([
    ["x64", 0x8664],
    ["arm64", 0xaa64]
  ])("accepts a native %s PE executable", async (arch, machine) => {
    const { path } = await executableFixture(machine);
    await expect(
      verifyWindowsArchitecture(path, arch)
    ).resolves.toBeUndefined();
  });

  it.each([
    ["arm64", 0x8664],
    ["x64", 0xaa64]
  ])("rejects a different architecture for %s", async (arch, machine) => {
    const { path } = await executableFixture(machine);
    await expect(verifyWindowsArchitecture(path, arch)).rejects.toThrow(
      `architecture mismatch: expected ${arch}`
    );
  });

  it("rejects a malformed DOS header", async () => {
    const { path } = await executableFixture(0xaa64);
    await writeFile(path, "invalid executable placeholder");
    await expect(verifyWindowsArchitecture(path, "arm64")).rejects.toThrow(
      "Invalid Windows executable header"
    );
  });

  it("rejects an incomplete PE header", async () => {
    const { path, bytes } = await executableFixture(0xaa64);
    await writeFile(path, bytes.subarray(0, 130));
    await expect(verifyWindowsArchitecture(path, "arm64")).rejects.toThrow(
      "Invalid Windows PE header"
    );
  });

  it("rejects unsupported architecture requests before reading a file", async () => {
    await expect(
      verifyWindowsArchitecture("unused-placeholder.exe", "ia32")
    ).rejects.toThrow("Unsupported Windows architecture");
  });
});
