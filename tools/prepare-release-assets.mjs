import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectReleaseFile } from "./release-files.mjs";
import { readReleaseVersion, releaseVersion } from "./release-version.mjs";

const desktopRequire = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url)
);
const yaml = createRequire(desktopRequire.resolve("electron-builder"))(
  "js-yaml"
);

function releaseGroups(version) {
  const prefix = `DeepWrite-${version}-`;
  return [
    {
      id: "win-x64",
      manifest: "latest.yml",
      installers: [`${prefix}win-x64-test.exe`],
      blockmaps: [`${prefix}win-x64-test.exe.blockmap`]
    },
    ...["x64", "arm64"].map((arch) => ({
      id: `mac-${arch}`,
      manifest: "latest-mac.yml",
      installers: [
        `${prefix}mac-${arch}-test.zip`,
        `${prefix}mac-${arch}-test.dmg`
      ],
      blockmaps: [`${prefix}mac-${arch}-test.zip.blockmap`]
    })),
    {
      id: "linux-x64",
      manifest: "latest-linux.yml",
      installers: [
        `${prefix}linux-x86_64-test.AppImage`,
        `${prefix}linux-amd64-test.deb`
      ],
      blockmaps: []
    }
  ];
}

async function readUpdateManifest(path, version, group, files) {
  const manifest = yaml.load(await readFile(path, "utf8"));
  if (manifest?.version !== version || !Array.isArray(manifest.files)) {
    throw new Error(`更新清单版本或文件列表无效：${path}`);
  }
  const seen = new Set();
  for (const entry of manifest.files) {
    const file = files.get(entry?.url);
    if (
      !file ||
      !group.installers.includes(entry.url) ||
      seen.has(entry.url) ||
      entry.size !== file.size ||
      entry.sha512 !== file.sha512
    ) {
      throw new Error(`更新清单文件重复，或大小、SHA-512 不匹配：${path}`);
    }
    seen.add(entry.url);
  }
  const primary = group.installers[0];
  if (
    group.installers.some((name) => !seen.has(name)) ||
    manifest.path !== primary ||
    manifest.sha512 !== files.get(primary).sha512
  ) {
    throw new Error(`更新清单缺少安装包或主下载项不匹配：${path}`);
  }
  return manifest;
}

export async function prepareReleaseAssets(input, output, version) {
  releaseVersion(`v${version}`, version, version);
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length !== 0) {
    throw new Error("Release 输出目录必须为空。");
  }
  const allFiles = new Map();
  const manifests = new Map();
  for (const group of releaseGroups(version)) {
    const directory = join(input, `installers-${group.id}`);
    const names = await readdir(directory);
    const required = [...group.installers, ...group.blockmaps, group.manifest];
    const allowed = new Set([
      ...required,
      ...group.installers.map((name) => `${name}.blockmap`)
    ]);
    if (required.some((name) => !names.includes(name))) {
      throw new Error(`缺少 ${group.id} 的安装包、blockmap 或更新清单。`);
    }
    const files = new Map();
    for (const name of names) {
      if (!allowed.has(name)) throw new Error(`意外的 Release 文件：${name}`);
      if (name === group.manifest) continue;
      if (allFiles.has(name)) throw new Error(`Release 文件重复：${name}`);
      const path = join(directory, name);
      const info = { path, ...(await inspectReleaseFile(path)) };
      files.set(name, info);
      allFiles.set(name, info);
    }
    const manifest = await readUpdateManifest(
      join(directory, group.manifest),
      version,
      group,
      files
    );
    const previous = manifests.get(group.manifest);
    manifests.set(
      group.manifest,
      previous
        ? { ...previous, files: [...previous.files, ...manifest.files] }
        : manifest
    );
  }
  // Validate every platform before writing files for the upload job.
  for (const [name, file] of allFiles) {
    await copyFile(file.path, join(output, name), constants.COPYFILE_EXCL);
  }
  for (const [name, manifest] of manifests) {
    await writeFile(
      join(output, name),
      yaml.dump(manifest, { lineWidth: -1 }),
      {
        flag: "wx"
      }
    );
  }
  const names = (await readdir(output)).sort();
  const checksums = [];
  for (const name of names) {
    const { sha256 } = await inspectReleaseFile(join(output, name));
    checksums.push(`${sha256}  ${name}\n`);
  }
  await writeFile(join(output, "SHA256SUMS.txt"), checksums.join(""), {
    flag: "wx"
  });
  return [...names, "SHA256SUMS.txt"];
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv.length !== 4) {
    throw new Error(
      "Usage: node tools/prepare-release-assets.mjs <input> <output>"
    );
  }
  const files = await prepareReleaseAssets(
    resolve(process.argv[2]),
    resolve(process.argv[3]),
    await readReleaseVersion()
  );
  console.log(`RELEASE_ASSETS_OK count=${files.length}`);
}
