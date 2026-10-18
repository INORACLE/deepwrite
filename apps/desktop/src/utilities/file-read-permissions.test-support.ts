import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

const blocked = new Map<string, number>();
let restoreMocks: (() => void) | undefined;
function key(path: unknown): string | undefined {
  const text =
    path instanceof URL
      ? fileURLToPath(path)
      : Buffer.isBuffer(path)
        ? path.toString()
        : path;
  return typeof text === "string" ? resolve(text).toLowerCase() : undefined;
}
function deny(path: unknown): void {
  const id = key(path);
  if (id && blocked.has(id)) {
    throw Object.assign(new Error("Fixture content read denied"), {
      code: "EACCES",
      path: id
    });
  }
}
function installReadFailures(): void {
  const originalOpen = fs.open;
  const originalRead = fs.readFile;
  const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    deny(args[0]);
    return originalOpen(...args);
  });
  const read = vi.spyOn(fs, "readFile").mockImplementation(async (...args) => {
    deny(args[0]);
    return originalRead(...args);
  });
  syncBuiltinESMExports();
  restoreMocks = () => {
    open.mockRestore();
    read.mockRestore();
    syncBuiltinESMExports();
  };
}

/** POSIX uses real permissions; Windows injects EACCES at the content I/O
 * boundary because administrator runners can still read ACL-denied files.
 * Stat and unrelated paths keep their real filesystem behavior. */
export async function denyFileReads(
  path: string,
  platform: NodeJS.Platform = process.platform
): Promise<() => Promise<void>> {
  if (platform === "win32") {
    if (!restoreMocks) installReadFailures();
    const id = key(path)!;
    blocked.set(id, (blocked.get(id) ?? 0) + 1);
    return async () => {
      const count = blocked.get(id) ?? 0;
      if (count > 1) blocked.set(id, count - 1);
      else blocked.delete(id);
      if (!blocked.size) {
        restoreMocks?.();
        restoreMocks = undefined;
      }
    };
  }
  const mode = (await fs.stat(path)).mode & 0o777;
  await fs.chmod(path, 0);
  return async () => fs.chmod(path, mode);
}
