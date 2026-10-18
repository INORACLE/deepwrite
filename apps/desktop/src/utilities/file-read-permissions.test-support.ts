import { execFileSync } from "node:child_process";
import { chmod, stat } from "node:fs/promises";

/** Deny real reads on each host; Windows chmod only changes writability. */
export async function denyFileReads(
  path: string
): Promise<() => Promise<void>> {
  if (process.platform === "win32") {
    const account = execFileSync("whoami", [], {
      encoding: "utf8",
      windowsHide: true
    }).trim();
    const change = (args: string[]) => {
      execFileSync("icacls", [path, ...args], {
        stdio: "pipe",
        windowsHide: true
      });
    };
    // Deny content reads, while leaving stat/ACL access available.
    change(["/deny", `${account}:(RD)`]);
    return async () => change(["/remove:d", account]);
  }
  const mode = (await stat(path)).mode & 0o777;
  await chmod(path, 0);
  return async () => chmod(path, mode);
}
