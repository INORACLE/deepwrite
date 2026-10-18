import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";

export async function inspectReleaseFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.size === 0) {
    throw new Error(`Release 文件必须是非空的普通文件：${path}`);
  }
  const sha256 = createHash("sha256");
  const sha512 = createHash("sha512");
  for await (const chunk of createReadStream(path)) {
    sha256.update(chunk);
    sha512.update(chunk);
  }
  return {
    size: info.size,
    sha256: sha256.digest("hex"),
    sha512: sha512.digest("base64")
  };
}
