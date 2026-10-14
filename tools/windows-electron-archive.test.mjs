import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWindowsElectronArchive } from "./windows-electron-archive.mjs";

const version = "99.0.0";
const content = "synthetic Windows runtime archive";
const sha256 = createHash("sha256").update(content).digest("hex");
const roots = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function archiveFixture(name = `electron-v${version}-win32-x64.zip`) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-electron-archive-"));
  roots.push(root);
  const archivePath = join(root, name);
  await writeFile(archivePath, content);
  return archivePath;
}

describe("local Windows Electron archive", () => {
  it("retains the normal downloader when no local archive is configured", async () => {
    vi.stubEnv("DEEPWRITE_WINDOWS_ELECTRON_ARCHIVE", undefined);
    vi.stubEnv("DEEPWRITE_WINDOWS_ELECTRON_SHA256", undefined);
    await expect(
      resolveWindowsElectronArchive(version)
    ).resolves.toBeUndefined();
  });

  it("accepts the locked Windows x64 archive with the supplied checksum", async () => {
    const archivePath = await archiveFixture();
    await expect(
      resolveWindowsElectronArchive(version, {
        archivePath,
        sha256: sha256.toUpperCase()
      })
    ).resolves.toBe(archivePath);
  });

  it.each(["", "invalid-checksum"])(
    "requires a valid checksum before reading an archive: %s",
    async (checksum) => {
      await expect(
        resolveWindowsElectronArchive(version, {
          archivePath: "electron-v99.0.0-win32-x64.zip",
          sha256: checksum
        })
      ).rejects.toThrow("同时提供路径和官方 SHA-256");
    }
  );

  it.each([
    "electron-v98.0.0-win32-x64.zip",
    "electron-v99.0.0-win32-arm64.zip",
    "electron-v99.0.0-darwin-x64.zip"
  ])("rejects a different version or architecture: %s", async (name) => {
    const archivePath = await archiveFixture(name);
    await expect(
      resolveWindowsElectronArchive(version, { archivePath, sha256 })
    ).rejects.toThrow("匹配锁定的版本和架构");
  });

  it("rejects an archive changed after its checksum was obtained", async () => {
    const archivePath = await archiveFixture();
    await writeFile(archivePath, `${content} modified`);
    await expect(
      resolveWindowsElectronArchive(version, { archivePath, sha256 })
    ).rejects.toThrow("与官方 SHA-256 不一致");
  });

  it("rejects empty archives", async () => {
    const archivePath = await archiveFixture();
    await writeFile(archivePath, "");
    await expect(
      resolveWindowsElectronArchive(version, { archivePath, sha256 })
    ).rejects.toThrow("不存在或为空");
  });
});
