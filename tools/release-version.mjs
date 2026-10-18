import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function releaseVersion(tag, rootVersion, desktopVersion) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(tag ?? "")) {
    throw new Error("Release 标签必须使用 v主版本.次版本.补丁版本。");
  }
  const version = tag.slice(1);
  if (version !== rootVersion || version !== desktopVersion) {
    throw new Error("Release 标签必须与两个 package.json 的版本一致。");
  }
  return version;
}

export async function readReleaseVersion(tag = process.env.RELEASE_TAG) {
  const [root, desktop] = await Promise.all(
    ["../package.json", "../apps/desktop/package.json"].map(async (path) =>
      JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"))
    )
  );
  return releaseVersion(tag, root.version, desktop.version);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  console.log(`RELEASE_VERSION_OK version=${await readReleaseVersion()}`);
}
