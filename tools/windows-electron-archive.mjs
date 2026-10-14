import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

/** Use a local Windows runtime only with an independently verified official checksum. */
export async function resolveWindowsElectronArchive(
  version,
  {
    archivePath = process.env.DEEPWRITE_WINDOWS_ELECTRON_ARCHIVE,
    sha256 = process.env.DEEPWRITE_WINDOWS_ELECTRON_SHA256
  } = {}
) {
  if (archivePath === undefined && sha256 === undefined) return undefined;
  if (!archivePath || !sha256 || !/^[a-f\d]{64}$/iu.test(sha256)) {
    throw new Error(
      "本地 Windows Electron 归档需要同时提供路径和官方 SHA-256。"
    );
  }
  const archive = resolve(archivePath);
  if (basename(archive) !== `electron-v${version}-win32-x64.zip`) {
    throw new Error("本地 Windows Electron 归档必须匹配锁定的版本和架构。");
  }
  const info = await stat(archive);
  if (!info.isFile() || info.size === 0) {
    throw new Error("本地 Windows Electron 归档不存在或为空。");
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  if (hash.digest("hex") !== sha256.toLowerCase()) {
    throw new Error("本地 Windows Electron 归档与官方 SHA-256 不一致。");
  }
  return archive;
}
